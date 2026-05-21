// Telegram Bot adapter with multi-agent support
import { Bot } from 'grammy';
import { splitMessage } from '../utils/message-split.js';
import { registry } from '../core/registry.js';
import { sessionManager } from '../core/session.js';
import { initOpenCode, createSession, sendMessage as sendToOpenCode, checkConnection } from '../opencode/client.js';
import { parseMessage, routeMessage } from '../core/router.js';

export class TelegramAdapter {
    name = 'telegram';
    bot = null;
    config = null;
    messageHandler = null;
    isRunning = false;
    typingIntervals = new Map();
    
    async start(config) {
        this.config = config;
        
        if (!config.telegramBotToken || config.telegramBotToken === 'your_bot_token_here') {
            throw new Error('Telegram bot token not configured. Run "opencode-remote config" first.');
        }
        
        this.bot = new Bot(config.telegramBotToken);
        
        this.bot.on('message:text', async (ctx) => {
            console.log('[Telegram] Received message:', ctx.message.text);
            
            if (ctx.message.from.is_bot) {
                console.log('[Telegram] Ignoring bot message');
                return;
            }
            
            if (!this.messageHandler) {
                console.log('[Telegram] No message handler registered');
                return;
            }
            
            try {
                const message = {
                    id: ctx.message.message_id.toString(),
                    threadId: ctx.chat.id.toString(),
                    userId: ctx.message.from?.id?.toString() || 'unknown',
                    text: ctx.message.text || '',
                    timestamp: new Date(ctx.message.date * 1000),
                    channelId: 'default',
                };
                
                const msgCtx = {
                    message,
                    platform: 'telegram',
                    channelId: 'default',
                };
                
                await this.messageHandler(msgCtx);
            } catch (err) {
                console.error('[Telegram] Error in message handler:', err);
            }
        });
        
        this.bot.start().then(() => {
            console.log('[Telegram] Bot stopped gracefully');
        }).catch((err) => {
            if (this.isRunning) {
                console.error('[Telegram] Bot polling error:', err);
            }
        });
        
        this.isRunning = true;
        console.log('🚀 Telegram adapter started');
    }
    
    async stop() {
        this.isRunning = false;
        
        for (const interval of this.typingIntervals.values()) {
            clearInterval(interval);
        }
        this.typingIntervals.clear();
        
        if (this.bot) {
            await this.bot.stop();
            this.bot = null;
        }
        
        console.log('👋 Telegram adapter stopped');
    }
    
    onMessage(handler) {
        this.messageHandler = handler;
    }
    
    async sendMessage(threadId, text) {
        if (!this.bot) {
            throw new Error('Telegram adapter not started');
        }
        
        const chunks = splitMessage(text, { maxLength: 4000, addContinuationMarker: false });
        
        for (const chunk of chunks) {
            await this.bot.api.sendMessage(threadId, chunk, { parse_mode: 'Markdown' });
        }
    }
    
    async sendTyping(threadId, isTyping) {
        if (!this.bot) {
            return;
        }
        
        if (isTyping) {
            try {
                await this.bot.api.sendChatAction(threadId, 'typing');
            } catch {
                // Ignore errors
            }
            
            const existing = this.typingIntervals.get(threadId);
            if (existing) {
                clearInterval(existing);
            }
            
            const interval = setInterval(async () => {
                try {
                    await this.bot.api.sendChatAction(threadId, 'typing');
                } catch {
                    // Ignore errors
                }
            }, 4000);
            
            this.typingIntervals.set(threadId, interval);
        } else {
            const interval = this.typingIntervals.get(threadId);
            if (interval) {
                clearInterval(interval);
                this.typingIntervals.delete(threadId);
            }
        }
    }
}

export const telegramAdapter = new TelegramAdapter();

// Legacy startBot function for backward compatibility
export async function startBot() {
    const { loadConfig } = await import('../core/config.js');
    const config = loadConfig();
    
    if (!config.telegramBotToken || config.telegramBotToken === 'your_bot_token_here') {
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  ❌ Telegram Bot Token not configured');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('  To get your bot token:');
        console.log('  1. Open Telegram app');
        console.log('  2. Search for @BotFather');
        console.log('  3. Send: /newbot');
        console.log('  4. Follow the instructions to create your bot');
        console.log('  5. Copy the token');
        console.log('');
        console.log('  Then run: opencode-remote config');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        process.exit(1);
    }
    
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  OpenCode Remote Control');
    console.log('  Control OpenCode from Telegram');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    
    // Initialize session manager
    await sessionManager.start();
    
    // Load plugins
    await registry.loadBuiltInPlugins();
    
    // Initialize Telegram adapter
    await telegramAdapter.start(config);
    
    // Set up message handler
    let openCodeSessions = new Map();
    let opencodeSessionId = null;

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
                } catch (e) { console.warn('[Telegram] Error resetting session:', e.message); }
            }

            if (parsed.type === 'default') {
                const connected = await checkConnection();
                if (!connected) {
                    await telegramAdapter.sendTyping(message.threadId, false);
                    await telegramAdapter.sendMessage(message.threadId, '❌ OpenCode 离线，请检查服务是否运行');
                    return;
                }

                let session = openCodeSessions.get(message.threadId);
                if (!session) {
                    const newSession = await createSession(message.threadId, `Telegram ${message.threadId}`);
                    if (!newSession) {
                        await telegramAdapter.sendTyping(message.threadId, false);
                        await telegramAdapter.sendMessage(message.threadId, '❌ 无法创建 OpenCode 会话');
                        return;
                    }
                    session = newSession;
                    openCodeSessions.set(message.threadId, session);
                }
                opencodeSessionId = session.sessionId;

                const response = await sendToOpenCode(session, parsed.prompt, {
                    onTextDelta: () => {},
                    onEvent: (event) => {
                        if (event.type === 'tool.call') {
                            const props = event.properties || {};
                            const toolName = props.name || 'unknown';
                            telegramAdapter.sendMessage(message.threadId, `🔧 ${toolName}`).catch(() => {});
                        }
                    },
                });

                await telegramAdapter.sendTyping(message.threadId, false);

                if (response) {
                    const chunks = splitMessage(response);
                    for (const chunk of chunks) {
                        if (chunk.trim()) await telegramAdapter.sendMessage(message.threadId, chunk);
                    }
                }
                return;
            }

            const result = await routeMessage(parsed, {
                threadId: message.threadId,
                channelId,
                platform,
                defaultAgent: 'opencode',
                opencodeSessionId,
            });

            await telegramAdapter.sendTyping(message.threadId, false);

            if (typeof result === 'string') {
                await telegramAdapter.sendMessage(message.threadId, result);
            } else if (result) {
                let fullResponse = '';
                for await (const chunk of result) {
                    fullResponse += chunk;
                }
                if (fullResponse) await telegramAdapter.sendMessage(message.threadId, fullResponse);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            await telegramAdapter.sendTyping(message.threadId, false);
            await telegramAdapter.sendMessage(message.threadId, '❌ 处理失败，请重试。');
        }
    });
    
    console.log('🚀 Starting Telegram bot...');
    console.log('');
    console.log('Available commands:');
    console.log('  /start - Start bot');
    console.log('  /help - Show all commands');
    console.log('  /agents - List available agents');
    console.log('  /new - Start new conversation');
    console.log('  /reset - Reset session');
    console.log('  /oc <prompt> - Use OpenCode');
    console.log('  /cc <prompt> - Use Claude Code');
    console.log('  /cx <prompt> - Use Codex');
    console.log('');
    
    // Keep process alive
    await new Promise(() => {});
}
