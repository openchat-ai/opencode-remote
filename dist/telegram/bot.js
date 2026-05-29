import { registry } from '../core/registry.js';
import { sessionManager } from '../core/session.js';
import { initOpenCode, createSession, sendMessage as sendToOpenCode, checkConnection } from '../opencode/client.js';
import { parseMessage, routeMessage } from '../core/router.js';
import { telegramAdapter } from './adapter.js';

export async function startBot() {
    const { loadConfig } = await import('../core/config.js');
    const config = loadConfig();

    if (!config.telegramBotToken || config.telegramBotToken === 'your_bot_token_here') {
        console.log('\n❌ Telegram Bot Token not configured\n');
        console.log('To get your bot token:');
        console.log('  1. Open Telegram app, search @BotFather');
        console.log('  2. Send /newbot and follow instructions');
        console.log('  3. Then run: opencode-remote config\n');
        process.exit(1);
    }

    await sessionManager.start();
    await registry.loadBuiltInPlugins();
    await telegramAdapter.start(config);

    let openCodeSessions = new Map();
    let opencodeSessionId = null;

    telegramAdapter.bot.on('message:text', async (ctx) => {
        if (ctx.message.from.is_bot) return;
        if (!telegramAdapter.messageHandler) return;

        try {
            const message = {
                id: ctx.message.message_id.toString(),
                threadId: ctx.chat.id.toString(),
                userId: ctx.message.from?.id?.toString() || 'unknown',
                text: ctx.message.text || '',
                timestamp: new Date(ctx.message.date * 1000),
                channelId: 'default',
            };
            const msgCtx = { message, platform: 'telegram', channelId: 'default' };
            await telegramAdapter.messageHandler(msgCtx);
        } catch (err) {
            console.error('[Telegram] Error:', err);
        }
    });

    telegramAdapter.bot.on('callback_query:data', async (ctx) => {
        if (!ctx.callbackQuery.data.startsWith('cmd:')) return;
        const cmd = ctx.callbackQuery.data.slice(4);
        try {
            await ctx.answerCallbackQuery({ text: `执行: /${cmd}` });
            const msg = await telegramAdapter.bot.api.sendMessage(ctx.chat.id, `/${cmd}`);
        } catch (e) { console.error('[Telegram] callback error:', e.message); }
    });

    telegramAdapter.bot.start().catch((err) => {
        if (telegramAdapter.isRunning) console.error('[Telegram] Polling error:', err);
    });

    telegramAdapter.onMessage(async (ctx) => {
        const { message, platform, channelId } = ctx;

        telegramAdapter.sendTyping(message.threadId, true).catch(() => {});

        try {
            const parsed = parseMessage(message.text);

            if (parsed.type === 'command' && parsed.command === 'reset') {
                openCodeSessions.delete(message.threadId);
                opencodeSessionId = null;
                try {
                    const session = await sessionManager.getExistingSession(platform, channelId, message.threadId);
                    if (session) await sessionManager.resetConversation(platform, channelId, message.threadId);
                } catch (e) { console.warn('[Telegram] Reset error:', e.message); }
            }

            if (parsed.type === 'default') {
                const connected = await checkConnection();
                if (!connected) {
                    await telegramAdapter.sendTyping(message.threadId, false);
                    await telegramAdapter.sendMessage(message.threadId, '❌ OpenCode 离线');
                    return;
                }
                let session = openCodeSessions.get(message.threadId);
                if (!session) {
                    const newSession = await createSession(message.threadId, `Telegram ${message.threadId}`);
                    if (!newSession) {
                        await telegramAdapter.sendTyping(message.threadId, false);
                        await telegramAdapter.sendMessage(message.threadId, '❌ 无法创建会话');
                        return;
                    }
                    session = newSession;
                    openCodeSessions.set(message.threadId, session);
                }
                opencodeSessionId = session.sessionId;

                const taskStart = Date.now();
                const response = await sendToOpenCode(session, parsed.prompt, {
                    onTextDelta: () => {},
                    onEvent: (event) => {
                        if (event.type === 'tool.call') {
                            const n = event.properties?.name || 'unknown';
                            telegramAdapter.sendMessage(message.threadId, `🔧 ${n}`).catch(() => {});
                        }
                    },
                });

                await telegramAdapter.sendTyping(message.threadId, false);
                if (response) {
                    for (const chunk of splitMessage(response)) {
                        if (chunk.trim()) await telegramAdapter.sendMessage(message.threadId, chunk);
                    }
                }
                const { formatTaskCompletion } = await import('../core/notifications.js');
                await telegramAdapter.sendMessage(message.threadId, formatTaskCompletion('AI 任务', taskStart));
                return;
            }

            const result = await routeMessage(parsed, {
                threadId: message.threadId, channelId, platform,
                defaultAgent: 'opencode', opencodeSessionId,
            });

            await telegramAdapter.sendTyping(message.threadId, false);
            if (typeof result === 'string') {
                if (parsed.type === 'command' && (parsed.command === 'help' || parsed.command === 'start')) {
                    await telegramAdapter.sendMessage(message.threadId, result);
                    await telegramAdapter.sendCommandMenu(message.threadId, '📱 快速选择指令：');
                } else {
                    await telegramAdapter.sendMessage(message.threadId, result);
                }
            } else if (result) {
                let full = '';
                for await (const chunk of result) full += chunk;
                if (full) await telegramAdapter.sendMessage(message.threadId, full);
            }
        } catch (error) {
            console.error('[Telegram] Error:', error);
            await telegramAdapter.sendTyping(message.threadId, false);
            await telegramAdapter.sendMessage(message.threadId, '❌ 处理失败');
        }
    });

    console.log('🚀 Telegram bot ready');
    await new Promise(() => {});
}
