// ACP (Agent Communication Protocol) remote agent adapter
export class ACPAdapter {
    name;
    aliases;
    config;
    
    constructor(config) {
        this.name = config.name;
        this.aliases = config.aliases || [];
        this.config = config;
    }
    
    async isAvailable() {
        try {
            const response = await fetch(`${this.config.endpoint}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }
    
    async sendPrompt(_sessionId, prompt, history) {
        try {
            const response = await fetch(`${this.config.endpoint}/prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, history: history || [] }),
                signal: AbortSignal.timeout(120000),
            });
            if (!response.ok) {
                return `❌ ACP agent error: ${response.statusText}`;
            }
            const data = await response.json();
            return data.text || data.content || JSON.stringify(data);
        } catch (error) {
            return `❌ ACP agent error: ${error.message}`;
        }
    }
}
