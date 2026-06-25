import { randomBytes } from 'crypto';
import { sendMessage as sendWeixinMessage, getConfig, sendTyping } from './api.js';

function createWeixinAdapter(baseUrl, token, botId) {
    const contextTokens = new Map();
    const typingTickets = new Map();
    const processedMessages = new Map();
    const DEDUP_WINDOW_MS = 30_000;

    // 定期清理 contextTokens 和 typingTickets，防内存泄漏
    const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
    let cleanupTimer = null;
    function startCleanup() {
        if (cleanupTimer) return;
        cleanupTimer = setInterval(() => {
            const cutoff = Date.now() - CLEANUP_INTERVAL_MS;
            for (const [k, v] of contextTokens) { if (typeof v !== 'object' || !v._ts || v._ts < cutoff) contextTokens.delete(k); }
            for (const [k, v] of typingTickets) { if (typeof v !== 'object' || !v._ts || v._ts < cutoff) typingTickets.delete(k); }
            if (processedMessages.size > 1000) {
                const now = Date.now();
                for (const [id, ts] of processedMessages.entries()) {
                    if (now - ts > DEDUP_WINDOW_MS) processedMessages.delete(id);
                }
            }
        }, CLEANUP_INTERVAL_MS);
        if (cleanupTimer.unref) cleanupTimer.unref();
    }
    startCleanup();

    function isDuplicate(messageId, contentKey) {
        // 优先用内容去重: 微信两条消息可能 messageId 不同但内容相同
        const key = contentKey || messageId;
        if (!key) return false;
        const now = Date.now();
        const seenAt = processedMessages.get(key);
        if (seenAt && now - seenAt < DEDUP_WINDOW_MS) return true;
        processedMessages.set(key, now);
        if (processedMessages.size > 1000) {
            for (const [id, ts] of processedMessages.entries()) {
                if (now - ts > DEDUP_WINDOW_MS) processedMessages.delete(id);
            }
        }
        return false;
    }

    return {
        contextTokens,
        typingTickets,
        isDuplicate,
        _baseUrl: baseUrl,
        _token: token,
        _botId: botId,
        async reply(threadId, text) {
            let entry = contextTokens.get(threadId);
            let contextToken = entry?.value || entry;
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                if (!contextToken) {
                    try {
                        console.log(`[Weixin] Fetching contextToken for ${threadId} (attempt ${retryCount + 1})...`);
                        const r = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: undefined });
                        contextToken = r.context_token || r.typing_ticket;
                        if (contextToken) {
                            contextTokens.set(threadId, { value: contextToken, _ts: Date.now() });
                            console.log(`[Weixin] Got contextToken: ${contextToken.slice(0, 8)}...`);
                        } else if (r.errcode === -14) {
                            console.log(`[Weixin] Session timeout, retrying with fresh token...`);
                            contextTokens.delete(threadId);
                            retryCount++;
                            await new Promise(r => setTimeout(r, 1000));
                            continue;
                        } else {
                            console.error(`[Weixin] getConfig returned no contextToken, errcode: ${r.errcode}`);
                            break;
                        }
                    } catch (e) {
                        console.error(`[Weixin] getConfig failed:`, e.message);
                        break;
                    }
                }

                if (!contextToken) {
                    console.error(`[Weixin] reply failed: no contextToken for thread ${threadId} after ${retryCount} retries`);
                    break;
                }

                try {
                    await sendWeixinMessage({
                        baseUrl, token,
                        body: { msg: { from_user_id: botId, to_user_id: threadId, client_id: `${Date.now()}-${randomBytes(8).toString('hex')}`, message_type: 2, message_state: 2, context_token: contextToken, item_list: [{ type: 1, text_item: { text } }] } }
                    });
                    return;
                } catch (e) {
                    const errMsg = e.message || '';
                    if (errMsg.includes('-14') || errMsg.includes('timeout') || errMsg.includes('session')) {
                        console.log(`[Weixin] Send failed (timeout), clearing token and retrying...`);
                        contextTokens.delete(threadId);
                        contextToken = null;
                        retryCount++;
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    console.error(`[Weixin] reply failed:`, e.message);
                    throw e;
                }
            }
            const err = new Error(`reply failed after ${maxRetries + 1} attempts`);
            console.error(`[Weixin] ${err.message}`);
            throw err;
        },
        async sendTypingIndicator(threadId) {
            const entry = typingTickets.get(threadId);
            let ticket = entry?.value || entry;
            
            if (!ticket) {
                try {
                    const r = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: (contextTokens.get(threadId) || {}).value });
                    if (r.errcode === -14) {
                        contextTokens.delete(threadId);
                        typingTickets.delete(threadId);
                        const freshConfig = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: undefined });
                        ticket = freshConfig.typing_ticket;
                        if (freshConfig.context_token) {
                            contextTokens.set(threadId, { value: freshConfig.context_token, _ts: Date.now() });
                        }
                    } else {
                        ticket = r.typing_ticket;
                    }
                    if (ticket) typingTickets.set(threadId, { value: ticket, _ts: Date.now() });
                } catch { console.debug('[typing] getConfig failed'); }
            }
            if (ticket) {
                try {
                    await sendTyping({ baseUrl, token, body: { ilink_user_id: threadId, typing_ticket: ticket, status: 1 } });
                } catch (e) {
                    if (e.message?.includes('-14') || e.message?.includes('timeout')) {
                        typingTickets.delete(threadId);
                        contextTokens.delete(threadId);
                        try {
                            const freshConfig = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: undefined });
                            if (freshConfig.typing_ticket) {
                                typingTickets.set(threadId, { value: freshConfig.typing_ticket, _ts: Date.now() });
                                await sendTyping({ baseUrl, token, body: { ilink_user_id: threadId, typing_ticket: freshConfig.typing_ticket, status: 1 } });
                            }
                        } catch { console.debug('[typing] retry getConfig failed'); }
                    }
                }
            }
        },
        async updateMessage(threadId, messageId, text) { await this.reply(threadId, text); },
        async deleteMessage() {},
    };
}

export { createWeixinAdapter };
