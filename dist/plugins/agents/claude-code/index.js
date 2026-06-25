// Claude Code CLI agent adapter — --print + explicit context prompt
// @ts-nocheck — spawn options type differs between @types/node versions
import { spawn } from 'child_process';
import { platform } from 'os';
import { tmpdir } from 'os';
import { join } from 'path';
import { registerAgentProcess, unregisterAgentProcess } from '../../../core/agent-registry.js';

const LIUV_CRASH_PATTERNS = [
    'Assertion failed',
    'UV_HANDLE_CLOSING',
    'src\\win\\async.c',
    'libuv',
];

export class ClaudeCodeAgentAdapter {
    name = 'claude-code';
    aliases = ['cc', 'claude'];

    async isAvailable() {
        return new Promise((resolve) => {
            const command = platform() === 'win32' ? 'where' : 'which';
            const proc = spawn(command, ['claude'], { stdio: 'ignore', shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }

    async sendPrompt(_sessionId, prompt, history, options = {}) {
        const threadId = options.threadId;
        const contextualPrompt = buildContextualPrompt(prompt, history);
        // 跑在临时目录，避免 claude 扫描项目源码崩在 misc-lib.mjs
        const safeCwd = join(tmpdir(), 'opencode-remote-claude');
        const { mkdirSync, existsSync } = await import('fs');
        if (!existsSync(safeCwd)) mkdirSync(safeCwd, { recursive: true });
        return this.callClaude(['--print', contextualPrompt], safeCwd, threadId);
    }

    isCrashNoise(line) {
        return LIUV_CRASH_PATTERNS.some(p => line.includes(p));
    }

    extractErrorMessage(stdout, stderr, code) {
        const stdoutLines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
        const stdoutErrors = stdoutLines.filter(l => !this.isCrashNoise(l));
        if (stdoutErrors.length > 0) return stdoutErrors.join('\n');
        const stderrLines = stderr.trim().split('\n').map(l => l.trim()).filter(Boolean);
        const stderrReal = stderrLines.filter(l => !this.isCrashNoise(l));
        if (stderrReal.length > 0) return stderrReal.join('\n');
        const all = [...stdoutLines, ...stderrLines];
        const firstRelevant = all.find(l => /Error|error|ERROR|^\d{3}/.test(l));
        if (firstRelevant) return firstRelevant;
        return `进程异常退出 (code: ${code})`;
    }

    callClaude(args, safeCwd, threadId) {
        return new Promise((resolve) => {
            const opts = {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
                cwd: safeCwd,
            };
            // shell:true on Windows cmd.exe interprets \n as command separators,
            // so multi-line prompts get truncated to the first line.
            // Collapse newlines + extra whitespace to single spaces.
            const safeArgs = args.map(a =>
                typeof a === 'string' ? a.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() : a
            );
            console.log(`[claude-code] ${safeArgs.join(' ')}`);
            const proc = spawn('claude', safeArgs, opts);
            if (threadId) registerAgentProcess(threadId, proc, 'claude-code');
            let stdout = '';
            let stderr = '';
            let killed = false;
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });

            const TIMEOUT_MS = parseInt(process.env.OPENCODE_TIMEOUT || '600', 10) * 1000;
            const timeout = setTimeout(() => {
                killed = true;
                console.warn(`[claude-code] Timeout ${TIMEOUT_MS / 1000}s`);
                try { proc.kill('SIGKILL'); } catch {}
                resolve(`⏰ Claude Code 超时 (${TIMEOUT_MS / 1000}s)`);
            }, TIMEOUT_MS);

            proc.on('close', (code) => {
                clearTimeout(timeout);
                if (threadId) unregisterAgentProcess(threadId);
                if (killed) return;
                console.log(`[claude-code] exit ${code}, ${stdout.length} bytes`);
                if (code === 0) { resolve(stdout.trim()); return; }
                const errorMsg = this.extractErrorMessage(stdout, stderr, code);
                resolve(`❌ Claude Code 错误 (exit ${code}): ${errorMsg}`);
            });
            proc.on('error', (err) => {
                clearTimeout(timeout);
                if (threadId) unregisterAgentProcess(threadId);
                resolve(`❌ Claude Code 启动失败: ${err.message}`);
            });
        });
    }
}

function buildContextualPrompt(prompt, history) {
    if (!history || history.length === 0) return prompt;
    const lines = history.slice(-10).map(m => {
        const label = m.role === 'user' ? 'User' : 'Assistant';
        return `${label}: ${m.content}`;
    }).join('\n');
    return `[Previous conversation — for context only, answer the LATEST question below]\n\n${lines}\n\n[Latest question]\n${prompt}`;
}

// Exported for tests
export { buildContextualPrompt };
