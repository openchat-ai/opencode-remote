import { splitMessage } from '../core/notifications.js';
import { createSession, sendMessage as sendToOpenCode, checkConnection, shareSession, listOpenCodeSessions, resumeSession } from '../opencode/client.js';
import { isAuthorized, hasOwner } from '../core/auth.js';


import { detectCommand, EXPERT_SYSTEM_PROMPT, startTypingPing } from '../core/router.js';
import { handleCommand, sharedRoom, isSharedMember, threadAgent } from './commands.js';
import { userAdapterMap } from './user-adapter-map.js';
import { hasPendingDecision, resolveDecision } from '../autonomous/decisions.js';
import { registry } from '../core/registry.js';

const IDLE_MODEL_HINT_MS = 5 * 60 * 1000;
const threadLastActive = new Map();
const threadHistory = new Map();

function replyTo(userId, text, fallbackAdapter) {
    const a = userAdapterMap.get(userId) || fallbackAdapter;
    return a.reply(userId, text);
}

function wrapAdapterForShared(adapter, senderId) {
    return new Proxy(adapter, {
        get(target, prop) {
            if (prop !== 'reply') return target[prop];
            return async (threadId, msg) => {
                const result = await target.reply(threadId, msg).catch(() => {});
                if (threadId === senderId) {
                    for (const tid of sharedRoom.members) {
                        if (tid !== senderId) {
                            replyTo(tid, msg, adapter).catch(() => {});
                        }
                    }
                }
                return result;
            };
        },
    });
}

async function forwardToOpenCode(adapter, ctx, text, openCodeSessions, expertPrompt) {
    adapter.sendTypingIndicator(ctx.threadId).catch(() => {});
    let openCodeSession = null;
    let pendingModelHint = null;

    // 共享模式：使用共享会话
    const isShared = isSharedMember(ctx.threadId);
    if (isShared) {
        if (sharedRoom.busy) {
            await adapter.reply(ctx.threadId, '⏳ 当前有人在用，请稍等...');
            return;
        }
        if (sharedRoom.session) {
            openCodeSession = sharedRoom.session;
        } else {
            // 首次使用共享，创建会话
            openCodeSession = await createSession(`shared-${Date.now()}`, '共享会话');
            if (!openCodeSession) {
                await adapter.reply(ctx.threadId, '❌ 无法创建共享会话');
                return;
            }
            sharedRoom.session = openCodeSession;
            console.log(`✅ 共享会话已创建: ${openCodeSession.sessionId.slice(0, 8)}`);
        }
        sharedRoom.busy = true;
    } else {
        // 原有个体逻辑
        // 检查是否长时间未活跃，提示模型信息
    const lastActive = threadLastActive.get(ctx.threadId) || 0;
    const isIdle = !expertPrompt && lastActive > 0 && (Date.now() - lastActive) > IDLE_MODEL_HINT_MS;
    if (isIdle) {
        pendingModelHint = true;
    }

    // 专家评审每次开独立会话，避免旧历史干扰
    if (expertPrompt) {
        openCodeSession = await createSession(`expert-${Date.now()}`, `专家评审 ${Date.now()}`);
        if (!openCodeSession) {
            await adapter.reply(ctx.threadId, '❌ 无法创建评审会话');
            return;
        }
        console.log(`✅ 新建评审会话: ${openCodeSession.sessionId.slice(0, 8)}`);
    } else {
        openCodeSession = openCodeSessions.get(ctx.threadId);
        if (!openCodeSession) {
            console.log(`[forwardToOpenCode] no in-memory session, trying to resume most recent...`);
            try {
                const sessions = await listOpenCodeSessions();
                if (sessions.length > 0) {
                    const latest = sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
                    const resumed = await resumeSession(latest.id);
                    if (resumed) {
                        openCodeSession = resumed;
                        openCodeSessions.set(ctx.threadId, openCodeSession);
                        console.log(`[forwardToOpenCode] resumed session ${latest.id.slice(0, 8)}`);
                    }
                }
            } catch (e) {
                console.log(`[forwardToOpenCode] failed to resume: ${e.message}`);
            }
            if (!openCodeSession) {
                console.log(`[forwardToOpenCode] creating new session for thread=${ctx.threadId}`);
                openCodeSession = await createSession(ctx.threadId, `Weixin ${ctx.threadId}`);
                if (!openCodeSession) { await adapter.reply(ctx.threadId, '❌ 无法创建 OpenCode 会话'); return; }
                openCodeSessions.set(ctx.threadId, openCodeSession);
            }
        }
    }
    }

    console.log(`📤 Message sent: → ${text}`);
    let scopedText = text;
    if (expertPrompt) scopedText = `${expertPrompt}\n\n${scopedText}`;

    const typingPing = startTypingPing(adapter, ctx.threadId);

    const result = await sendToOpenCode(openCodeSession, scopedText, {
        idleThreshold: expertPrompt ? 30 : 10,
        onNewContent: (delta) => {
            typingPing.poke();
        },
        onResponseMeta: (meta) => {
            if (pendingModelHint && meta.modelID) {
                pendingModelHint = `🧠 ${meta.providerID}/${meta.modelID}`;
            }
        },
        onEvent: (event) => {
            if (event.type === 'tool.call') {
                const props = event.properties || {};
                const toolName = props.name || props.tool_name || 'unknown';
                const input = props.input || {};
                let toolDesc = `🔧 ${toolName}`;
                if (input.path) toolDesc += ` 📁${input.path}`;
                if (input.command) toolDesc += ` 💻${input.command}`;
                console.log(`[→发送] ${toolDesc}`);
                const replyTargets = isShared ? [...sharedRoom.members] : [ctx.threadId];
                for (const tid of replyTargets) {
                    replyTo(tid, toolDesc, adapter).catch(e => console.error('[→发送] 失败:', e.message));
                }
                typingPing.poke();
            }
        },
    }, ctx.threadId).catch((e) => {
        console.error('[forwardToOpenCode] Task error:', e.message);
        return '';
    });

    typingPing.done();

    // 共享模式：广播到所有成员
    const replyTargets = isShared ? [...sharedRoom.members] : [ctx.threadId];
    if (isShared) sharedRoom.busy = false;

    // 错误/超时 → 清除 session 让下次重建
    const finalText = (result || '').trim();
    console.log(`📥 AI response (${finalText.length} chars): ${finalText.slice(0, 200)}${finalText.length > 200 ? '...' : ''}`);
    const displayText = pendingModelHint && typeof pendingModelHint === 'string'
        ? `${pendingModelHint}\n${finalText}`
        : finalText;
    if (!finalText || finalText.startsWith('⏰') || finalText.startsWith('❌')) {
        if (!isShared) openCodeSessions.delete(ctx.threadId);
        for (const tid of replyTargets) {
            replyTo(tid, finalText || '⚠️ AI 返回为空（可能是超时），请重试或 /diagnose', adapter)
                .catch(e => console.error('[reply] 失败:', e.message));
        }
    } else {
        const msgs = splitMessage(displayText);
        for (const m of msgs) {
            if (!m.trim()) continue;
            for (const tid of replyTargets) {
                replyTo(tid, m, adapter).catch(e => console.error('[reply] 失败:', e.message));
            }
        }
    }

    // 更新活跃时间
    threadLastActive.set(ctx.threadId, Date.now());



    const shareUrl = await shareSession(openCodeSession);
    if (shareUrl) {
        try {
            await adapter.reply(ctx.threadId, `🔗 ${shareUrl}`);
        } catch (e) {
            console.error('[forwardToOpenCode] share URL reply failed:', e.message);
        }
    }

}

async function handleMessage(adapter, ctx, text, openCodeSessions) {
    const session = {};

    const expertTriggers = ['z', 'Z', '叫全部专家', '叫所有专家', '呼叫专家点评', '专家点评', '专家意见', 'call all experts', 'expert review', '专家会诊', '团队评审', '代码审查', '全员review', 'review all', '请专家', '叫专家', '找专家'];
    const trimmedLower = text.trim().toLowerCase();
    let expertPrompt = null;
    if (text.startsWith('/z')) {
        const arg = text.slice(2).trim();
        if (arg === 'off' || arg === 'reset' || arg === '关闭') {
            await adapter.reply(ctx.threadId, '⏹️ 自定义 prompt 已清除');
            return;
        }
        if (arg) {
            expertPrompt = arg;
            await adapter.reply(ctx.threadId, `✅ 自定义专家 prompt (${arg.length}字)，本消息生效`);
        } else {
            expertPrompt = EXPERT_SYSTEM_PROMPT;
            await adapter.reply(ctx.threadId, '✅ 专家评审已启动');
        }
        await forwardToOpenCode(adapter, ctx, text, openCodeSessions, expertPrompt);
        return;
    }
    if (expertTriggers.some(t => trimmedLower.includes(t))) {
        expertPrompt = EXPERT_SYSTEM_PROMPT;
    }

    // 自主开发决策回复拦截
    if (hasPendingDecision(ctx.threadId)) {
        if (/^\d+$/.test(text.trim())) {
            if (resolveDecision(ctx.threadId, text.trim())) return;
        }
        if (/^\/(\d+)$/.test(text.trim())) {
            if (resolveDecision(ctx.threadId, text.trim().slice(1))) return;
        }
    }

    const detected = detectCommand(text);
    if (detected) {
        const cmdAdapter = isSharedMember(ctx.threadId) ? wrapAdapterForShared(adapter, ctx.threadId) : adapter;
        const handled = await handleCommand(cmdAdapter, ctx, detected.name, detected.arg, openCodeSessions);
        if (handled) return;
    }

    if (!isAuthorized('weixin', ctx.userId)) {
        if (!hasOwner('weixin')) {
            await adapter.reply(ctx.threadId, '🔐 请先发送 /start 进行安全认证');
            return;
        }
        // 共享成员跳过认证
        if (!isSharedMember(ctx.threadId)) {
            await adapter.reply(ctx.threadId, '🚫 你无权使用此 bot');
            return;
        }
    }

    // 活跃 agent 路由
    const activeAgentName = threadAgent.get(ctx.threadId);
    if (activeAgentName && activeAgentName !== 'opencode') {
        const agent = registry.findAgent(activeAgentName);
        if (agent) {
            const available = await agent.isAvailable().catch(() => false);
            if (available) {
                const t0 = Date.now();
                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`[→${activeAgentName}] ${text}`);
                console.log(`──────────────────────────────────────────────────────`);

                // 构建历史记录
                const history = threadHistory.get(ctx.threadId) || [];
                const maxHistory = 20;
                const recentHistory = history.slice(-maxHistory);

                try {
                    const response = await agent.sendPrompt(activeAgentName, text, recentHistory, { projectDir: globalThis.__autoProjectDir });
                    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
                    console.log(`[←${activeAgentName}] ⏱ ${elapsed}s | chars: ${(response || '').length}`);
                    console.log(`[RESPONSE] ${(response || '').slice(0, 200)}${(response || '').length > 200 ? '...' : ''}`);

                    // 更新历史
                    history.push({ role: 'user', content: text }, { role: 'assistant', content: response || '' });
                    threadHistory.set(ctx.threadId, history);

                    const chunks = splitMessage(response || '无响应');
                    for (const chunk of chunks) {
                        await adapter.reply(ctx.threadId, chunk);
                    }
                } catch (error) {
                    console.error(`[${activeAgentName}] ❌ ${error.message}`);
                    await adapter.reply(ctx.threadId, `❌ ${activeAgentName} 错误: ${error.message}`);
                }
                return;
            }
            console.warn(`[agent] ${activeAgentName} 不可用，回退到 OpenCode`);
        }
        // agent 不可用，清除状态回退到 OpenCode
        threadAgent.delete(ctx.threadId);
    }

    const connected = await checkConnection();
    if (!connected) {
        await adapter.reply(ctx.threadId, '❌ OpenCode 离线，请检查服务是否运行');
        return;
    }

    await forwardToOpenCode(adapter, ctx, text, openCodeSessions);
}

export { handleMessage, forwardToOpenCode };
