// OpenAI Codex CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

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
                resolve(code === 0 ? stdout.trim() : `❌ Codex 错误: ${stderr}`);
            });
        });
    }
}
