// Message router - full command definitions shared across all platforms
import { registry } from './registry.js';
import { initOpenCode, listProviders, updateGlobalModel, checkConnection, resumeSession, shareSession } from '../opencode/client.js';

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
    refresh: ['refresh'],
    copy: ['copy'],
    revert: ['revert'],
    upload: ['upload'],
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

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
}

async function getSessionsList() {
    const opencode = await initOpenCode();
    if (!opencode) return null;
    const result = await opencode.client.session.list();
    if (result.error || !result.data) return [];
    return result.data.sort((a, b) => (b.time?.updated || b.updated_at || 0) - (a.time?.updated || a.updated_at || 0));
}

async function getSessionMessages(sessionId) {
    const opencode = await initOpenCode();
    if (!opencode) return null;
    const result = await opencode.client.session.messages({ path: { id: sessionId } });
    if (result.error) return null;
    return result.data || [];
}

export async function routeMessage(parsed, ctx) {
    switch (parsed.type) {
        case 'command': {
            switch (parsed.command) {
                case 'help':
                    return `📖 指令

🟢 常用:
/start — 首次认证
/help — 帮助
/status — 连接状态
/reset — 清空会话
/copy — 复制回复
/revert — 撤销消息

🔄 任务:
/loop — 循环执行
/refresh — 刷新上下文
/restart — 重启 bot
/stop — 停止 bot

📂 会话:
/sessions — 浏览会话
/delsessions — 删除会话

🤖 AI 模型:
/model — 切换模型
/agents — 查看可用 Agent
/oc — 使用 OpenCode
/cc — 使用 Claude Code

💬 直接发消息给 AI!`;

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

                case 'status': {
                    const connected = await checkConnection();
                    return `${connected ? '✅' : '❌'} OpenCode ${connected ? '在线' : '离线'}`;
                }

                case 'start':
                    return '🚀 准备就绪，发送消息给 OpenCode 开始工作';

                case 'reset':
                case 'new':
                    return '🔄 会话已重置';

                case 'restart':
                    return '🔄 重启信号已发送，bot 即将重启...';

                case 'stop':
                    return '🛑 停止信号已发送';

                case 'sessions': {
                    const sessions = await getSessionsList();
                    if (!sessions || sessions.length === 0) return '📭 暂无会话';
                    let msg = '📂 最近会话:\n\n';
                    sessions.slice(0, 10).forEach((s, i) => {
                        const title = s.title || '无标题';
                        const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                        msg += `${i + 1}. ${title} (${time})\n`;
                    });
                    return msg;
                }

                case 'delsessions': {
                    const sessions = await getSessionsList();
                    if (!sessions || sessions.length === 0) return '📭 暂无会话可删除';
                    let msg = '🗑️ 选择要删除的会话:\n\n';
                    sessions.slice(0, 10).forEach((s, i) => {
                        msg += `${i + 1}. ${s.title || '无标题'}\n`;
                    });
                    msg += '\n（在当前平台无法交互式选择，请使用 WeChat）';
                    return msg;
                }

                case 'loop':
                    if (parsed.arg === 'off' || parsed.arg === 'stop') return '⏹️ 循环任务已停止';
                    if (parsed.arg === 'status') return '🔄 循环任务状态（在微信中查看详情）';
                    return '🔄 循环任务已启动（完整控制请使用 WeChat）';

                case 'refresh': {
                    if (!ctx.opencodeSessionId) return '❌ 没有活跃的会话';
                    const opencode = await initOpenCode();
                    if (!opencode) return '❌ 无法连接 OpenCode';
                    try {
                        await opencode.client.session.compact({ path: { id: ctx.opencodeSessionId } });
                        const result = await opencode.client.session.summarize({ path: { id: ctx.opencodeSessionId } });
                        return result.error ? '⚠️ 压缩完成，但摘要生成失败' : '✅ 会话已刷新';
                    } catch (e) {
                        console.error('[refresh] Error:', e.message);
                        return `❌ 刷新失败: ${e.message}`;
                    }
                }

                case 'copy': {
                    if (!ctx.opencodeSessionId) return '❌ 没有活跃的会话';
                    const msgs = await getSessionMessages(ctx.opencodeSessionId);
                    if (!msgs || msgs.length === 0) return '❌ 无法获取消息';
                    const aiMsg = msgs.filter(m => m.info?.role === 'assistant').slice(-1)[0];
                    if (!aiMsg) return '❌ 未找到 AI 回复';
                    let content = '';
                    if (aiMsg.parts) {
                        for (const part of aiMsg.parts) {
                            if (part.type === 'text') content += part.text + '\n';
                            if (part.type === 'code') content += '```' + (part.language || '') + '\n' + part.code + '\n```\n';
                        }
                    }
                    return content ? `📋 最新回复:\n\n${content.substring(0, 2000)}` : '❌ 没有可复制的内容';
                }

                case 'revert': {
                    if (!ctx.opencodeSessionId) return '❌ 没有活跃的会话';
                    const opencode = await initOpenCode();
                    if (!opencode) return '❌ 无法连接 OpenCode';
                    if (parsed.arg === 'undo') {
                        const ok = await opencode.client.session.unrevert?.({ path: { id: ctx.opencodeSessionId } });
                        return ok ? '↩️ 已恢复撤销的内容' : '❌ 恢复失败';
                    }
                    const msgs = await getSessionMessages(ctx.opencodeSessionId);
                    if (!msgs) return '❌ 无法获取消息';
                    const lastAssistant = msgs.filter(m => m.info?.role === 'assistant' && m.time?.created).slice(-1)[0];
                    if (!lastAssistant) return '📭 没有可撤销的消息';
                    const ok = await opencode.client.session.revert({ path: { id: ctx.opencodeSessionId }, body: { messageID: lastAssistant.id } });
                    return ok ? '↩️ 已撤销最近的消息' : '❌ 撤销失败';
                }

                case 'model': {
                    try {
                        if (parsed.arg) {
                            const modelStr = parsed.arg.trim();
                            const ok = await updateGlobalModel(modelStr);
                            return ok ? `✅ 已切换模型至: ${modelStr}` : '❌ 切换失败';
                        }
                        const providers = await listProviders();
                        if (!providers || providers.length === 0) return '❌ 无法获取模型列表';
                        let msg = '🧠 可用模型:\n\n';
                        for (const p of providers) {
                            const modelIds = Object.keys(p.models || {});
                            if (modelIds.length === 0) continue;
                            msg += `${p.name} (${p.id}):\n`;
                            for (const mid of modelIds.slice(0, 5)) {
                                msg += `  ${p.id}/${mid}\n`;
                            }
                            if (modelIds.length > 5) msg += `  ...还有 ${modelIds.length - 5} 个\n`;
                        }
                        msg += '\n用法: /model <provider/model>';
                        return msg;
                    } catch (e) {
                        return `❌ 模型操作失败: ${e.message}`;
                    }
                }

                case 'upload':
                case 'edit':
                    return '❌ 当前平台不支持此命令';

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
