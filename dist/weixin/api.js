/**
 * Weixin API client (based on @tencent-weixin/openclaw-weixin)
 * Simplified version without OpenClaw framework dependency.
 */
import { randomBytes } from 'node:crypto';
import { DEFAULT_BASE_URL } from './types.js';
// Build headers
function buildHeaders(body, token) {
    const headers = {
        'Content-Type': 'application/json',
        'AuthorizationType': 'ilink_bot_token',
        'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
        'X-WECHAT-UIN': randomWechatUin(),
    };
    if (token?.trim()) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
    }
    return headers;
}
// Random X-WECHAT-UIN header
function randomWechatUin() {
    const uint32 = randomBytes(4).readUInt32BE(0);
    return Buffer.from(String(uint32), 'utf-8').toString('base64');
}
// Ensure URL has trailing slash
function ensureTrailingSlash(url) {
    return url.endsWith('/') ? url : `${url}/`;
}
// Generic fetch wrapper
async function apiFetch(params) {
    const base = ensureTrailingSlash(params.baseUrl);
    const url = new URL(params.endpoint, base);
    const headers = buildHeaders(params.body, params.token);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
        const res = await fetch(url.toString(), {
            method: 'POST',
            headers,
            body: params.body,
            signal: controller.signal,
        });
        clearTimeout(t);
        const rawText = await res.text();
        if (!res.ok) {
            console.error(`[apiFetch] ${params.label} failed: ${res.status}`, rawText);
            throw new Error(`${params.label} ${res.status}: ${rawText}`);
        }
        if (rawText.includes('"errcode"') && rawText.includes('-14')) {
            console.error(`[apiFetch] ${params.label} session timeout:`, rawText);
        }
        return rawText;
    }
    catch (err) {
        clearTimeout(t);
        console.error(`[apiFetch] ${params.label} error:`, err.message);
        throw err;
    }
}
// ---------------------------------------------------------------------------
// Login APIs
// ---------------------------------------------------------------------------
/**
 * Fetch QR code for login
 */
export async function fetchQRCode(baseUrl = DEFAULT_BASE_URL, botType = '3') {
    const base = ensureTrailingSlash(baseUrl);
    const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
    const res = await fetch(url.toString());
    if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)');
        throw new Error(`Failed to fetch QR code: ${res.status} ${res.statusText}`);
    }
    return await res.json();
}
/**
 * Poll QR code status
 */
export async function pollQRStatus(baseUrl = DEFAULT_BASE_URL, qrcode) {
    const base = ensureTrailingSlash(baseUrl);
    const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
    const headers = {
        'iLink-App-ClientVersion': '1',
    };
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)');
        throw new Error(`Failed to poll QR status: ${res.status} ${res.statusText}`);
    }
    return await res.json();
}
// ---------------------------------------------------------------------------
// Message APIs
// ---------------------------------------------------------------------------
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
/**
 * Long-poll for new messages
 */
export async function getUpdates(params) {
    const timeout = params.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    try {
        const rawText = await apiFetch({
            baseUrl: params.baseUrl,
            endpoint: 'ilink/bot/getupdates',
            body: JSON.stringify({
                get_updates_buf: params.get_updates_buf ?? '',
                base_info: { channel_version: '1.0.0' },
            }),
            token: params.token,
            timeoutMs: timeout,
            label: 'getUpdates',
        });
        return JSON.parse(rawText);
    }
    catch (err) {
        // Long-poll timeout is normal; return empty response
        if (err instanceof Error && err.name === 'AbortError') {
            return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
        }
        throw err;
    }
}
/**
 * Send a message
 */
export async function sendMessage(params) {
    const rawText = await apiFetch({
        baseUrl: params.baseUrl,
        endpoint: 'ilink/bot/sendmessage',
        body: JSON.stringify({
            ...params.body,
            base_info: { channel_version: '1.0.0' },
        }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
        label: 'sendMessage',
    });
    try {
        JSON.parse(rawText);
    }
    catch (e) {
        console.debug('[api] Non-JSON response:', e.message);
    }
}
/**
 * Get bot config (includes typing_ticket)
 */
export async function getConfig(params) {
    const rawText = await apiFetch({
        baseUrl: params.baseUrl,
        endpoint: 'ilink/bot/getconfig',
        body: JSON.stringify({
            ilink_user_id: params.ilinkUserId,
            context_token: params.contextToken,
            base_info: { channel_version: '1.0.0' },
        }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? 10_000,
        label: 'getConfig',
    });
    return JSON.parse(rawText);
}
/**
 * Send typing indicator
 */
export async function sendTyping(params) {
    await apiFetch({
        baseUrl: params.baseUrl,
        endpoint: 'ilink/bot/sendtyping',
        body: JSON.stringify({
            ...params.body,
            base_info: { channel_version: '1.0.0' },
        }),
        token: params.token,
        timeoutMs: params.timeoutMs ?? 10_000,
        label: 'sendTyping',
    });
}
