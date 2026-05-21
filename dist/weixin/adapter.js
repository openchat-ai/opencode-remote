import { randomBytes } from 'crypto';
import { sendMessage as sendWeixinMessage, getConfig, sendTyping } from './api.js';

const lastFlushTime = new Map();
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

async function autoFlush(adapter, threadId, session, openCodeSessions) {
    const lastFlush = lastFlushTime.get(threadId) || 0;
    const now = Date.now();
    
    if (now - lastFlush < FLUSH_INTERVAL_MS) return;
    if (!session.opencodeSessionId) return;
    
    const ocSession = openCodeSessions?.get(threadId);
    if (!ocSession) return;
    
    const projectDir = session.projectDir || globalThis.__autoProjectDir;
    if (!projectDir) return;
    
    try {
        const { flushMemory } = await import('./flush.js');
        lastFlushTime.set(threadId, now);
        const result = await flushMemory(projectDir, session, ocSession);
        if (result.learned) {
            console.log(`[auto-flush] ${result.learned}`);
        } else {
            console.log(`[auto-flush] ${result.summary.split('\n')[0]}`);
        }
    } catch (e) {
        console.warn(`[auto-flush] Failed: ${e.message}`);
    }
}

function createWeixinAdapter(baseUrl, token, botId) {
    const contextTokens = new Map();
    const typingTickets = new Map();
    const processedMessages = new Map();
    const DEDUP_WINDOW_MS = 30_000;

    function isDuplicate(messageId) {
        if (!messageId) return false;
        const seenAt = processedMessages.get(messageId);
        if (seenAt && Date.now() - seenAt < DEDUP_WINDOW_MS) return true;
        processedMessages.set(messageId, Date.now());
        if (processedMessages.size > 1000) {
            const now = Date.now();
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
            let contextToken = contextTokens.get(threadId);
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                if (!contextToken) {
                    try {
                        console.log(`[Weixin] Fetching contextToken for ${threadId} (attempt ${retryCount + 1})...`);
                        const r = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: undefined });
                        contextToken = r.context_token || r.typing_ticket;
                        if (contextToken) {
                            contextTokens.set(threadId, contextToken);
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
            const cachedTicket = typingTickets.get(threadId);
            let ticket = cachedTicket;
            
            if (!ticket) {
                try {
                    const r = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: contextTokens.get(threadId) });
                    if (r.errcode === -14) {
                        contextTokens.delete(threadId);
                        typingTickets.delete(threadId);
                        const freshConfig = await getConfig({ baseUrl, token, ilinkUserId: threadId, contextToken: undefined });
                        ticket = freshConfig.typing_ticket;
                        if (freshConfig.context_token) {
                            contextTokens.set(threadId, freshConfig.context_token);
                        }
                    } else {
                        ticket = r.typing_ticket;
                    }
                    if (ticket) typingTickets.set(threadId, ticket);
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
                                typingTickets.set(threadId, freshConfig.typing_ticket);
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

export { createWeixinAdapter, autoFlush };
export default createWeixinAdapter;
