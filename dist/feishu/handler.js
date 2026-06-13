import { splitMessage } from '../core/notifications.js';
import { createSession, sendMessage, checkConnection, listOpenCodeSessions, resumeSession } from '../opencode/client.js';
import { isAuthorized, hasOwner } from '../core/auth.js';
import { detectCommand, EXPERT_SYSTEM_PROMPT } from '../core/router.js';
import { handleCommand } from './commands.js';

async function handleMessage(adapter, ctx, text, openCodeSessions) {
    const expertTriggers = ['z', 'Z', '叫全部专家', '叫所有专家', '呼叫专家点评', '专家点评', '专家意见', 'call all experts', 'expert review', '专家会诊', '团队评审', '代码审查', '全员review', 'review all', '请专家', '叫专家', '找专家'];
    let expertPrompt = null;

    if (text.startsWith('/z')) {
        const arg = text.slice(2).trim();
        if (arg === 'off' || arg === 'reset' || arg === '关闭') {
            await adapter.reply(ctx.threadId, '⏹️ 自定义 prompt 已清除');
            return;
        }
        if (arg) {
            expertPrompt = arg;
        } else {
            expertPrompt = EXPERT_SYSTEM_PROMPT;
        }
        await forwardToOpenCode(adapter, ctx, text, openCodeSessions, expertPrompt);
        return;
    }

    if (expertTriggers.some(t => text.trim().toLowerCase().includes(t))) {
        expertPrompt = EXPERT_SYSTEM_PROMPT;
    }

    const parsed = detectCommand(text);
    if (parsed) {
        await handleCommand(adapter, ctx, parsed.name, parsed.arg, openCodeSessions);
        return;
    }
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
    const connected = await checkConnection();
    if (!connected) {
        await adapter.reply(ctx.threadId, `❌ OpenCode 离线

无法连接 OpenCode 服务。

🔄 /retry — 重试连接`);
        return;
    }
    await forwardToOpenCode(adapter, ctx, text, openCodeSessions);
}

async function forwardToOpenCode(adapter, ctx, text, openCodeSessions, expertPrompt) {
    await adapter.sendTypingIndicator(ctx.threadId);
    let openCodeSession = openCodeSessions.get(ctx.threadId);
    if (!openCodeSession) {
        console.log(`[feishu-forward] no in-memory session, trying to resume most recent...`);
        try {
            const sessions = await listOpenCodeSessions();
            if (sessions.length > 0) {
                const latest = sessions.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
                const resumed = await resumeSession(latest.id);
                if (resumed) {
                    openCodeSession = resumed;
                    openCodeSessions.set(ctx.threadId, openCodeSession);
                    console.log(`[feishu-forward] resumed session ${latest.id.slice(0, 8)}`);
                }
            }
        } catch (e) {
            console.log(`[feishu-forward] failed to resume: ${e.message}`);
        }
        if (!openCodeSession) {
            openCodeSession = await createSession(ctx.threadId, `Feishu ${ctx.threadId}`);
            if (!openCodeSession) {
                await adapter.reply(ctx.threadId, '❌ 无法创建 OpenCode 会话');
                return;
            }
            openCodeSessions.set(ctx.threadId, openCodeSession);
        }
    }

    let scopedText = text;

    if (expertPrompt) {
        scopedText = `${expertPrompt}\n\n${scopedText}`;
    }

    console.log(`📤 Forwarding to OpenCode: ${text.substring(0, 80)}...`);
    try {
        let response = await sendMessage(openCodeSession, scopedText, {
            idleThreshold: expertPrompt ? 30 : 10,
            onEvent: (event) => {
                if (event.type === 'tool.call') {
                    const props = event.properties || {};
                    const toolName = props.name || props.tool_name || 'unknown';
                    const input = props.input || {};
                    let toolDesc = `🔧 执行工具: ${toolName}`;
                    if (input.path) {
                        toolDesc += `\n📁 ${input.path}`;
                    }
                    if (input.command) {
                        toolDesc += `\n💻 ${input.command}`;
                    }
                    adapter.reply(ctx.threadId, toolDesc).catch(() => {});
                    console.log(`[feishu-tool] Executing: ${toolName}`);
                }
                if (event.type && !event.type.includes('delta')) {
                    console.log(`📡 Feishu Event: ${event.type}`);
                }
            },
            onTextDelta: () => {},
        }, ctx.threadId);
        if (!response || typeof response !== 'string') {
            await adapter.reply(ctx.threadId, '...');
            return;
        }
        const trimmedResponse = response.trim();
        if (!trimmedResponse) {
            await adapter.reply(ctx.threadId, '...');
            return;
        }
        // 超时/错误 → 清除 session 让下次重建
        if (trimmedResponse.startsWith('⏰') || trimmedResponse.startsWith('❌')) {
            console.error('[feishu-forward] Error response:', trimmedResponse);
            openCodeSessions.delete(ctx.threadId);
            await adapter.reply(ctx.threadId, trimmedResponse);
            return;
        }
        if (trimmedResponse.endsWith(':') || trimmedResponse.endsWith('...')) {
            console.log('[feishu-forward] 检测到不完整响应，等待补充...');
            await new Promise(r => setTimeout(r, 5000));
            try {
                const msgsResult = await openCodeSession.client.session.messages({
                    sessionID: openCodeSession.sessionId,
                    limit: 5,
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
    } catch (error) {
        console.error('❌ Feishu 错误:', error);
        await adapter.reply(ctx.threadId, `❌ 错误: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}

export { handleMessage, forwardToOpenCode };
