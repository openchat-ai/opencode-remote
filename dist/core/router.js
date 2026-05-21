// Message router - full command definitions shared across all platforms
import { registry } from './registry.js';

export const COMMAND_ALIASES = {
    start: ['start'],
    help: ['help', 'h', '?'],
    status: ['status'],
    reset: ['reset'],
    stop: ['stop'],
    restart: ['restart'],
    sessions: ['sessions', 'sw'],
    delsessions: ['delsessions', 'del'],
    loop: ['loop'],
    edit: ['edit'],
    analyze: ['analyze'],
    compact: ['compact'],
    summary: ['summary'],
    diff: ['diff'],
    commit: ['commit'],
    review: ['review'],
    flush: ['flush'],
    scope: ['scope'],
    copy: ['copy'],
    revert: ['revert'],
    upload: ['upload', '上传'],
    delete: ['delete', '删除'],
    oc: ['oc'],
    cc: ['cc'],
    cx: ['cx'],
    copilot: ['copilot'],
    agents: ['agents'],
    model: ['model'],
};

const COMMAND_MAP = {};
for (const [cmd, aliases] of Object.entries(COMMAND_ALIASES)) {
    for (const alias of aliases) {
        COMMAND_MAP[alias] = cmd;
    }
}

export function detectCommand(text) {
    const trimmed = text.trim();
    if (trimmed === 'h' || trimmed === '?') {
        return { name: 'help', arg: '' };
    }
    if (/^[.。\/]/.test(trimmed)) {
        const cmd = trimmed.slice(1).trim();
        const parts = cmd.split(/\s+/);
        const name = COMMAND_MAP[parts[0].toLowerCase()];
        if (name) {
            return { name, arg: parts.slice(1).join(' ') };
        }
    }
    return null;
}

export function parseMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return { type: 'default', prompt: '' };

    const detected = detectCommand(text);
    if (detected) {
        if (['oc', 'cc', 'cx', 'copilot'].includes(detected.name)) {
            const agentName = detected.name === 'cc' ? 'claude-code' :
                             detected.name === 'cx' ? 'codex' :
                             detected.name === 'copilot' ? 'copilot' : 'opencode';
            return { type: 'agent', agent: agentName, prompt: detected.arg };
        }
        return { type: 'command', command: detected.name, arg: detected.arg };
    }

    return { type: 'default', prompt: trimmed };
}

export async function routeMessage(parsed, ctx) {
    switch (parsed.type) {
        case 'command': {
            switch (parsed.command) {
                case 'help':
                    return `📖 指令

/start — 首次认证
/help h ? — 帮助
/status — 连接状态
/reset — 清空会话
/restart — 重启 bot
/sessions — 浏览会话
/loop — 循环任务
/edit — 编辑消息
/upload — 上传构建产物
/model — 切换模型

🤖 AI Agent:
/oc <提示> — OpenCode
/cc <提示> — Claude Code
/cx <提示> — Codex
/copilot <提示> — Copilot
/agents — 查看可用 Agent

💬 其他消息直接发给 AI!`;
                case 'agents': {
                    const agents = registry.listAgents();
                    const lines = ['🤖 可用 AI Agent:'];
                    for (const name of agents) {
                        const agent = registry.findAgent(name);
                        const aliases = agent?.aliases || [];
                        const available = await agent?.isAvailable().catch(() => false);
                        const status = available ? '✅' : '❌';
                        const aliasStr = aliases.length > 0 ? ` (${aliases.join(', ')})` : '';
                        lines.push(`${status} ${name}${aliasStr}`);
                    }
                    lines.push('');
                    lines.push('切换: /oc /cc /cx /copilot');
                    return lines.join('\n');
                }
                case 'status':
                    return '🔄 检查连接状态...';
                case 'start':
                    return '🚀 准备就绪，发送消息给 OpenCode 开始工作';
                case 'reset':
                case 'new':
                    return '🔄 会话已重置';
                case 'model':
                    return '🧠 用法: /model <provider/model>';
                default:
                    return '❓ 未知指令';
            }
        }
        case 'agent': {
            const agent = registry.findAgent(parsed.agent);
            if (!agent) return `❌ Agent "${parsed.agent}" 未找到`;
            const available = await agent.isAvailable().catch(() => false);
            if (!available) return `❌ ${parsed.agent} 不可用`;
            if (parsed.prompt) {
                const response = await agent.sendPrompt(ctx.threadId, parsed.prompt, []);
                return response || '无响应';
            }
            return `✅ 已切换到 ${parsed.agent}`;
        }
        default:
            return null;
    }
}
