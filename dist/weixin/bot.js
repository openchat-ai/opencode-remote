import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, chmodSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { initSessionManager, loadSessionMapping, saveSessionMapping } from '../core/session.js';
import { initOpenCode, initFetchConfig } from '../opencode/client.js';
import { getAuthStatus } from '../core/auth.js';
import { registry } from '../core/registry.js';
import { fetchQRCode, pollQRStatus, getUpdates } from './api.js';
import { DEFAULT_BASE_URL } from './types.js';
import { createWeixinAdapter } from './adapter.js';
import { handleMessage } from './handler.js';
export { COMMAND_ALIASES, detectCommand } from '../core/router.js';

const CONFIG_DIR = join(homedir(), '.opencode-remote');
const WEIXIN_DIR = join(CONFIG_DIR, 'weixin');
const INSTANCE_ID = process.env.OPENCODE_INSTANCE_ID || 'default';
const CREDENTIALS_FILE = INSTANCE_ID === 'default'
    ? join(WEIXIN_DIR, 'credentials.json')
    : join(WEIXIN_DIR, `credentials-${INSTANCE_ID}.json`);
const RESTART_NOTIFY_FILE = join(WEIXIN_DIR, 'restart-notify.json');

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

function ensureDirs() { if (!existsSync(WEIXIN_DIR)) mkdirSync(WEIXIN_DIR, { recursive: true }); }
export function loadWeixinCredentials() {
    ensureDirs();
    if (!existsSync(CREDENTIALS_FILE)) return null;
    try { return JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8')); } catch (e) { console.debug('[credentials] Failed to parse:', e.message); return null; }
}
export function saveWeixinCredentials(creds) {
    ensureDirs();
    writeFileSync(CREDENTIALS_FILE, JSON.stringify({ ...creds, savedAt: new Date().toISOString() }, null, 2), 'utf-8');
    try { const s = statSync(CREDENTIALS_FILE); chmodSync(CREDENTIALS_FILE, (s.mode & 0o777) | 0o600); } catch (e) { console.warn('[credentials] chmod failed:', e.message); }
}

let _restartCallback = null;
function setRestartCallback(fn) { _restartCallback = fn; }
export async function startWeixinBot(botConfig, restartFn) {
    if (restartFn) _restartCallback = restartFn;
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  OpenCode Remote Control - Weixin');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');

    await registry.loadBuiltInPlugins();

    try { await initFetchConfig(); } catch (e) { console.warn('⚠️ Fetch config failed:', e); }
    let credentials = loadWeixinCredentials();
    if (!credentials) {
        console.log('No saved credentials. Starting login...');
        credentials = await loginWithQR(botConfig.weixinBaseUrl || DEFAULT_BASE_URL);
        if (!credentials) { console.error('Login failed'); process.exit(1); }
    }
    console.log(`Using account: ${credentials.accountId}`);
    const baseUrl = credentials.baseUrl || DEFAULT_BASE_URL;
    const token = credentials.token;
    const botId = credentials.accountId;
    initSessionManager(botConfig);
    const openCodeSessions = new Map();
    const adapter = createWeixinAdapter(baseUrl, token, botId);
    try { await initOpenCode(); console.log('OpenCode ready'); } catch (e) { console.error('Failed to init OpenCode:', e); }
    
    try {
        const opencode = await initOpenCode();
        if (opencode) {
            const result = await opencode.client.session.list();
            if (!result.error && result.data && result.data.length > 0) {
                const sorted = result.data.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
                const latest = sorted[0];
                console.log(`Latest OpenCode session: ${latest.title || 'Untitled'} (${latest.id.slice(0, 8)}...)`);
                globalThis.__latestOpenCodeSession = { id: latest.id, directory: latest.directory };
                if (latest.directory) {
                    console.log(`Project directory: ${latest.directory}`);
                    globalThis.__autoProjectDir = latest.directory;
                    const { existsSync } = await import('fs');
                    const { join } = await import('path');
                    const memoryPath = join(latest.directory, 'MEMORY.md');
                    if (!existsSync(memoryPath)) {
                        console.log('Memory system not found, auto-initializing...');
                        const { initMemorySystem } = await import('./init-memory.js');
                        await initMemorySystem(latest.directory);
                        console.log('Memory system initialized.');
                    } else {
                        console.log('Memory system found.');
                    }
                }
            }
        }
    } catch (e) { console.warn('⚠️ Auto-resume failed:', e.message); }
    
    if (!getAuthStatus().weixin) {
        console.log('\n🔒 Bot not secured! First user to send /start becomes owner.\n');
    }
    
    try {
        if (existsSync(RESTART_NOTIFY_FILE)) {
            const data = JSON.parse(readFileSync(RESTART_NOTIFY_FILE, 'utf8'));
            if (data.threadId && Date.now() - data.time < 60000) {
                await adapter.reply(data.threadId, '✅ Bot 重启完成！');
            }
            unlinkSync(RESTART_NOTIFY_FILE);
        }
    } catch (e) { console.warn('[restart-notify] Failed to read restart file:', e.message); }
    
    let running = true;
    let shouldRestart = false;
    const shutdown = (restart = false) => {
        console.log(restart ? '\nRestarting...' : '\nShutting down...');
        saveSessionMapping();
        running = false;
        shouldRestart = restart;
        for (const [, s] of openCodeSessions.entries()) { try { s.server?.shutdown?.(); } catch (e) { console.warn('[shutdown] Server shutdown error:', e.message); } }
        openCodeSessions.clear();
    };
    
    globalThis.__weixinBotShutdown = (restart = false) => shutdown(restart);
    globalThis.__weixinBotRunning = () => running;

    let buf = '';
    console.log('Polling for messages...');

    if (process.env.OPENCODE_RESTART === '1') {
        try {
            const restartInfoPath = join(process.env.HOME || process.cwd(), '.opencode-remote', '.restart_user.json');
            if (existsSync(restartInfoPath)) {
                const restartInfo = JSON.parse(readFileSync(restartInfoPath, 'utf8'));
                if (Date.now() - restartInfo.time < 60000) {
                    await adapter.reply(restartInfo.threadId, '✅ Bot 重启完成！');
                    console.log('Sent restart notification to user');
                }
                unlinkSync(restartInfoPath);
            }
        } catch (e) {
            console.log('Could not send restart notification:', e.message);
        }
    }

    while (running) {
        try {
            const resp = await getUpdates({ baseUrl, token, get_updates_buf: buf });
            if (!running) break;
            if (resp.get_updates_buf) buf = resp.get_updates_buf;
            for (const msg of (resp.msgs || [])) {
                if (msg.message_type !== 1) continue;
                const textItem = msg.item_list?.find((i) => i.type === 1);
                const text = textItem?.text_item?.text;
                const fromUserId = msg.from_user_id;
                if (!fromUserId || !text) continue;
                const messageId = msg.message_id?.toString();
                if (adapter.isDuplicate(messageId)) continue;
                if (msg.context_token) adapter.contextTokens.set(fromUserId, msg.context_token);
                handleMessage(adapter, { platform: 'weixin', threadId: fromUserId, userId: fromUserId, messageId }, text, openCodeSessions).catch(e => console.error('Handle error:', e));
            }
        } catch (e) {
            if (!running) break;
            console.error('Polling error:', e);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    
    if (shouldRestart) {
        console.log('✅ Bot shutdown complete, exiting for restart...');
        process.exit(0);
    }
    return shouldRestart;
}
