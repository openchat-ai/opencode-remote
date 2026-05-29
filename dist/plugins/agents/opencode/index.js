// OpenCode CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

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
    
    async sendPrompt(_sessionId, prompt, history) {
        const contextualPrompt = this.buildContextualPrompt(prompt, history);
        return this.callOpenCode(contextualPrompt);
    }
    
    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const historyText = history
            .map(msg => `[${msg.role === 'user' ? 'User' : 'Assistant'}]: ${msg.content}`)
            .join('\n\n');
        return `Previous conversation:\n${historyText}\n\nCurrent request: ${prompt}`;
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

    callOpenCode(prompt) {
        return new Promise((resolve) => {
            const proc = spawn('opencode', ['run', '--format', 'json', prompt], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });

            let stdout = '';
            let stderr = '';
            let fullText = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
                const lines = stdout.split('\n');
                stdout = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        if (event.text) fullText += event.text;
                    } catch {}
                }
            });

            proc.stderr?.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                if (code !== 0) {
                    const detail = this.extractErrorMessage(stdout, stderr);
                    const hint = detail
                        ? `: ${detail}`
                        : '。请运行 `opencode auth login` 配置认证。';
                    resolve(`❌ OpenCode 错误${hint}`);
                } else {
                    resolve(fullText || '完成');
                }
            });
        });
    }
}
