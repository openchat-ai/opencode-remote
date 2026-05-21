// OpenCode CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

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
                    resolve(`❌ OpenCode 错误。请运行 \`opencode auth login\` 配置认证。`);
                } else {
                    resolve(fullText || '完成');
                }
            });
        });
    }
}
