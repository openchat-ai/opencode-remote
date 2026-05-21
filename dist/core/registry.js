// Plugin registry for messengers and agents
class PluginRegistry {
    messengers = new Map();
    agents = new Map();
    agentAliases = new Map();
    
    registerMessenger(adapter) {
        if (this.messengers.has(adapter.name)) {
            console.warn(`Messenger "${adapter.name}" already registered, overwriting`);
        }
        this.messengers.set(adapter.name, adapter);
    }
    
    registerAgent(adapter) {
        if (this.agents.has(adapter.name)) {
            console.warn(`Agent "${adapter.name}" already registered, overwriting`);
        }
        this.agents.set(adapter.name, adapter);
        for (const alias of adapter.aliases || []) {
            if (this.agentAliases.has(alias)) {
                console.warn(`Agent alias "${alias}" already registered, overwriting`);
            }
            this.agentAliases.set(alias, adapter.name);
        }
    }
    
    getMessenger(name) {
        return this.messengers.get(name);
    }
    
    getAgent(name) {
        return this.agents.get(name);
    }
    
    findAgent(nameOrAlias) {
        const agent = this.agents.get(nameOrAlias);
        if (agent) return agent;
        const realName = this.agentAliases.get(nameOrAlias);
        if (realName) {
            return this.agents.get(realName);
        }
        return undefined;
    }
    
    listMessengers() {
        return Array.from(this.messengers.keys());
    }
    
    listAgents() {
        return Array.from(this.agents.keys());
    }
    
    async loadBuiltInPlugins() {
        try {
            const { OpenCodeAgentAdapter } = await import('../plugins/agents/opencode/index.js');
            this.registerAgent(new OpenCodeAgentAdapter());
        } catch (e) {
            console.warn('Failed to load OpenCode agent:', e.message);
        }
        
        try {
            const { ClaudeCodeAgentAdapter } = await import('../plugins/agents/claude-code/index.js');
            this.registerAgent(new ClaudeCodeAgentAdapter());
        } catch (e) {
            console.warn('Failed to load Claude Code agent:', e.message);
        }
        
        try {
            const { CodexAgentAdapter } = await import('../plugins/agents/codex/index.js');
            this.registerAgent(new CodexAgentAdapter());
        } catch (e) {
            console.warn('Failed to load Codex agent:', e.message);
        }
        
        try {
            const { CopilotAgentAdapter } = await import('../plugins/agents/copilot/index.js');
            this.registerAgent(new CopilotAgentAdapter());
        } catch (e) {
            console.warn('Failed to load Copilot agent:', e.message);
        }
        
        console.log(`Plugin registry: ${this.agents.size} agents registered`);
    }
}

export const registry = new PluginRegistry();
