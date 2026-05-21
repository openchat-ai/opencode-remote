// Feishu bot implementation for OpenCode Remote Control
// Uses WebSocket long connection mode - no tunnel/ngrok required!
import * as lark from '@larksuiteoapi/node-sdk';
import { initSessionManager, getOrCreateSession, sessionManager, saveSessionMapping, getThreadsBySessionIdFromMapping } from '../core/session.js';
import { splitMessage } from '../core/notifications.js';
import { EMOJI } from '../core/types.js';
import { initOpenCode, createSession, sendMessage, checkConnection, abortSession, resumeSession, shareSession, revertSessionMessage, unrevertSession, listProviders, updateGlobalModel } from '../opencode/client.js';
import { isAuthorized, hasOwner, claimOwnership, getAuthStatus } from '../core/auth.js';
import { detectCommand, COMMAND_ALIASES } from '../core/router.js';
import { registry } from '../core/registry.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
let feishuClient = null;
let wsClient = null;
let config = null;
let openCodeSessions = null;
// Map Feishu event to shared MessageContext
function feishuEventToContext(event) {
    return {
        platform: 'feishu',
        threadId: `feishu:${event.message.chat_id}`,
        userId: event.sender?.sender_id?.user_id || 'unknown',
        messageId: event.message.message_id,
    };
}
// BotAdapter implementation for Feishu
function createFeishuAdapter(client) {
    return {
        async reply(threadId, text) {
            const chatId = threadId.replace('feishu:', '');
            try {
                const result = await client.im.message.create({
                    params: { receive_id_type: 'chat_id' },
                    data: {
                        receive_id: chatId,
                        msg_type: 'text',
                        content: JSON.stringify({ text }),
                    },
                });
                return result.data?.message_id || '';
            }
            catch (error) {
                console.error('发送飞书消息失败:', error);
                throw error;
            }
        },
        async sendTypingIndicator(threadId) {
            const chatId = threadId.replace('feishu:', '');
            try {
                const result = await client.im.message.create({
                    params: { receive_id_type: 'chat_id' },
                    data: {
                        receive_id: chatId,
                        msg_type: 'text',
                        content: JSON.stringify({ text: '⏳ 思考中...' }),
                    },
                });
                return result.data?.message_id || '';
            }
            catch (error) {
                console.error('发送思考指示失败:', error);
                return '';
            }
        },
        async updateMessage(threadId, messageId, text) {
            if (!messageId)
                return;
            try {
                await client.im.message.patch({
                    path: { message_id: messageId },
                    data: {
                        content: JSON.stringify({ text }),
                    },
                });
            }
            catch (error) {
                console.warn('更新消息失败:', error);
            }
        },
        async deleteMessage(threadId, messageId) {
            if (!messageId)
                return;
            try {
                await client.im.message.delete({
                    path: { message_id: messageId },
                });
            }
            catch (error) {
                console.warn('删除消息失败:', error);
            }
        },
    };
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
// Auto-flush memory after tool activity
const lastFlushTime = new Map();
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
async function autoFlush(adapter, threadId, session) {
    const lastFlush = lastFlushTime.get(threadId) || 0;
    const now = Date.now();
    if (now - lastFlush < FLUSH_INTERVAL_MS) return;
    if (!session.opencodeSessionId) return;
    const ocSession = openCodeSessions?.get(threadId);
    if (!ocSession) return;
    const projectDir = session.projectDir || globalThis.__autoProjectDir;
    if (!projectDir) return;
    try {
        const { flushMemory } = await import('../weixin/flush.js');
        lastFlushTime.set(threadId, now);
        const result = await flushMemory(projectDir, session, ocSession);
        if (result.learned) {
            console.log(`[auto-flush] ${result.learned}`);
        } else {
            console.log(`[auto-flush] ${result.summary.split('\n')[0]}`);
        }
    } catch (e) {
        console.warn(`[auto-flush] 失败: ${e.message}`);
    }
}
// Load memory context from MEMORY.md
function loadMemoryContext(projectRoot) {
    const paths = [
        join(projectRoot, 'MEMORY.md'),
        join(projectRoot, '..', 'MEMORY.md'),
        join(projectRoot, '..', '..', 'MEMORY.md'),
    ];
    for (const memoryPath of paths) {
        if (existsSync(memoryPath)) {
            try {
                const content = readFileSync(memoryPath, 'utf-8');
                const lines = content.split('\n');
                const insights = [];
                let inInsights = false;
                for (const line of lines) {
                    if (line.startsWith('## 经验教训')) {
                        inInsights = true;
                        continue;
                    }
                    if (inInsights) {
                        if (line.startsWith('## ') || line.startsWith('# ')) {
                            break;
                        }
                        if (line.trim().startsWith('- [')) {
                            insights.push(line.trim());
                        }
                    }
                }
                if (insights.length > 0) {
                    return `【项目记忆 - 经验教训】\n${insights.slice(-10).join('\n')}`;
                }
            } catch (e) {
                console.warn(`[memory] 加载失败: ${e.message}`);
            }
            break;
        }
    }
    return null;
}
// Command handler (mirrors WeChat bot structure)
async function handleCommand(adapter, ctx, parsed) {
    const session = await getOrCreateSession(ctx.threadId, 'feishu');
    const { name: command, arg } = parsed;
    switch (command) {
        case 'start': {
            const result = claimOwnership('feishu', ctx.userId);
            if (result.success) {
                if (result.message === 'claimed') {
                    await adapter.reply(ctx.threadId, `🔐 **安全设置完成！**

✅ 你是此 bot 的唯一所有者。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  **重要安全通知**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

只有你可以通过此 bot 控制 OpenCode。
其他用户将被自动屏蔽。

你的飞书 ID: \`${ctx.userId}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **准备就绪！**
💬 发送提示词开始编程
/help — 查看所有指令
/status — 查看连接状态`);
                }
                else {
                    await adapter.reply(ctx.threadId, `🚀 OpenCode 远程控制就绪

💬 发送消息给 OpenCode 开始工作
/help — 查看所有指令
/status — 查看连接状态

指令:
/start — 首次认证
/status — 查看连接
/reset — 重置会话
/approve — 同意变更
/reject — 拒绝变更
/diff — 查看变更
/files — 查看文件
/retry — 重试连接

💬 其他消息直接发送给 OpenCode！`);
                }
            }
            else {
                await adapter.reply(ctx.threadId, `🚫 **拒绝访问**

此 bot 已被其他用户绑定。

如果你是所有者，请检查配置文件。`);
            }
            return true;
        }
        case 'help':
            await adapter.reply(ctx.threadId, `📖 指令

/start — 首次认证
/help h ? — 帮助
/status — 连接状态
/reset — 清空会话
/restart — 重启 bot
/stop — 停止 bot
/retry — 重试连接
/approve .a .y .1 — 同意变更
/reject .r .n .0 — 拒绝变更
/diff — 查看变更
/files — 已修改文件
/sessions — 浏览会话
/delsessions — 删除会话
/loop — 循环任务
/summary — 会话摘要
/compact — 压缩会话上下文
/copy — 复制最新 AI 回复
/revert — 撤销 AI 回复
/switchdir — 切换项目目录
/scope — 设置上下文范围
/analyze — 分析后执行
/commit — 生成提交信息
/review — 代码审查
/flush — 刷新记忆

🤖 AI Agent:
/oc <提示> — 使用 OpenCode
/cc <提示> — 使用 Claude Code
/cx <提示> — 使用 Codex
/copilot <提示> — 使用 Copilot
/agents — 查看可用 Agent

🧠 模型:
/model — 查看当前模型
/model <provider/model> — 切换模型

⬆️ 上传（仅微信可用）:
/upload — 上传安装包
/delete <key> — 删除文件

💬 其他消息直接发送给 OpenCode！`);
            return true;
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
            await adapter.reply(ctx.threadId, lines.join('\n'));
            return true;
        }
        case 'model': {
            try {
                if (arg) {
                    const modelStr = arg.trim();
                    const ok = await updateGlobalModel(modelStr);
                    if (ok) {
                        const parts = modelStr.split('/');
                        if (parts.length === 2) {
                            session.modelOverride = { providerID: parts[0], modelID: parts[1] };
                        }
                        await adapter.reply(ctx.threadId, `✅ 已切换模型至: ${modelStr}`);
                    } else {
                        await adapter.reply(ctx.threadId, '❌ 切换模型失败，请检查模型名称是否正确');
                    }
                    return true;
                }
                const providers = await listProviders();
                if (!providers || providers.length === 0) {
                    await adapter.reply(ctx.threadId, '❌ 无法获取模型列表');
                    return true;
                }
                let msg = '🧠 可用模型:\n\n';
                for (const p of providers) {
                    const modelIds = Object.keys(p.models || {});
                    if (modelIds.length === 0) continue;
                    msg += `${p.name} (${p.id}):\n`;
                    for (const mid of modelIds.slice(0, 5)) {
                        msg += `  ${p.id}/${mid}\n`;
                    }
                    if (modelIds.length > 5) msg += `  ...还有 ${modelIds.length - 5} 个\n`;
                    msg += '\n';
                }
                msg += '用法: /model <provider/model>';
                const msgs = splitMessage(msg);
                for (const m of msgs) {
                    await adapter.reply(ctx.threadId, m);
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 模型操作失败: ${e.message}`);
            }
            return true;
        }
        case 'oc':
        case 'cc':
        case 'cx':
        case 'copilot': {
            const agentName = command === 'cc' ? 'claude-code' : command === 'cx' ? 'codex' : command === 'copilot' ? 'copilot' : 'opencode';
            const agent = registry.findAgent(agentName);
            if (!agent) {
                await adapter.reply(ctx.threadId, `❌ Agent "${agentName}" 未找到`);
                return true;
            }
            const available = await agent.isAvailable().catch(() => false);
            if (!available) {
                await adapter.reply(ctx.threadId, `❌ ${agentName} 不可用`);
                return true;
            }
            session.currentAgent = agentName;
            if (!arg) {
                await adapter.reply(ctx.threadId, `✅ 已切换到 ${agentName}`);
                return true;
            }
            await adapter.sendTypingIndicator(ctx.threadId);
            try {
                const history = session.commandHistory || [];
                const response = await agent.sendPrompt(session.id, arg, history, { projectDir: session.projectDir || globalThis.__autoProjectDir });
                await adapter.sendTypingIndicator(ctx.threadId);
                const chunks = splitMessage(response || '无响应');
                for (const chunk of chunks) {
                    await adapter.reply(ctx.threadId, chunk);
                }
                session.commandHistory = session.commandHistory || [];
                session.commandHistory.push({ role: 'user', content: arg });
                session.commandHistory.push({ role: 'assistant', content: response });
            } catch (error) {
                await adapter.sendTypingIndicator(ctx.threadId);
                await adapter.reply(ctx.threadId, `❌ 错误: ${error.message}`);
            }
            return true;
        }
        case 'approve': {
            const pending = session.pendingApprovals?.[0];
            if (!pending) {
                await adapter.reply(ctx.threadId, '🤷 没有待审批的变更');
                return true;
            }
            await adapter.reply(ctx.threadId, '✅ 已批准');
            return true;
        }
        case 'reject': {
            const pending = session.pendingApprovals?.[0];
            if (!pending) {
                await adapter.reply(ctx.threadId, '🤷 没有待拒绝的变更');
                return true;
            }
            session.pendingApprovals.shift();
            await adapter.reply(ctx.threadId, '❌ 已拒绝');
            return true;
        }
        case 'diff': {
            const pending = session.pendingApprovals?.[0];
            if (!pending || !pending.files?.length) {
                await adapter.reply(ctx.threadId, '📄 没有待显示的变更');
                return true;
            }
            const diffPreview = pending.files.map(f => `--- a/${f.path}\n+++ b/${f.path}\n@@ 变更 +${f.additions} -${f.deletions} @@`).join('\n');
            const messages = splitMessage(`\`\`\`diff\n${diffPreview}\n\`\`\``);
            for (const msg of messages) {
                await adapter.reply(ctx.threadId, msg);
            }
            return true;
        }
        case 'files': {
            const pending = session.pendingApprovals?.[0];
            if (!pending || !pending.files?.length) {
                await adapter.reply(ctx.threadId, '📄 此会话没有文件变更');
                return true;
            }
            const fileList = pending.files.map(f => `• ${f.path} (+${f.additions}, -${f.deletions})`).join('\n');
            await adapter.reply(ctx.threadId, `📄 已修改文件:\n${fileList}`);
            return true;
        }
        case 'status': {
            const openCodeConnected = await checkConnection();
            const actualSession = openCodeSessions?.get(ctx.threadId) ||
                                 (session.opencodeSessionId ? { sessionId: session.opencodeSessionId } : null);
            const running = session.taskStartTime ? Math.round((Date.now() - session.taskStartTime) / 1000) : 0;
            let msg = `${openCodeConnected ? '✅' : '❌'} OpenCode ${openCodeConnected ? '在线' : '离线'}\n\n`;
            msg += `会话: ${actualSession?.sessionId?.slice(0, 8) || '无'}\n`;
            if (running > 0) {
                const m = Math.floor(running / 60);
                const s = running % 60;
                msg += `运行中: ${m}分${s}秒\n`;
            }
            if (session.currentTool) {
                msg += `当前工具: ${session.currentTool}\n`;
            }
            if (session.modifiedFiles?.length > 0 || session.modifiedFiles?.size > 0) {
                msg += `已修改: ${(session.modifiedFiles?.length || session.modifiedFiles?.size || 0)} 个文件\n`;
            }
            const projectDir = session.projectDir || globalThis.__autoProjectDir;
            if (projectDir) {
                msg += `项目目录: ${projectDir}\n`;
            } else {
                msg += `项目目录: 未设置\n`;
            }
            msg += `工作目录: ${process.cwd()}\n`;
            if (session.originalProjectDir && session.originalProjectDir !== projectDir) {
                msg += `原始目录: ${session.originalProjectDir}\n`;
            }
            await adapter.reply(ctx.threadId, msg);
            return true;
        }
        case 'reset': {
            const oldSession = openCodeSessions?.get(ctx.threadId);
            if (oldSession) {
                abortSession(oldSession).catch(() => {});
            }
            session.pendingApprovals = [];
            session.opencodeSessionId = undefined;
            session.loopMode = false;
            session.loopPrompt = null;
            session.projectDir = null;
            session.currentAgent = null;
            session.messages = [];
            session.commandHistory = [];
            session.taskStartTime = null;
            session.currentTool = null;
            session.modifiedFiles = null;
            session.lastUserMessage = null;
            session._lastPrompt = null;
            session._contextScope = null;
            session.originalProjectDir = null;
            session._switchSessionList = null;
            session._deleteSessionList = null;
            session._pendingSwitchSession = null;
            session._editTarget = null;
            session._editList = null;
            session._editSessionId = null;
            session._historyList = null;
            session._forkList = null;
            session._forkSessionId = null;
            session._analyzeMode = false;
            session._analyzeTask = null;
            session._showSessionState = null;
            openCodeSessions?.delete(ctx.threadId);
            globalThis.__latestOpenCodeSession = null;
            await adapter.reply(ctx.threadId, '🔄 会话已重置，下次发送消息将创建新会话');
            return true;
        }
        case 'retry': {
            const connected = await checkConnection();
            if (connected) {
                await adapter.reply(ctx.threadId, '✅ OpenCode 已在线！');
            } else {
                await adapter.reply(ctx.threadId, '❌ 仍离线，请检查 OpenCode 是否运行中');
            }
            return true;
        }
        case 'sessions': {
            try {
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const result = await opencode.client.session.list();
                if (result.error || !result.data || result.data.length === 0) {
                    await adapter.reply(ctx.threadId, '📭 暂无会话');
                    return true;
                }
                const sorted = result.data.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
                session._switchSessionList = sorted;
                session._showSessionState = true;
                let msg = '📂 选择会话（回复编号）：\n\n';
                sorted.slice(0, 10).forEach((s, i) => {
                    const n = i + 1;
                    const title = s.title || '无标题';
                    const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                    msg += `${n}. ${title} (${time})\n`;
                });
                if (sorted.length > 10) {
                    msg += `\n... 共 ${sorted.length} 个会话`;
                }
                msg += '\n\n回复编号切换会话';
                await adapter.reply(ctx.threadId, msg);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 获取会话失败: ${e.message}`);
            }
            return true;
        }
        case 'delsessions': {
            try {
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const result = await opencode.client.session.list();
                if (result.error || !result.data || result.data.length === 0) {
                    await adapter.reply(ctx.threadId, '📭 暂无会话可删除');
                    return true;
                }
                const sorted = result.data.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
                session._deleteSessionList = sorted;
                let msg = '🗑️ 选择要删除的会话（回复编号）：\n\n';
                sorted.slice(0, 10).forEach((s, i) => {
                    const n = i + 1;
                    const title = s.title || '无标题';
                    const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                    msg += `${n}. ${title} (${time})\n`;
                });
                if (sorted.length > 10) {
                    msg += `\n... 共 ${sorted.length} 个会话`;
                }
                msg += '\n\n回复编号删除';
                await adapter.reply(ctx.threadId, msg);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 获取会话失败: ${e.message}`);
            }
            return true;
        }
        case 'loop': {
            const argText = arg || '';
            if (argText === 'off' || argText === 'stop') {
                session.loopMode = false;
                session.loopPrompt = null;
                session.loopIterationCount = 0;
                session.loopStartTime = null;
                await adapter.reply(ctx.threadId, '⏹️ 循环任务已停止');
                return true;
            }
            if (argText === 'status') {
                if (session.loopMode) {
                    const elapsed = session.loopStartTime
                        ? `已运行: ${Math.floor((Date.now() - session.loopStartTime) / 60000)}分钟`
                        : '';
                    const count = session.loopIterationCount || 0;
                    const limit = session.loopMaxIterations || 10;
                    await adapter.reply(ctx.threadId, `🔄 循环任务运行中\n指令: ${session.loopPrompt || '智能模式'}\n迭代: ${count}/${limit} ${elapsed}`);
                } else {
                    await adapter.reply(ctx.threadId, '⏹️ 循环任务未运行\n发送 /loop 开始');
                }
                return true;
            }
            session.loopMode = true;
            session.loopPrompt = argText || null;
            session.lastLoopTime = Date.now();
            session.loopStartTime = Date.now();
            session.loopIterationCount = 0;
            session.loopMaxIterations = 10;
            session.loopMaxTimeMs = 30 * 60 * 1000;
            const modeDesc = argText ? `指令: ${argText}` : '智能模式（根据上下文自动生成指令）';
            await adapter.reply(ctx.threadId, `🔄 循环任务已启动\n${modeDesc}\n限制: 最多10次迭代或30分钟\n\n发送 /loop off 停止`);
            return true;
        }
        case 'upload': {
            await adapter.reply(ctx.threadId, 'ℹ️ 上传功能目前仅在微信客户端可用。\n请使用微信客户端上传文件。');
            return true;
        }
        case 'delete': {
            await adapter.reply(ctx.threadId, 'ℹ️ 删除功能目前仅在微信客户端可用。\n请使用微信客户端管理上传文件。');
            return true;
        }
        case 'restart': {
            console.log('[feishu-bot] restart command received');
            await adapter.reply(ctx.threadId, '🔄 正在重启 bot...');
            const remoteDir = join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.opencode-remote');
            if (!existsSync(remoteDir)) {
                mkdirSync(remoteDir, { recursive: true });
            }
            const restartInfo = { threadId: ctx.threadId, time: Date.now() };
            writeFileSync(join(remoteDir, '.restart_user.json'), JSON.stringify(restartInfo));
            await new Promise(r => setTimeout(r, 500));
            console.log('[feishu-bot] about to exit with code 200');
            process.exit(200);
            return true;
        }
        case 'stop': {
            await adapter.reply(ctx.threadId, '🛑 正在停止 bot...');
            setTimeout(() => {
                if (globalThis.__feishuBotShutdown) {
                    globalThis.__feishuBotShutdown(false);
                }
                setTimeout(() => process.exit(0), 1000);
            }, 500);
            return true;
        }
        case 'compact': {
            const ocSession = openCodeSessions?.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            try {
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const result = await opencode.client.session.compact({ path: { id: ocSession.sessionId } });
                if (result.error) {
                    await adapter.reply(ctx.threadId, `❌ 压缩失败: ${result.error}`);
                } else {
                    await adapter.reply(ctx.threadId, '✅ 会话已压缩');
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 压缩失败: ${e.message}`);
            }
            return true;
        }
        case 'summary': {
            const ocSession = openCodeSessions?.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            await adapter.reply(ctx.threadId, '📋 正在生成摘要...');
            try {
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const result = await opencode.client.session.summarize({
                    path: { id: ocSession.sessionId }
                });
                if (result.error) {
                    await adapter.reply(ctx.threadId, `❌ 生成摘要失败: ${result.error}`);
                } else {
                    const msgsResult = await opencode.client.session.messages({
                        path: { id: ocSession.sessionId },
                        query: { limit: 1 }
                    });
                    if (msgsResult.data?.[0]?.parts) {
                        const textParts = msgsResult.data[0].parts.filter(p => p.type === 'text');
                        const summaryText = textParts.map(p => p.text).join('\n');
                        if (summaryText) {
                            await adapter.reply(ctx.threadId, `📋 会话摘要\n\n${summaryText}`);
                        } else {
                            await adapter.reply(ctx.threadId, '✅ 摘要生成成功');
                        }
                    } else {
                        await adapter.reply(ctx.threadId, '✅ 摘要生成成功');
                    }
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 生成摘要失败: ${e.message}`);
            }
            return true;
        }
        case 'commit': {
            try {
                const { execSync } = await import('child_process');
                const projectDir = session.projectDir || globalThis.__autoProjectDir;
                if (!projectDir) {
                    await adapter.reply(ctx.threadId, '❌ 未设置项目目录，请先使用 /switchdir 设置');
                    return true;
                }
                const diffOutput = execSync('git diff --cached', { cwd: projectDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
                if (!diffOutput) {
                    await adapter.reply(ctx.threadId, '📭 暂存区没有变更');
                    return true;
                }
                await adapter.reply(ctx.threadId, '📋 正在生成提交信息...');
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const commitSession = await createSession(`commit-${Date.now()}`, 'commit');
                if (!commitSession) {
                    await adapter.reply(ctx.threadId, '❌ 无法创建会话');
                    return true;
                }
                const commitPrompt = `根据以下 git diff 生成一个简洁的提交信息（一行标题 + 可选描述）:\n\n${diffOutput.slice(0, 4000)}`;
                const response = await sendMessage(commitSession, commitPrompt, {});
                if (response) {
                    const commitMsg = response.trim().split('\n')[0].replace(/^`+|`+$/g, '');
                    await adapter.reply(ctx.threadId, `💬 建议的提交信息:\n\n${commitMsg}\n\n若要提交，请在终端运行:\ngit commit -m "${commitMsg}"`);
                } else {
                    await adapter.reply(ctx.threadId, '❌ 生成提交信息失败');
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 生成提交信息失败: ${e.message}`);
            }
            return true;
        }
        case 'review': {
            try {
                const { execSync } = await import('child_process');
                const projectDir = session.projectDir || globalThis.__autoProjectDir;
                if (!projectDir) {
                    await adapter.reply(ctx.threadId, '❌ 未设置项目目录，请先使用 /switchdir 设置');
                    return true;
                }
                const diffOutput = execSync('git diff --cached', { cwd: projectDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).trim();
                if (!diffOutput) {
                    await adapter.reply(ctx.threadId, '📭 暂存区没有变更');
                    return true;
                }
                await adapter.reply(ctx.threadId, '🔍 正在审查代码...');
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const reviewSession = await createSession(`review-${Date.now()}`, 'review');
                if (!reviewSession) {
                    await adapter.reply(ctx.threadId, '❌ 无法创建会话');
                    return true;
                }
                const reviewPrompt = `请审查以下 git diff，关注安全问题、性能问题、逻辑错误:\n\n${diffOutput.slice(0, 4000)}`;
                const response = await sendMessage(reviewSession, reviewPrompt, {});
                if (response) {
                    const msgs = splitMessage(response);
                    for (const m of msgs) {
                        await adapter.reply(ctx.threadId, m);
                    }
                } else {
                    await adapter.reply(ctx.threadId, '❌ 审查失败');
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 审查失败: ${e.message}`);
            }
            return true;
        }
        case 'copy': {
            const ocSession = openCodeSessions?.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            try {
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const msgsResult = await opencode.client.session.messages({
                    path: { id: ocSession.sessionId },
                    query: { limit: 1 }
                });
                if (msgsResult.error || !msgsResult.data || msgsResult.data.length === 0) {
                    await adapter.reply(ctx.threadId, '❌ 无法获取最新消息');
                    return true;
                }
                let latestMsg = msgsResult.data[0];
                if (latestMsg.info?.role !== 'assistant') {
                    const allMsgsResult = await opencode.client.session.messages({
                        path: { id: ocSession.sessionId },
                        query: { limit: 10 }
                    });
                    if (allMsgsResult.error || !allMsgsResult.data) {
                        await adapter.reply(ctx.threadId, '❌ 无法获取会话消息');
                        return true;
                    }
                    const aiMsg = allMsgsResult.data.find(m => m.info?.role === 'assistant');
                    if (!aiMsg) {
                        await adapter.reply(ctx.threadId, '❌ 未找到 AI 回复');
                        return true;
                    }
                    latestMsg = aiMsg;
                }
                let content = '';
                if (latestMsg.parts) {
                    for (const part of latestMsg.parts) {
                        if (part.type === 'text') {
                            content += part.text + '\n';
                        }
                        if (part.type === 'code') {
                            content += `\`\`\`${part.language || ''}\n${part.code}\n\`\`\`\n`;
                        }
                        if (part.type === 'file' && part.content) {
                            content += `📁 ${part.filename}:\n${part.content}\n`;
                        }
                    }
                }
                if (!content.trim()) {
                    await adapter.reply(ctx.threadId, '❌ AI 回复中没有可复制的文本内容');
                    return true;
                }
                await adapter.reply(ctx.threadId, `📋 已复制最新 AI 回复内容:\n\n${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}`);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 复制失败: ${e.message}`);
            }
            return true;
        }
        case 'revert': {
            const ocS = openCodeSessions?.get(ctx.threadId);
            if (!ocS) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            try {
                if (arg === 'undo') {
                    const ok = await unrevertSession(ocS.sessionId);
                    if (ok) {
                        await adapter.reply(ctx.threadId, '↩️ 已恢复撤销的内容');
                    } else {
                        await adapter.reply(ctx.threadId, '❌ 恢复失败');
                    }
                    return true;
                }
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                const msgsResult = await opencode.client.session.messages({ path: { id: ocS.sessionId } });
                if (msgsResult.error || !msgsResult.data) {
                    await adapter.reply(ctx.threadId, '❌ 无法获取消息');
                    return true;
                }
                const assistantMsgs = msgsResult.data.filter(m => m.info?.role === 'assistant' && m.time?.created);
                if (assistantMsgs.length === 0) {
                    await adapter.reply(ctx.threadId, '📭 没有可撤销的消息');
                    return true;
                }
                const lastMsg = assistantMsgs[assistantMsgs.length - 1];
                const ok = await revertSessionMessage(ocS.sessionId, lastMsg.id);
                if (ok) {
                    const preview = lastMsg.info?.content?.slice(0, 100) || '(无内容)';
                    await adapter.reply(ctx.threadId, `↩️ 已撤销最近的消息\n\n${preview}\n\n发送 /revert undo 恢复`);
                } else {
                    await adapter.reply(ctx.threadId, '❌ 撤销失败');
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 撤销失败: ${e.message}`);
            }
            return true;
        }
        case 'switchdir': {
            if (arg) {
                if (!session.originalProjectDir && session.projectDir) {
                    session.originalProjectDir = session.projectDir;
                }
                const newPath = arg.trim();
                session.projectDir = newPath;
                globalThis.__autoProjectDir = newPath;
                await adapter.reply(ctx.threadId, `✅ 项目目录已切换至: ${newPath}`);
            } else {
                await adapter.reply(ctx.threadId, '❌ 请提供目录路径，例如: /switchdir C:\\path\\to\\project');
            }
            return true;
        }
        case 'scope': {
            if (arg) {
                session._contextScope = arg.trim();
                await adapter.reply(ctx.threadId, `✅ 上下文范围已设为: ${session._contextScope}\n后续消息将自动附加范围信息。`);
            } else {
                session._contextScope = null;
                await adapter.reply(ctx.threadId, '✅ 上下文范围已清除');
            }
            return true;
        }
        case 'analyze': {
            if (arg) {
                session._analyzeMode = true;
                session._analyzeTask = arg.trim();
                await adapter.reply(ctx.threadId, `🔍 分析模式已开启\n\n任务: ${arg.trim()}\n\n回复 "执行" 或 "execute" 开始施工，回复其他内容取消。\n\n分析后 AI 将执行最小改动，完成后列出变更点和验证步骤。`);
            } else {
                await adapter.reply(ctx.threadId, '❌ 请提供要分析的任务描述\n用法: /analyze <任务描述>\n\n示例: /analyze 修复登录页面按钮点击无响应的问题');
            }
            return true;
        }
        case 'flush': {
            const ocSession = openCodeSessions?.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            const projectDir = session.projectDir || globalThis.__autoProjectDir;
            if (!projectDir) {
                await adapter.reply(ctx.threadId, '❌ 未设置项目目录\n请先使用 /switchdir 设置项目目录');
                return true;
            }
            await adapter.reply(ctx.threadId, '🧠 正在刷新记忆...');
            try {
                const { flushMemory } = await import('../weixin/flush.js');
                const result = await flushMemory(projectDir, session, ocSession);
                await adapter.reply(ctx.threadId, result.summary || '✅ 记忆刷新完成');
                if (result.learned) {
                    console.log(`[flush] ${result.learned}`);
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ flush 失败: ${e.message}`);
            }
            return true;
        }
        default:
            await adapter.reply(ctx.threadId, `${EMOJI.WARNING} 未知指令: ${command}\n\n请发送 /help 查看可用指令`);
            return true;
    }
}
// Enhanced message handling with forwardToOpenCode
async function handleMessage(adapter, ctx, text) {
    const session = await getOrCreateSession(ctx.threadId, 'feishu');
    // Check if it's a command
    const parsed = detectCommand(text);
    if (parsed) {
        await handleCommand(adapter, ctx, parsed);
        return;
    }
    const trimmed = text.trim();
    // Delete session interactive flow
    if (session._deleteSessionList) {
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            const list = session._deleteSessionList;
            if (num >= 1 && num <= list.length) {
                const target = list[num - 1];
                try {
                    const opencode = await initOpenCode();
                    if (!opencode) { await adapter.reply(ctx.threadId, '❌ 无法删除会话'); return; }
                    await opencode.client.session.delete({ path: { id: target.id } });
                    if (session.opencodeSessionId === target.id) {
                        openCodeSessions.delete(ctx.threadId);
                        session.opencodeSessionId = undefined;
                    }
                    const result = await opencode.client.session.list();
                    if (!result.error && result.data && result.data.length > 0) {
                        const sorted = result.data.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
                        session._deleteSessionList = sorted;
                        let msg = `🗑️ 已删除: ${target.title || '无标题'}\n\n📂 选择要删除的会话（回复编号）：\n\n`;
                        sorted.slice(0, 10).forEach((s, i) => {
                            const n = i + 1;
                            msg += `${n}. ${s.title || '无标题'} (${s.updated_at ? formatTimeAgo(s.updated_at * 1000) : ''})\n`;
                        });
                        if (sorted.length > 10) msg += `\n... 共 ${sorted.length} 个会话`;
                        msg += '\n\n回复编号删除';
                        for (const m of splitMessage(msg)) await adapter.reply(ctx.threadId, m);
                    } else {
                        session._deleteSessionList = null;
                        await adapter.reply(ctx.threadId, `🗑️ 已删除: ${target.title || '无标题'}\n📭 没有更多会话了`);
                    }
                } catch (e) {
                    await adapter.reply(ctx.threadId, `❌ 删除失败: ${e.message}`);
                }
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._deleteSessionList.length}`);
            }
            return;
        }
        session._deleteSessionList = null;
    }
    // Switch session interactive flow
    if (session._switchSessionList) {
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            const list = session._switchSessionList;
            if (num >= 1 && num <= list.length) {
                const target = list[num - 1];
                if (session._showSessionState) {
                    session._showSessionState = null;
                    session._pendingSwitchSession = target;
                    const targetDir = target.directory || process.cwd();
                    let stateMsg = `📋 会话: ${target.title || '无标题'}\n`;
                    stateMsg += `ID: ${target.id.slice(0, 8)}...\n`;
                    if (target.directory) stateMsg += `📁 目录: ${target.directory}\n`;
                    stateMsg += '\n';
                    try {
                        const memoryPath = join(targetDir, 'MEMORY.md');
                        if (existsSync(memoryPath)) {
                            const content = readFileSync(memoryPath, 'utf-8');
                            const summaryMatch = content.match(/## 最近会话摘要\n([\s\S]*?)(?=##|$)/);
                            if (summaryMatch) {
                                const lines = summaryMatch[1].trim().split('\n').filter(l => l.trim());
                                const recent = lines.slice(-3);
                                if (recent.length > 0) {
                                    stateMsg += `📝 最近会话:\n${recent.map(l => `  ${l.trim()}`).join('\n')}\n\n`;
                                }
                            }
                        }
                    } catch { console.debug('[session-switch] 无法读取MEMORY.md'); }
                    stateMsg += `💡 回复 "确认" 切换到此会话，或回复其他内容取消`;
                    await adapter.reply(ctx.threadId, stateMsg);
                    return;
                }
                try {
                    const resumed = await resumeSession(target.id);
                    if (resumed) {
                        openCodeSessions.set(ctx.threadId, resumed);
                        session.opencodeSessionId = resumed.sessionId;
                        session.taskStartTime = null;
                        session.currentTool = null;
                        session.modifiedFiles = null;
                        if (target.directory) {
                            session.projectDir = target.directory;
                            globalThis.__autoProjectDir = target.directory;
                            const memoryPath = join(target.directory, 'MEMORY.md');
                            if (!existsSync(memoryPath)) {
                                try {
                                    const { initMemorySystem } = await import('../weixin/init-memory.js');
                                    await initMemorySystem(target.directory);
                                } catch { console.debug('[session-switch] 自动初始化记忆失败'); }
                            }
                        }
                        await adapter.reply(ctx.threadId, `✅ 已切换至: ${target.title || '无标题'}\nID: ${resumed.sessionId.slice(0, 8)}...`);
                    } else {
                        await adapter.reply(ctx.threadId, '❌ 切换失败');
                    }
                } catch (e) {
                    await adapter.reply(ctx.threadId, `❌ 切换失败: ${e.message}`);
                }
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._switchSessionList.length}`);
            }
            session._switchSessionList = null;
            session._showSessionState = null;
            session._pendingSwitchSession = null;
            return;
        }
        session._switchSessionList = null;
        session._showSessionState = null;
        session._pendingSwitchSession = null;
    }
    // Pending switch confirmation
    if (session._pendingSwitchSession) {
        const confirm = trimmed.toLowerCase();
        const target = session._pendingSwitchSession;
        session._pendingSwitchSession = null;
        if (confirm === '确认' || confirm === 'confirm' || confirm === 'y' || confirm === '1') {
            try {
                const resumed = await resumeSession(target.id);
                if (resumed) {
                    openCodeSessions.set(ctx.threadId, resumed);
                    session.opencodeSessionId = resumed.sessionId;
                    session.taskStartTime = null;
                    session.currentTool = null;
                    session.modifiedFiles = null;
                    if (target.directory) {
                        session.projectDir = target.directory;
                        globalThis.__autoProjectDir = target.directory;
                        const memoryPath = join(target.directory, 'MEMORY.md');
                        if (!existsSync(memoryPath)) {
                            try {
                                const { initMemorySystem } = await import('../weixin/init-memory.js');
                                await initMemorySystem(target.directory);
                            } catch { console.debug('[session-switch] 自动初始化记忆失败'); }
                        }
                    }
                    await adapter.reply(ctx.threadId, `✅ 已切换至: ${target.title || '无标题'}\nID: ${resumed.sessionId.slice(0, 8)}...`);
                } else {
                    await adapter.reply(ctx.threadId, '❌ 切换失败');
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 切换失败: ${e.message}`);
            }
            return;
        }
        await adapter.reply(ctx.threadId, '已取消切换');
        return;
    }
    // Analyze mode confirmation
    if (session._analyzeMode) {
        const confirm = trimmed.toLowerCase();
        if (confirm === '执行' || confirm === 'execute' || confirm === '开始' || confirm === 'go') {
            session._analyzeMode = false;
            const task = session._analyzeTask || text;
            session._analyzeTask = null;
            await adapter.reply(ctx.threadId, `🔧 开始执行: ${task}\n\nAI 将实施最小改动，完成后列出变更点和验证步骤。`);
            const execPrompt = `现在开始施工队模式。任务：${task}\n\n请严格执行以下步骤：\n\n1. 实施最小改动：只修改必要的代码，不要重构其他地方\n2. 保持风格一致：遵循项目现有的代码风格\n3. 列出变更点：修改完成后，列出所有改动的文件和代码\n4. 验证步骤：说明需要运行哪些测试或检查来验证修改\n5. 列出未验证的部分：说明还有哪些边界情况需要人工检查\n\n注意：\n- 只做最小改动\n- 不要顺手重构\n- 不要修改不相关的文件`;
            await forwardToOpenCode(adapter, ctx, execPrompt, session);
            return;
        }
        session._analyzeMode = false;
        session._analyzeTask = null;
        await adapter.reply(ctx.threadId, '已取消分析模式');
        return;
    }
    // Authorization check
    if (!isAuthorized('feishu', ctx.userId)) {
        if (!hasOwner('feishu')) {
            await adapter.reply(ctx.threadId, `🔐 **需要认证**

此 bot 尚未绑定。

请发送 /start 进行首次认证。`);
        } else {
            await adapter.reply(ctx.threadId, `🚫 **拒绝访问**

你无权使用此 bot。`);
        }
        return;
    }
    // Check OpenCode connection
    const connected = await checkConnection();
    if (!connected) {
        await adapter.reply(ctx.threadId, `❌ OpenCode 离线

无法连接 OpenCode 服务。

🔄 /retry — 重试连接`);
        return;
    }
    // Remember memory keywords
    const rememberKeywords = ['记住', '记录', '记下', '以后', '偏好', '习惯'];
    const deleteKeywords = ['删除', '忘记', '取消', '抹掉', '清除'];
    const hasRememberKeyword = rememberKeywords.some(kw => text.includes(kw));
    const hasDeleteKeyword = deleteKeywords.some(kw => text.includes(kw));
    if (hasDeleteKeyword && hasRememberKeyword) {
        let query = text.replace(/删除|忘记|取消|抹掉|清除|记忆|记录|关于|那个/g, '').trim();
        try {
            const memoryManager = (await import('../weixin/memory-manager.js')).default;
            if (query.length > 0) {
                const deleted = memoryManager.deleteMemory('prefs', query);
                if (deleted) {
                    await adapter.reply(ctx.threadId, `🗑️ 已删除包含 "${query}" 的记忆条目`);
                    return;
                } else {
                    await adapter.reply(ctx.threadId, `🤷 未找到包含 "${query}" 的记忆条目`);
                    return;
                }
            } else {
                memoryManager.deleteMemory('prefs', '');
                await adapter.reply(ctx.threadId, '🗑️ 已清空所有用户偏好记忆');
                return;
            }
        } catch { console.debug('[feishu-memory] memory-manager unavailable'); }
    } else if (hasRememberKeyword) {
        if (text.length > 2 && text.length < 500) {
            try {
                const memoryManager = (await import('../weixin/memory-manager.js')).default;
                memoryManager.saveMemory('prefs', { content: text });
                console.log(`[feishu-memory] Saved user preference: ${text}`);
            } catch { console.debug('[feishu-memory] memory-manager unavailable'); }
        }
    }
    await forwardToOpenCode(adapter, ctx, text, session);
}
// Core forwarding function - enhanced with tool tracking, memory injection, incomplete response handling
async function forwardToOpenCode(adapter, ctx, text, session) {
    await adapter.sendTypingIndicator(ctx.threadId);
    let openCodeSession = openCodeSessions.get(ctx.threadId);
    if (!openCodeSession) {
        if (session.opencodeSessionId) {
            openCodeSession = await resumeSession(session.opencodeSessionId);
        }
        if (!openCodeSession && globalThis.__latestOpenCodeSession?.id) {
            openCodeSession = await resumeSession(globalThis.__latestOpenCodeSession.id);
        }
        if (!openCodeSession) {
            openCodeSession = await createSession(ctx.threadId, `Feishu ${ctx.threadId}`);
            if (!openCodeSession) {
                await adapter.reply(ctx.threadId, '❌ 无法创建 OpenCode 会话');
                return;
            }
        }
        openCodeSessions.set(ctx.threadId, openCodeSession);
        session.opencodeSessionId = openCodeSession.sessionId;
    }
    if (session.modelOverride) {
        openCodeSession.model = session.modelOverride;
    }
    session.taskStartTime = Date.now();
    session.currentTool = null;
    const projectDir = session.projectDir || globalThis.__autoProjectDir;
    // Build scoped text with memory injection
    let scopedText = text;
    if (session._contextScope) {
        scopedText = `[上下文范围: ${session._contextScope}]\n\n${text}`;
    }
    if (projectDir) {
        const memoryContext = loadMemoryContext(projectDir);
        if (memoryContext) {
            scopedText = `${memoryContext}\n\n${scopedText}`;
        }
        if (!scopedText.includes('项目目录')) {
            scopedText = `[当前项目目录: ${projectDir}]\n\n${scopedText}`;
        }
    }
    // Inject memory-manager preferences
    try {
        const memoryManager = (await import('../weixin/memory-manager.js')).default;
        const autoMemory = memoryManager.getRelevantMemory(text);
        if (autoMemory) {
            scopedText = `【用户记忆/偏好】\n${autoMemory}\n\n${scopedText}`;
        }
    } catch { console.debug('[feishu-memory] memory-manager not available'); }
    console.log(`📤 Forwarding to OpenCode: ${text.substring(0, 80)}...`);
    try {
        let lastToolNotified = '';
        let hasToolActivity = false;
        let toolCallCount = 0;
        let response = await sendMessage(openCodeSession, scopedText, {
            onEvent: (event) => {
                if (event.type === 'tool.call') {
                    const props = event.properties || {};
                    const toolName = props.name || props.tool_name || 'unknown';
                    const input = props.input || {};
                    toolCallCount++;
                    let toolDesc = `🔧 执行工具: ${toolName}`;
                    if (input.path) {
                        toolDesc += `\n📁 ${input.path}`;
                    }
                    if (input.command) {
                        toolDesc += `\n💻 ${input.command}`;
                    }
                    adapter.reply(ctx.threadId, toolDesc).catch(() => {});
                    if (input.path) {
                        if (!session.modifiedFiles) session.modifiedFiles = new Set();
                        session.modifiedFiles.add(input.path);
                    }
                    console.log(`[feishu-tool] Executing: ${toolName}`);
                }
                if (event.type && !event.type.includes('delta')) {
                    console.log(`📡 Feishu Event: ${event.type}`);
                }
            },
            onTextDelta: () => {},
            onStatusChange: (status) => {
                if (status.hasToolActivity) {
                    hasToolActivity = true;
                }
                if (status.type === 'retry') {
                    adapter.updateMessage(ctx.threadId, '', `⏳ 重试中 (${status.attempt})...`).catch(() => {});
                }
            },
        });
        session.taskStartTime = null;
        session.currentTool = null;
        if (session.modifiedFiles instanceof Set) {
            session.modifiedFiles = Array.from(session.modifiedFiles);
        }
        if (!response || typeof response !== 'string') {
            await adapter.reply(ctx.threadId, '...');
            return;
        }
        const trimmedResponse = response.trim();
        if (!trimmedResponse) {
            await adapter.reply(ctx.threadId, '...');
            return;
        }
        if (trimmedResponse.startsWith('⏰') || trimmedResponse.startsWith('❌')) {
            console.error('[feishu-forward] Error response:', trimmedResponse);
            await adapter.reply(ctx.threadId, trimmedResponse);
            return;
        }
        // Handle incomplete responses (ends with ':' or '...')
        if (trimmedResponse.endsWith(':') || trimmedResponse.endsWith('...')) {
            console.log('[feishu-forward] 检测到不完整响应，等待补充...');
            await new Promise(r => setTimeout(r, 5000));
            try {
                const msgsResult = await openCodeSession.client.session.messages({
                    path: { id: openCodeSession.sessionId },
                    query: { limit: 5 }
                });
                if (!msgsResult.error && msgsResult.data && msgsResult.data.length > 0) {
                    for (let i = msgsResult.data.length - 1; i >= 0; i--) {
                        const msg = msgsResult.data[i];
                        if (msg.info?.role === 'assistant' && msg.parts) {
                            const textParts = msg.parts.filter(p => p.type === 'text' && p.text).map(p => p.text);
                            if (textParts.length > 0) {
                                const newResponse = textParts.join('\n').trim();
                                if (newResponse && newResponse !== trimmedResponse) {
                                    response = newResponse;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('[feishu-forward] 无法检查额外响应');
            }
        }
        // Send response
        const responseMsgs = splitMessage(response);
        for (const m of responseMsgs) {
            const trimmed = m.trim();
            if (!trimmed) continue;
            try {
                await adapter.reply(ctx.threadId, m);
            } catch (replyErr) {
                console.error('[feishu-forward] 回复失败:', replyErr.message);
            }
        }
        // Share session URL if files were modified
        const filesCount = (session.modifiedFiles?.length || session.modifiedFiles?.size || 0);
        if (filesCount > 0) {
            try {
                const shareUrl = await shareSession(openCodeSession);
                if (shareUrl) {
                    await adapter.reply(ctx.threadId, `🔗 ${shareUrl}`);
                }
            } catch (e) {
                console.error('[feishu-forward] 分享会话失败:', e.message);
            }
        }
        // Auto-flush after tool activity
        if (hasToolActivity && projectDir) {
            const threadId = ctx.threadId;
            setTimeout(() => {
                autoFlush(adapter, threadId, session).catch(() => {});
            }, 2000);
        }
    } catch (error) {
        session.taskStartTime = null;
        session.currentTool = null;
        console.error('❌ Feishu 错误:', error);
        await adapter.reply(ctx.threadId, `❌ 错误: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}
// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60000;
function checkRateLimit(chatId) {
    const now = Date.now();
    const entry = rateLimitMap.get(chatId);
    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(chatId, { count: 1, resetTime: now + RATE_WINDOW });
        return true;
    }
    if (entry.count >= RATE_LIMIT) {
        return false;
    }
    entry.count++;
    return true;
}
// Start Feishu bot using WebSocket long connection mode
export async function startFeishuBot(botConfig) {
    config = botConfig;
    if (!config.feishuAppId || !config.feishuAppSecret) {
        throw new Error('飞书未配置。运行: opencode-remote config');
    }
    feishuClient = new lark.Client({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
    });
    initSessionManager(config);
    openCodeSessions = new Map();
    console.log('🔧 正在初始化 OpenCode...');
    try {
        await initOpenCode();
        console.log('✅ OpenCode 就绪');
    }
    catch (error) {
        console.error('❌ OpenCode 初始化失败:', error);
    }
    const adapter = createFeishuAdapter(feishuClient);
    wsClient = new lark.WSClient({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
    });
    const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
            console.log('📩 收到消息事件');
            try {
                if (!data?.message) {
                    console.warn('收到无消息内容的事件');
                    return { code: 0 };
                }
                const chatId = data.message.chat_id;
                if (!checkRateLimit(chatId)) {
                    console.warn(`频率超限: ${chatId}`);
                    return { code: 0 };
                }
                let text = '';
                try {
                    const content = JSON.parse(data.message.content);
                    text = content.text || '';
                }
                catch {
                    text = data.message.content || '';
                }
                if (!text.trim()) {
                    return { code: 0 };
                }
                const ctx = feishuEventToContext(data);
                handleMessage(adapter, ctx, text).catch(error => {
                    console.error('处理飞书消息失败:', error);
                });
                return { code: 0 };
            }
            catch (error) {
                console.error('飞书事件处理器错误:', error);
                return { code: 0 };
            }
        },
    });
    console.log('🔗 正在启动飞书 WebSocket 长连接...');
    console.log('');
    console.log('✨ 长连接模式 - 无需隧道/ngrok！');
    console.log('   确保你的电脑可以访问互联网。');
    console.log('');
    const authStatus = getAuthStatus();
    if (!authStatus.feishu) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  🔐 安全提示');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('  Bot 尚未绑定安全所有者！');
        console.log('  FIRST 发送 /start 的人将成为所有者。');
        console.log('');
        console.log('  👉 打开飞书向 Bot 发送 /start！');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    }
    else {
        console.log('🔒 Bot 已绑定（所有者已认证）');
        console.log('');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📋 配置检查清单');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Step 1: 添加权限 (权限管理 → API权限)');
    console.log('  ────────────────────────────────────────');
    console.log('  点击"批量添加"(Batch Add) 并粘贴以下 JSON:');
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────┐');
    console.log('  │ {                                                  │');
    console.log('  │   "im:message",                                   │');
    console.log('  │   "im:message:send_as_bot",                       │');
    console.log('  │   "im:message:receive_as_bot"                     │');
    console.log('  │ }                                                  │');
    console.log('  └────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Step 2: 启用机器人 (应用能力 → 机器人)');
    console.log('  ────────────────────────────────────────');
    console.log('  - 启用"启用机器人"');
    console.log('  - 启用"机器人可主动发送消息给用户"');
    console.log('  - 启用"用户可与机器人进行单聊"');
    console.log('');
    console.log('  Step 3: 事件订阅 (事件订阅)');
    console.log('  ────────────────────────────────────────');
    console.log('  ⚠️  必须先启动此 Bot 再保存事件配置！');
    console.log('  - 选择"使用长连接接收事件"');
    console.log('  - 添加事件: im.message.receive_v1');
    console.log('  - 点击保存');
    console.log('');
    console.log('  Step 4: 发布应用 (版本管理与发布)');
    console.log('  ────────────────────────────────────────');
    console.log('  - 创建版本 → 申请发布 → 发布');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔍 调试: 在飞书中向你的 Bot 发送消息！');
    console.log('     你将看到: 📩 收到消息事件');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    const shutdown = () => {
        console.log('\n🛑 关闭飞书 Bot...');
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await wsClient.start({ eventDispatcher });
}
