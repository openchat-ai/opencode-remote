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

    async sendMessage(threadId, text, opts = {}) {
        if (!this.bot) throw new Error('Telegram adapter not started');
        const chunks = splitMessage(text, { maxLength: 4000, addContinuationMarker: false });
        for (const chunk of chunks) await this.bot.api.sendMessage(threadId, chunk, { parse_mode: 'Markdown', ...opts });
    }

    async sendCommandMenu(threadId, title) {
        if (!this.bot) return;
        const groups = [
            ['/help', '/start', '/reset', '/diagnose'],
            ['/restart', '/model', '/oc', '/cc'],
            ['/cx', '/copilot'],
        ];
        const keyboard = [];
        for (const cmds of groups) {
            const row = cmds.map(cmd => ({ text: cmd, callback_data: `cmd:${cmd.slice(1)}` }));
            keyboard.push(row);
        }
        await this.bot.api.sendMessage(threadId, title || '📱 选择指令：', {
            reply_markup: { inline_keyboard: keyboard },
        });
    }

    // BotAdapter 接口方法
    async reply(threadId, text) { return this.sendMessage(threadId, text); }
    async sendTypingIndicator(threadId) { return this.sendTyping(threadId, true); }
    async sendTypingEnd(threadId) { return this.sendTyping(threadId, false); }
    async updateMessage(threadId, messageId, text) {
        if (!this.bot || !messageId) return;
        try { await this.bot.api.editMessageText(threadId, Number(messageId), text); } catch (e) { console.warn('[telegram] updateMessage failed:', e.message); }
    }
    async deleteMessage(threadId, messageId) {
        if (!this.bot || !messageId) return;
        try { await this.bot.api.deleteMessage(threadId, Number(messageId)); }
        catch (e) { console.debug('[telegram] deleteMessage failed:', e.message); }
    }

    async sendTyping(threadId, isTyping) {
        if (!this.bot) return;
        if (isTyping) {
            try { await this.bot.api.sendChatAction(threadId, 'typing'); }
            catch (e) { console.debug('[telegram] sendChatAction failed:', e.message); }
            const existing = this.typingIntervals.get(threadId);
            if (existing) clearInterval(existing);
            const interval = setInterval(async () => {
                try { await this.bot.api.sendChatAction(threadId, 'typing'); }
                catch (e) { console.debug('[telegram] typing-tick failed:', e.message); }
            }, 4000);
            this.typingIntervals.set(threadId, interval);
        } else {
            const interval = this.typingIntervals.get(threadId);
            if (interval) { clearInterval(interval); this.typingIntervals.delete(threadId); }
        }
    }
}

export const telegramAdapter = new TelegramAdapter();
