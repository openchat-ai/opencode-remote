import { Bot } from 'grammy';
import { splitMessage } from '../utils/message-split.js';

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
            throw new Error('Telegram bot token not configured');
        }
        this.bot = new Bot(config.telegramBotToken);
        this.isRunning = true;
        console.log('🚀 Telegram adapter started');
    }

    async stop() {
        this.isRunning = false;
        for (const interval of this.typingIntervals.values()) clearInterval(interval);
        this.typingIntervals.clear();
        if (this.bot) { await this.bot.stop(); this.bot = null; }
        console.log('👋 Telegram adapter stopped');
    }

    onMessage(handler) { this.messageHandler = handler; }

    async sendMessage(threadId, text) {
        if (!this.bot) throw new Error('Telegram adapter not started');
        const chunks = splitMessage(text, { maxLength: 4000, addContinuationMarker: false });
        for (const chunk of chunks) await this.bot.api.sendMessage(threadId, chunk, { parse_mode: 'Markdown' });
    }

    async sendTyping(threadId, isTyping) {
        if (!this.bot) return;
        if (isTyping) {
            try { await this.bot.api.sendChatAction(threadId, 'typing'); } catch {}
            const existing = this.typingIntervals.get(threadId);
            if (existing) clearInterval(existing);
            const interval = setInterval(async () => {
                try { await this.bot.api.sendChatAction(threadId, 'typing'); } catch {}
            }, 4000);
            this.typingIntervals.set(threadId, interval);
        } else {
            const interval = this.typingIntervals.get(threadId);
            if (interval) { clearInterval(interval); this.typingIntervals.delete(threadId); }
        }
    }
}

export const telegramAdapter = new TelegramAdapter();
