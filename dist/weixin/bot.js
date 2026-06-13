import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, unlinkSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { initOpenCode, initFetchConfig } from '../opencode/client.js';
import { getAuthStatus } from '../core/auth.js';
import { registry } from '../core/registry.js';
import { fetchQRCode, pollQRStatus, getUpdates } from './api.js';
import { DEFAULT_BASE_URL } from './types.js';
import { createWeixinAdapter } from './adapter.js';
import { handleMessage } from './handler.js';
import { userAdapterMap } from './user-adapter-map.js';
export { COMMAND_ALIASES, detectCommand } from '../core/router.js';

const CONFIG_DIR = join(homedir(), '.opencode-remote');
const WEIXIN_DIR = join(CONFIG_DIR, 'weixin');
const CREDENTIALS_DIR = join(WEIXIN_DIR, 'credentials');
const INSTANCE_ID = process.env.OPENCODE_INSTANCE_ID || 'default';
const CREDENTIALS_FILE = INSTANCE_ID === 'default'
    ? join(WEIXIN_DIR, 'credentials.json')
    : join(WEIXIN_DIR, `credentials-${INSTANCE_ID}.json`);
const RESTART_NOTIFY_FILE = join(WEIXIN_DIR, 'restart-notify.json');

const botInstances = [];

export async function loginWithQR(baseUrl = DEFAULT_BASE_URL, onQRCode) {
    console.log('Starting Weixin login...');
    try {
        const qrResp = await fetchQRCode(baseUrl);
        if (!qrResp.qrcode_img_content) { console.error('Failed to get QR code'); return null; }
        console.log(`QR Code URL: ${qrResp.qrcode_img_content}`);
        if (onQRCode) onQRCode(qrResp.qrcode_img_content);
        const startTime = Date.now();
        const timeout = 8 * 60 * 1000;
        while (Date.now() - startTime < timeout) {
            const status = await pollQRStatus(baseUrl, qrResp.qrcode);
            switch (status.status) {
                case 'wait': process.stdout.write('.'); break;
                case 'scaned': console.log('\nScanned! Confirm on phone...'); break;
                case 'expired': console.log('\nQR expired.'); return null;
                case 'confirmed':
                    if (!status.bot_token || !status.ilink_bot_id) return null;
                    console.log('\nLogin successful!');
                    const creds = { token: status.bot_token, baseUrl: status.baseurl || baseUrl, accountId: status.ilink_bot_id, userId: status.ilink_user_id };
                    saveWeixinCredentials(creds);
                    return creds;
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        console.log('\nLogin timed out.');
        return null;
    } catch (e) { console.error('Login error:', e); return null; }
}

function ensureDirs() {
    if (!existsSync(WEIXIN_DIR)) mkdirSync(WEIXIN_DIR, { recursive: true });
    if (!existsSync(CREDENTIALS_DIR)) mkdirSync(CREDENTIALS_DIR, { recursive: true });
}

export function loadAllCredentials() {
    ensureDirs();
    if (existsSync(CREDENTIALS_DIR)) {
        const files = readdirSync(CREDENTIALS_DIR).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
            return files.map(f => {
                try { return JSON.parse(readFileSync(join(CREDENTIALS_DIR, f), 'utf-8')); }
                catch (e) { console.debug('[credentials] Failed to parse:', f, e.message); return null; }
            }).filter(Boolean);
        }
    }
    if (existsSync(CREDENTIALS_FILE)) {
        try { return [JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'))]; } catch (e) { console.debug('[credentials] Failed to parse legacy:', e.message); }
    }
    return [];
}

export function loadWeixinCredentials() {
    const all = loadAllCredentials();
    return all.length > 0 ? all[0] : null;
}

export function saveWeixinCredentials(creds) {
    ensureDirs();
    const filePath = join(CREDENTIALS_DIR, `credentials-${creds.accountId}.json`);
    writeFileSync(filePath, JSON.stringify({ ...creds, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
    try { const s = statSync(filePath); chmodSync(filePath, (s.mode & 0o777) | 0o600); } catch (e) { console.warn('[credentials] chmod failed:', e.message); }
}

export function saveCredential(creds) {
    saveWeixinCredentials(creds);
}

let _restartCallback = null;
function setRestartCallback(fn) { _restartCallback = fn; }

async function runPollingLoop(adapter, baseUrl, token, openCodeSessions, signal) {
    let buf = '';
    let retryCount = 0;
    while (!signal.aborted) {
        try {
            const resp = await getUpdates({ baseUrl, token, get_updates_buf: buf });
            if (signal.aborted) break;
            if (resp.get_updates_buf) buf = resp.get_updates_buf;
            for (const msg of (resp.msgs || [])) {
                if (msg.message_type !== 1) continue;
                const textItem = msg.item_list?.find((i) => i.type === 1);
                const text = textItem?.text_item?.text;
                const fromUserId = msg.from_user_id;
                if (!fromUserId || !text) continue;
                userAdapterMap.set(fromUserId, adapter);
                const messageId = msg.message_id?.toString();
                if (adapter.isDuplicate(messageId)) continue;
                if (msg.context_token) adapter.contextTokens.set(fromUserId, msg.context_token);
                handleMessage(adapter, { platform: 'weixin', threadId: fromUserId, userId: fromUserId, messageId }, text, openCodeSessions).catch(e => console.error('Handle error:', e));
            }
        } catch (e) {
            if (signal.aborted) break;
            const errMsg = e.message || '';
            const isConnReset = errMsg.includes('ECONNRESET') || errMsg.includes('fetch failed');
            if (isConnReset) {
                retryCount++;
                const delay = Math.min(2000 * retryCount, 15000);
                console.error(`[bot] Connection error (${retryCount}), retry in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                console.error('Polling error:', e);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
}

export function addBotInstance(creds, openCodeSessions) {
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
    const token = creds.token;
    const botId = creds.accountId;
    const adapter = createWeixinAdapter(baseUrl, token, botId);
    const abortController = new AbortController();
    const instance = { adapter, abortController, creds };
    botInstances.push(instance);
    runPollingLoop(adapter, baseUrl, token, openCodeSessions, abortController.signal).catch(e => console.error('[bot] Polling loop ended:', e));
    return instance;
}

export async function startWeixinBot(botConfig, restartFn) {
    if (restartFn) _restartCallback = restartFn;
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  OpenCode Remote Control - Weixin');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    await registry.loadBuiltInPlugins();

    let credentialsList = loadAllCredentials();
    if (credentialsList.length === 0) {
        console.log('No saved credentials. Starting login...');
        const creds = await loginWithQR(botConfig.weixinBaseUrl || DEFAULT_BASE_URL);
        if (!creds) { console.error('Login failed'); process.exit(1); }
        credentialsList = [creds];
    }
    const firstCreds = credentialsList[0];
    console.log(`Using account: ${firstCreds.accountId}${credentialsList.length > 1 ? ` (+${credentialsList.length - 1} more)` : ''}`);
    const openCodeSessions = new Map();

    try { await initOpenCode(); console.log('OpenCode ready'); } catch (e) { console.error('Failed to init OpenCode:', e); }

    try {
        const opencode = await initOpenCode();
        if (opencode) {
            const result = await opencode.client.session.list();
            if (!result.error && result.data && result.data.length > 0) {
                const sorted = result.data.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
                const latest = sorted[0];
                console.log(`Latest OpenCode session: ${latest.title || 'Untitled'} (${latest.id.slice(0, 8)}...)`);
                if (latest.directory) {
                    console.log(`Project directory: ${latest.directory}`);
                    globalThis.__autoProjectDir = latest.directory;
                }
            }
        }
    } catch (e) { console.warn('⚠️ Auto-resume failed:', e.message); }

    if (!getAuthStatus().weixin) {
        console.log('\n🔒 Bot not secured! First user to send /start becomes owner.\n');
    }

    for (const creds of credentialsList) {
        console.log(`Starting bot for account: ${creds.accountId}`);
        addBotInstance(creds, openCodeSessions);
    }

    const firstAdapter = botInstances[0]?.adapter;
    try {
        if (existsSync(RESTART_NOTIFY_FILE)) {
            const data = JSON.parse(readFileSync(RESTART_NOTIFY_FILE, 'utf8'));
            if (data.threadId && Date.now() - data.time < 60000 && firstAdapter) {
                await firstAdapter.reply(data.threadId, '✅ Bot 重启完成！');
            }
            unlinkSync(RESTART_NOTIFY_FILE);
        }
    } catch (e) { console.warn('[restart-notify] Failed to read restart file:', e.message); }

    let shouldRestart = false;
    const shutdown = (restart = false) => {
        console.log(restart ? '\nRestarting...' : '\nShutting down...');
        shouldRestart = restart;
        for (const instance of botInstances) {
            try { instance.abortController.abort(); } catch (e) { }
        }
        for (const [, s] of openCodeSessions.entries()) { try { s.server?.shutdown?.(); } catch (e) { console.warn('[shutdown] Server shutdown error:', e.message); } }
        openCodeSessions.clear();
    };

    globalThis.__weixinBotShutdown = (restart = false) => shutdown(restart);
    globalThis.__weixinBotRunning = () => botInstances.some(i => !i.abortController.signal.aborted);

    if (process.env.OPENCODE_RESTART === '1') {
        try {
            const restartInfoPath = join(process.env.HOME || process.cwd(), '.opencode-remote', '.restart_user.json');
            if (existsSync(restartInfoPath)) {
                const restartInfo = JSON.parse(readFileSync(restartInfoPath, 'utf8'));
                if (Date.now() - restartInfo.time < 60000 && firstAdapter) {
                    await firstAdapter.reply(restartInfo.threadId, '✅ Bot 重启完成！');
                    console.log('Sent restart notification to user');
                }
                unlinkSync(restartInfoPath);
            }
        } catch (e) {
            console.log('Could not send restart notification:', e.message);
        }
    }

    console.log(`✅ ${botInstances.length} bot instance(s) running`);

    await new Promise(resolve => {
        globalThis.__weixinBotShutdownAndExit = (restart) => {
            shutdown(restart);
            resolve();
        };
    });

    if (shouldRestart) {
        console.log('✅ Bot shutdown complete, exiting for restart...');
        process.exit(0);
    }
    return shouldRestart;
}
