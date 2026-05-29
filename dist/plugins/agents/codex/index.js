// OpenAI Codex CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

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
    
    async sendPrompt(_sessionId, prompt, history) {
        const contextualPrompt = this.buildContextualPrompt(prompt, history);
        return this.callCodex(contextualPrompt);
    }
    
    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const historyText = history.map(msg => `[${msg.role}]: ${msg.content}`).join('\n\n');
        return `Context:\n${historyText}\n\n${prompt}`;
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
    
    callCodex(prompt) {
        return new Promise((resolve) => {
            const proc = spawn('codex', ['--prompt', prompt], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });
            proc.on('close', (code) => {
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
