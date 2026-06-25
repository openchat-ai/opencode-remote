// OpenAI Codex CLI agent adapter
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

export class CodexAgentAdapter {
    name = 'codex';
    aliases = ['cx'];
    
    async isAvailable() {
        return new Promise((resolve) => {
            const command = platform() === 'win32' ? 'where' : 'which';
            const proc = spawn(command, ['codex'], { stdio: 'ignore', shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }
    
    async sendPrompt(_sessionId, prompt, history, options = {}) {
        const contextualPrompt = this.buildContextualPrompt(prompt, history);
        return this.callCodex(contextualPrompt, options.threadId);
    }
    
    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const lines = history.slice(-10).map(msg => {
            const label = msg.role === 'user' ? 'User' : 'AI';
            return `${label}: ${msg.content}`;
        }).join('\n');
        return `Continue the conversation as the AI assistant.\n\n${lines}\nUser: ${prompt}\nAI:`;
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
    
    callCodex(prompt, threadId) {
        return new Promise((resolve) => {
            const proc = spawn('codex', ['--prompt', prompt], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
            if (threadId) registerAgentProcess(threadId, proc, 'codex');
            let stdout = '';
            let stderr = '';
            let killed = false;
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });
            const TIMEOUT_MS = parseInt(process.env.OPENCODE_TIMEOUT || '600', 10) * 1000;
            const timeout = setTimeout(() => {
                killed = true;
                console.warn(`[codex] Timeout after ${TIMEOUT_MS / 1000}s, killing process`);
                try { proc.kill('SIGKILL'); } catch {}
                resolve(`⏰ Codex 超时 (${TIMEOUT_MS / 1000}s)，任务已终止`);
            }, TIMEOUT_MS);
            proc.on('close', (code) => {
                clearTimeout(timeout);
                if (threadId) unregisterAgentProcess(threadId);
                if (killed) return;
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    const detail = this.extractErrorMessage(stdout, stderr);
                    resolve(`❌ Codex 错误${detail ? `: ${detail}` : ''}`);
                }
            });
        });
    }
}
