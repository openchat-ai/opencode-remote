// OpenCode CLI agent adapter
// @ts-nocheck — spawn options type differs between @types/node versions
import { spawn } from 'child_process';
import { platform } from 'os';
import { registerAgentProcess, unregisterAgentProcess } from '../../../core/agent-registry.js';

const CRASH_PATTERNS = [
    'Assertion failed',
    'UV_HANDLE_CLOSING',
    'src\\win\\async.c',
    'libuv',
];

export class OpenCodeAgentAdapter {
    name = 'opencode';
    aliases = ['oc', 'opencodeai'];
    
    async isAvailable() {
        return new Promise((resolve) => {
            const command = platform() === 'win32' ? 'where' : 'which';
            const proc = spawn(command, ['opencode'], { stdio: 'ignore', shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }
    
    async sendPrompt(_sessionId, prompt, history, options = {}) {
        const threadId = options.threadId;
        const contextualPrompt = this.buildContextualPrompt(prompt, history);
        return this.callOpenCode(contextualPrompt, threadId);
    }

    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const lines = history.slice(-10).map(msg => {
            const label = msg.role === 'user' ? 'User' : 'AI';
            return `${label}: ${msg.content}`;
        }).join('\n');
        return `[Previous conversation — for context only, answer the LATEST question below]\n\n${lines}\n\n[Latest question]\n${prompt}`;
    }

    extractErrorMessage(stdout, stderr) {
        const lines = [...stdout.trim().split('\n'), ...stderr.trim().split('\n')]
            .map(l => l.trim()).filter(Boolean)
            .filter(l => !CRASH_PATTERNS.some(p => l.includes(p)));

        if (lines.length > 0) return lines.join('\n');
        const first = [...stdout.trim().split('\n'), ...stderr.trim().split('\n')]
            .find(l => /Error|error|ERROR|^\d{3}/.test(l));
        return first || null;
    }

    callOpenCode(prompt, threadId) {
        return new Promise((resolve) => {
// shell:true on Windows cmd.exe (and /bin/sh on POSIX) interprets several chars
// as command syntax. Strip them so user message content can't trigger command
// splitting, redirection, or quoting issues.
const safePrompt = typeof prompt === 'string'
    ? prompt
        .replace(/[\r\n]+/g, ' ')
        .replace(/[&|<>^"`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : prompt;
            const proc = spawn('opencode', ['run', '--format', 'json', safePrompt], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
            if (threadId) registerAgentProcess(threadId, proc, 'opencode');

            let stdout = '';
            let stderr = '';
            let fullText = '';
            let resigned = false;
            let killed = false;

            const TIMEOUT_MS = parseInt(process.env.OPENCODE_TIMEOUT || '600', 10) * 1000;
            const timeout = setTimeout(() => {
                killed = true;
                console.warn(`[opencode-agent] Timeout after ${TIMEOUT_MS / 1000}s, killing process`);
                try { proc.kill('SIGKILL'); } catch {}
                resolve(`⏰ OpenCode 超时 (${TIMEOUT_MS / 1000}s)，任务已终止`);
            }, TIMEOUT_MS);

            const STUCK_PATTERNS = [
                'Free usage exceeded', 'quota exceeded', 'rate limit',
                'retrying in', 'retry attempt',
                '429', '401', '403', '402', 'Payment Required',
                'subscription required', 'insufficient_quota',
            ];

            const checkStuck = (stderrText) => {
                if (resigned) return;
                for (const pattern of STUCK_PATTERNS) {
                    if (stderrText.toLowerCase().includes(pattern.toLowerCase())) {
                        resigned = true;
                        proc.kill();
                        const detail = this.extractErrorMessage('', stderrText);
                        resolve(`❌ OpenCode 无法继续: ${detail || pattern}`);
                        return true;
                    }
                }
                return false;
            };

            proc.stdout?.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        if (event.text) fullText += event.text;
                    } catch (e) { console.debug('[opencode-agent] stdout parse:', e.message); }
                }
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
                checkStuck(stderr);
            });

            proc.on('close', (code) => {
                clearTimeout(timeout);
                if (threadId) unregisterAgentProcess(threadId);
                if (resigned || killed) return;
                if (code !== 0) {
                    const detail = this.extractErrorMessage(stdout, stderr);
                    const hint = detail
                        ? `: ${detail}`
                        : '。请运行 `opencode auth login` 配置认证。';
                    resolve(`❌ OpenCode 错误 (exit code ${code})${hint}`);
                } else {
                    resolve(fullText || '完成');
                }
            });
        });
    }
}
