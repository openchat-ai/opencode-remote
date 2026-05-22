// GitHub Copilot CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

export class CopilotAgentAdapter {
    name = 'copilot';
    aliases = ['copilot-cli', 'copilot'];
    
    async isAvailable() {
        return new Promise((resolve) => {
            const command = platform() === 'win32' ? 'where' : 'which';
            const proc = spawn(command, ['copilot'], { stdio: 'ignore', shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }
    
    async sendPrompt(_sessionId, prompt, history) {
        const contextualPrompt = this.buildContextualPrompt(prompt, history);
        return this.callCopilot(contextualPrompt);
    }
    
    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const historyText = history.map(msg => `[${msg.role}]: ${msg.content}`).join('\n\n');
        return `Context:\n${historyText}\n\n${prompt}`;
    }
    
    callCopilot(prompt) {
        return new Promise((resolve) => {
            const proc = spawn('copilot', ['suggest', '--prompt', prompt], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });
            proc.on('close', (code) => {
                resolve(code === 0 ? stdout.trim() : `❌ Copilot 错误: ${stderr}`);
            });
        });
    }
}
