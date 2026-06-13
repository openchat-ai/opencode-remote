// OpenCode SDK client for remote control
import '../patch_spawn.js';
import { createRequire } from 'node:module';
import { platform } from 'node:os';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { Socket } from 'net';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.opencode-remote');
const CONFIG_FILE = join(CONFIG_DIR, '.env');

const threadModels = new Map();
const recentModels = [];
let rawDebugEnabled = false;
let thinkVisibleEnabled = false;

export function setRawDebug(enabled) {
    rawDebugEnabled = enabled;
    console.log(`[rawDebug] ${enabled ? 'ON' : 'OFF'}`);
}
export function isRawDebug() {
    return rawDebugEnabled || process.env.DEBUG_RAW === '1';
}
export function setThinkVisible(enabled) {
    thinkVisibleEnabled = enabled;
    console.log(`[think] ${enabled ? 'ON' : 'OFF'}`);
}
export function isThinkVisible() {
    return thinkVisibleEnabled;
}
export function setThreadModel(threadId, modelStr) {
    if (!modelStr || !modelStr.includes('/')) {
        threadModels.delete(threadId);
        return null;
    }
    const parts = modelStr.split('/');
    const entry = { providerID: parts[0], modelID: parts.slice(1).join('/') };
    threadModels.set(threadId, entry);
    pushRecent(entry);
    return entry;
}

export function getThreadModel(threadId) {
    return threadModels.get(threadId);
}

export function getRecentModels() {
    return [...recentModels];
}

export function pushRecentModel(entry) {
    pushRecent(entry);
}

function pushRecent(entry) {
    const key = `${entry.providerID}/${entry.modelID}`;
    const idx = recentModels.findIndex(e => `${e.providerID}/${e.modelID}` === key);
    if (idx !== -1) recentModels.splice(idx, 1);
    recentModels.unshift(entry);
    if (recentModels.length > 5) recentModels.length = 5;
}

// Find opencode.exe binary
function findOpenCodeExe() {
    const isWindows = platform() === 'win32';
    if (isWindows) {
        // Try common locations
        const candidates = [
            join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'node_modules', 'opencode-windows-x64', 'bin', 'opencode.exe'),
            join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'node_modules', 'opencode-windows-x64-baseline', 'bin', 'opencode.exe'),
            join(process.env.LOCALAPPDATA || '', 'Programs', 'opencode', 'opencode.exe'),
        ];
        for (const p of candidates) {
            if (existsSync(p)) return p;
        }
        // Fallback: let shell resolve from PATH
        return 'opencode';
    }
    // Linux/Mac: check common locations
    const candidates = [
        '/opt/homebrew/bin/opencode',   // Mac Homebrew (Apple Silicon)
        '/usr/local/bin/opencode',       // Mac Homebrew (Intel) / Linux
        join(process.env.HOME || '', '.local', 'bin', 'opencode'), // Linux common
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    // Fallback: let shell resolve from PATH
    return 'opencode';
}

let globalProxyUrl = null;
/**
 * Set the global proxy URL.
 */
export function setGlobalProxy(url) {
    globalProxyUrl = url;
}
/**
 * Get the current proxy URL.
 * Priority: explicitly set > HTTPS_PROXY > HTTP_PROXY > ALL_PROXY
 */
export function getProxyUrl() {
    if (globalProxyUrl)
        return globalProxyUrl;
    // Check environment variables in order of priority
    // For HTTPS requests, HTTPS_PROXY takes precedence
    // For HTTP requests, HTTP_PROXY takes precedence
    // ALL_PROXY is a fallback for both
    return (process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy ||
        null);
}
// Timeout configuration - can be customized via config file or environment variables
// Default: 30 minutes for request timeout, 1 minute for keep-alive
const DEFAULT_REQUEST_TIMEOUT_MINUTES = 30;
const DEFAULT_KEEP_ALIVE_SECONDS = 60;
/**
 * Read timeout setting from config file
 */
function readTimeoutFromConfig() {
    if (!existsSync(CONFIG_FILE))
        return null;
    try {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        const match = content.match(/OPENCODE_REQUEST_TIMEOUT_MINUTES=(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
    }
    catch {
        // Ignore read errors
    }
    return null;
}
/**
 * Get request timeout in milliseconds.
 * Priority: environment variable > config file > default
 * Default: 30 minutes
 */
function getRequestTimeoutMs() {
    // First check environment variable
    if (process.env.OPENCODE_REQUEST_TIMEOUT_MINUTES) {
        const minutes = parseInt(process.env.OPENCODE_REQUEST_TIMEOUT_MINUTES, 10);
        if (!isNaN(minutes) && minutes > 0) {
            return minutes * 60 * 1000;
        }
    }
    // Then check config file
    const configValue = readTimeoutFromConfig();
    if (configValue !== null && configValue > 0) {
        return configValue * 60 * 1000;
    }
    // Fall back to default
    return DEFAULT_REQUEST_TIMEOUT_MINUTES * 60 * 1000;
}
/**
 * Get keep-alive timeout in milliseconds.
 * Set via OPENCODE_KEEP_ALIVE_SECONDS environment variable.
 * Default: 60 seconds
 */
function getKeepAliveMs() {
    const seconds = parseInt(process.env.OPENCODE_KEEP_ALIVE_SECONDS || String(DEFAULT_KEEP_ALIVE_SECONDS), 10);
    return seconds * 1000;
}
/**
 * Configure undici global dispatcher with proper timeouts.
 * This fixes the default 5-minute timeout issue.
 * Must be called before any fetch requests are made.
 */
async function configureGlobalDispatcher() {
    const { setGlobalDispatcher, Agent, ProxyAgent } = await import('undici');
    const proxyUrl = getProxyUrl();
    const requestTimeoutMs = getRequestTimeoutMs();
    const keepAliveMs = getKeepAliveMs();
    if (proxyUrl) {
        // Use ProxyAgent for proxy connections
        const proxyAgent = new ProxyAgent({
            uri: proxyUrl,
            requestTls: {
                timeout: requestTimeoutMs,
            },
        });
        setGlobalDispatcher(proxyAgent);
        console.log(`✅ Proxy agent initialized (timeout: ${requestTimeoutMs / 60000}min)`);
    }
    else {
        // Use regular Agent with extended timeouts
        const agent = new Agent({
            headersTimeout: requestTimeoutMs,
            bodyTimeout: requestTimeoutMs,
            keepAliveTimeout: keepAliveMs,
            keepAliveMaxTimeout: requestTimeoutMs,
        });
        setGlobalDispatcher(agent);
        console.log(`✅ HTTP agent initialized (timeout: ${requestTimeoutMs / 60000}min)`);
    }
}
// Track if dispatcher has been configured
let dispatcherConfigured = false;
/**
 * Initialize fetch with proper timeouts and proxy configuration.
 * This is now async and must be awaited.
 * Call this before making any fetch requests if you need proxy support.
 */
export async function initFetchConfig() {
    if (dispatcherConfigured)
        return;
    try {
        await configureGlobalDispatcher();
        dispatcherConfigured = true;
    }
    catch (err) {
        console.warn('⚠️ Failed to configure HTTP dispatcher:', err);
        // Continue anyway - default timeouts will be used
    }
}
let opencodeInstance = null;
let opencodeServer = null;
let lastStdoutTime = 0;
let lastStdoutLine = '';
const PORTS_TO_TRY = [4096, 4097, 4098];

// TCP-level port probe: true = occupied, false = free
function probeTCP(port, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const socket = new Socket();
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => { socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); resolve(true); });
        socket.on('error', () => { socket.destroy(); resolve(false); });
        socket.connect(port, '127.0.0.1');
    });
}

async function tryConnectPort(port, timeoutMs = 5000) {
    const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
    const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
    const result = await Promise.race([
        client.session.list(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    if (result.error) return null;
    return { client };
}

export async function initOpenCode() {
    await initFetchConfig();
    if (opencodeInstance) {
        return opencodeInstance;
    }

    // Try to connect to existing OpenCode server (try multiple ports)
    for (const port of PORTS_TO_TRY) {
        // Quick TCP probe first - avoid hanging on dead processes
        const occupied = await probeTCP(port, 1000);
        if (occupied) {
            try {
                const result = await tryConnectPort(port);
                if (result) {
                    console.log(`✅ Connected to existing OpenCode server (localhost:${port})`);
                    opencodeInstance = { client: result.client, server: null };
                    return opencodeInstance;
                }
            } catch { /* not opencode server */ }
        }
    }

    // Auto-start OpenCode server (try ports in sequence)
    if (!opencodeServer) {
        const exePath = findOpenCodeExe();
        const isWindows = platform() === 'win32';
        const useShell = !isWindows || !existsSync(exePath);
        let started = false;

        for (const port of PORTS_TO_TRY) {
            const occupied = await probeTCP(port, 500);
            if (occupied) {
                console.log(`⚠️ Port ${port} occupied, trying next...`);
                continue;
            }

            console.log(`🚀 Starting OpenCode server on port ${port}...`);
            opencodeServer = spawn(exePath, ['serve', `--hostname=127.0.0.1`, `--port=${port}`], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env },
                shell: useShell,
                windowsHide: isWindows,
            });
            opencodeServer.stdout.on('data', (d) => {
                lastStdoutTime = Date.now();
                const msg = d.toString().trim();
                if (msg) { lastStdoutLine = msg.slice(0, 120); console.log(`[opencode] ${msg}`); }
            });
            opencodeServer.stderr.on('data', (d) => {
                const msg = d.toString().trim();
                if (msg && !msg.includes('DEP0040') && !msg.includes('DEP0190')) console.error(`[opencode] ${msg}`);
            });
            opencodeServer.on('exit', (code) => console.log(`[opencode] exited with code ${code}`));

            // Wait for server to be ready
            const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                    const client = createOpencodeClient({ baseUrl: `http://localhost:${port}` });
                    const r = await client.session.list();
                    if (!r.error) {
                        console.log(`✅ OpenCode server ready (localhost:${port})`);
                        opencodeInstance = { client, server: opencodeServer };
                        started = true;
                        return opencodeInstance;
                    }
                } catch { /* not ready yet */ }
            }
            // Server didn't start on this port, kill and try next
            try { opencodeServer.kill(); } catch {}
            opencodeServer = null;
            console.log(`⚠️ OpenCode server failed to start on port ${port}, trying next...`);
        }

        if (!started) {
            console.error('❌ OpenCode server did not start on any port');
            return null;
        }
    }
    return null;
}
export async function verifyOpenCodeInstalled() {
    return new Promise((resolve) => {
        const isWindows = platform() === 'win32';
        const command = isWindows ? 'where' : 'which';
        const proc = spawn(command, ['opencode'], { shell: isWindows });
        let output = '';
        let errorOutput = '';
        proc.stdout?.on('data', (chunk) => {
            output += chunk.toString();
        });
        proc.stderr?.on('data', (chunk) => {
            errorOutput += chunk.toString();
        });
        proc.on('close', (code) => {
            if (code === 0 && output.trim()) {
                resolve({ ok: true });
            }
            else {
                resolve({
                    ok: false,
                    error: `OpenCode not found in PATH. Please install it first:\n  npm install -g @opencode-ai/opencode\n\nThen verify with:\n  opencode --version`
                });
            }
        });
        proc.on('error', (err) => {
            resolve({
                ok: false,
                error: `Failed to check OpenCode installation: ${err.message}\n\nPlease ensure OpenCode is installed:\n  npm install -g @opencode-ai/opencode`
            });
        });
    });
}
export async function createSession(_threadId, title = `Remote control session`) {
    const opencode = await initOpenCode();
    try {
        const createResult = await opencode.client.session.create({
            title,
        });
        if (createResult.error) {
            console.error('Failed to create session:', createResult.error);
            return null;
        }
        const sessionId = createResult.data.id;
        console.log(`✅ Created OpenCode session: ${sessionId}`);
        let shareUrl;
        if (process.env.SHARE_SESSIONS === 'true') {
            const shareResult = await opencode.client.session.share({
                sessionID: sessionId,
            });
            if (!shareResult.error && shareResult.data?.share?.url) {
                shareUrl = shareResult.data.share.url;
                console.log(`🔗 Session shared: ${shareUrl}`);
            }
        }
        return {
            sessionId,
            client: opencode.client,
            server: opencode.server,
            shareUrl,
        };
    }
    catch (error) {
        console.error('Error creating session:', error);
        return null;
    }
}
// Send message - use promptAsync then poll for response
export async function sendMessage(session, message, callbacks, threadId) {
    const TIMEOUT_MS = 5 * 60 * 1000;

    try {
        // Verify session is valid first
        try {
            const sessionCheck = await session.client.session.get({ sessionID: session.sessionId });
            if (sessionCheck.error) {
                console.error('[sendMessage] Session error:', sessionCheck.error);
                return '❌ 会话无效，请发送 /restart 重启';
            }
        } catch (e) {
            console.error('[sendMessage] Session check failed:', e.message);
            return '❌ 会话连接失败，请发送 /restart 重启';
        }

        // Build prompt body
        const promptBody = {
            parts: [{ type: 'text', text: message }]
        };
        // Inject local model preference if set
        if (threadId && threadModels.has(threadId)) {
            session.model = threadModels.get(threadId);
            pushRecent(session.model);
        }
        // Per-message model override if set on session
        if (session.model?.providerID && session.model?.modelID) {
            promptBody.model = {
                providerID: session.model.providerID,
                modelID: session.model.modelID,
            };
        }

        // Stream the response via session.prompt (POST /session/{sessionID}/message)
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), TIMEOUT_MS);

        try {
            const response = await session.client.session.prompt({
                sessionID: session.sessionId,
                parts: promptBody.parts,
                ...(promptBody.model ? { model: promptBody.model } : {}),
            }, {
                parseAs: 'stream',
                signal: abortController.signal,
            });

            if (response.error) {
                return `❌ 发送失败: ${response.error}`;
            }

            const stream = response.data;
            if (!stream) {
                return '❌ 未收到响应流';
            }

            const reader = stream.getReader();
            const decoder = new TextDecoder();
            let rawJson = '';
            let responseText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                if (!chunk) continue;
                rawJson += chunk;
            }

            // Parse the full response JSON
            if (isRawDebug()) console.log('[RAW]', rawJson);
            try {
                const parsed = JSON.parse(rawJson);
                const t = parsed.info?.tokens || {};
                const time = parsed.info?.time || {};
                const elapsed = time.completed && time.created ? `${(time.completed - time.created) / 1000}s` : '?';
                const cacheRead = t.cache?.read || 0;
                const cacheWrite = t.cache?.write || 0;
                const cacheRate = cacheRead + cacheWrite > 0 ? `${(cacheRead / (cacheRead + cacheWrite) * 100).toFixed(0)}%` : '-';
                console.log(`[RESPONSE] ${parsed.info?.providerID}/${parsed.info?.modelID} │ ${elapsed} │ tokens=${t.total || '?'} (in=${t.input} out=${t.output} rsn=${t.reasoning}) │ cache ${cacheRate} │ finish=${parsed.info?.finish || '?'}`);
                const meta = { modelID: parsed.info?.modelID, providerID: parsed.info?.providerID, tokens: t, parts: parsed.parts };
                callbacks?.onResponseMeta?.(meta);
                if (parsed.parts) {
                    for (const part of parsed.parts) {
                        if (part.type === 'text' && part.text) {
                            responseText += part.text;
                            callbacks?.onNewContent?.(part.text);
                            callbacks?.onTextDelta?.(part.text);
                        }
                        if (part.type === 'reasoning' && part.text) {
                            const cleaned = part.text.replace(/\n/g, ' ').trim();
                            console.log(`[REASONING] ${cleaned.slice(0, 300)}`);
                            if (thinkVisibleEnabled) {
                                responseText += `\n🤔 思考: ${cleaned}\n━━━━━━━━━━━━━━━━━━\n`;
                                callbacks?.onNewContent?.(`\n🤔 思考: ${cleaned}\n━━━━━━━━━━━━━━━━━━\n`);
                            }
                        }
                    }
                }
                if (!responseText && parsed.info?.finish) {
                    responseText = '[empty response]';
                }
            } catch (e) {
                console.error('[sendMessage] Failed to parse response:', e.message);
                console.log('[RAW]', rawJson.slice(0, 1000));
                responseText = rawJson;
            }

            callbacks?.onStatusChange?.({ type: 'idle' });
            return responseText;

        } finally {
            clearTimeout(timeoutId);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.warn('[sendMessage] 5min timeout, aborting stream');
            return '⏰ 请求超时，请重试';
        }
        console.error('[sendMessage] Error:', error);
        return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}
export async function getSession(session) {
    try {
        const result = await session.client.session.get({
            sessionID: session.sessionId
        });
        if (result.error) {
            return null;
        }
        return result.data;
    }
    catch {
        return null;
    }
}
export async function shareSession(session) {
    try {
        const result = await session.client.session.share({
            sessionID: session.sessionId
        });
        if (result.error || !result.data?.share?.url) {
            return null;
        }
        return result.data.share.url;
    }
    catch {
        return null;
    }
}
export function getOpenCode() {
    return opencodeInstance;
}
export async function checkConnection() {
    try {
        const opencode = await initOpenCode();
        return !!opencode?.client;
    }
    catch {
        return false;
    }
}
export async function abortSession(session) {
    try {
        await session.client.session.abort({
            sessionID: session.sessionId
        });
        console.log(`🛑 Aborted session: ${session.sessionId}`);
        return true;
    }
    catch (error) {
        console.error('Failed to abort session:', error.message);
        return false;
    }
}
export async function getSessionMessages(session, limit = 20) {
    try {
        const result = await session.client.session.messages({
            sessionID: session.sessionId
        });
        if (result.error) {
            return null;
        }
        const messages = result.data || [];
        return messages.slice(-limit);
    }
    catch {
        return null;
    }
}
export async function resumeSession(sessionId, title = 'Resumed session') {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return null;
        const getResult = await opencode.client.session.get({ sessionID: sessionId });
        if (getResult.error) {
            console.warn(`Session ${sessionId} not found`);
            return null;
        }
        console.log(`✅ Resumed OpenCode session: ${sessionId}`);
        return { sessionId, client: opencode.client, server: opencode.server, shareUrl: undefined };
    }
    catch (error) {
        console.error('Error resuming session:', error.message);
        return null;
    }
}
export async function listOpenCodeSessions() {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return [];
        const result = await opencode.client.session.list();
        if (result.error) {
            return [];
        }
        const sessions = result.data || [];
        return sessions.map(s => ({
            id: s.id,
            title: s.title || 'Untitled',
            directory: s.directory || '',
            createdAt: s.created_at || s.time?.created || 0,
            lastActivity: s.updated_at || s.time?.updated || 0,
        }));
    }
    catch (error) {
        console.error('Failed to list OpenCode sessions:', error.message);
        return [];
    }
}
export async function listOpenCodeSessionsFromServer(baseUrl) {
    try {
        const { createOpencodeClient } = await import('@opencode-ai/sdk/v2');
        const client = createOpencodeClient({
            baseUrl: baseUrl || 'http://localhost:4096',
        });
        const result = await client.session.list();
        if (result.error) {
            return [];
        }
        const sessions = result.data || [];
        return sessions.map(s => ({
            id: s.id,
            title: s.title || 'Untitled',
            directory: s.directory || '',
            createdAt: s.created_at || s.time?.created || 0,
            lastActivity: s.updated_at || s.time?.updated || 0,
        }));
    }
    catch (error) {
        console.error('Failed to list OpenCode sessions from server:', error.message);
        return [];
    }
}
export async function createOpenCodeSession(title = 'New session') {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return null;
        const result = await opencode.client.session.create({
            title
        });
        if (result.error) {
            return null;
        }
        const session = {
            sessionId: result.data.id,
            client: opencode.client,
            server: opencode.server,
            shareUrl: undefined,
        };
        console.log(`✅ Created new OpenCode session: ${session.sessionId}`);
        return session;
    }
    catch (error) {
        console.error('Failed to create OpenCode session:', error.message);
        return null;
    }
}
export async function deleteOpenCodeSession(sessionId) {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return false;
        const result = await opencode.client.session.delete({
            sessionID: sessionId
        });
        if (result.error) {
            return false;
        }
        console.log(`🗑️ Deleted OpenCode session: ${sessionId}`);
        return true;
    }
    catch (error) {
        console.error('Failed to delete OpenCode session:', error.message);
        return false;
    }
}
export async function renameOpenCodeSession(session, title) {
    try {
        const result = await session.client.session.update({
            sessionID: session.sessionId,
            title,
        });
        if (result.error) {
            return false;
        }
        console.log(`🏷️ Renamed session to: ${title}`);
        return true;
    }
    catch (error) {
        console.error('Failed to rename session:', error.message);
        return false;
    }
}
export async function forkSession(sessionId, messageID, directory) {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return null;
        const result = await opencode.client.session.fork({
            sessionID: sessionId,
            messageID,
            ...(directory ? { directory } : {}),
        });
        if (result.error) {
            console.warn(`Fork failed: ${result.error}`);
            return null;
        }
        const newSession = result.data;
        console.log(`🔀 Forked session ${sessionId.slice(0, 8)}... at message ${messageID} → ${newSession.id.slice(0, 8)}...`);
        return {
            sessionId: newSession.id,
            client: opencode.client,
            server: opencode.server,
            shareUrl: undefined,
        };
    }
    catch (error) {
        console.error('Failed to fork session:', error.message);
        return null;
    }
}
export async function revertSessionMessage(sessionId, messageID, partID) {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return false;
        const result = await opencode.client.session.revert({
            sessionID: sessionId,
            messageID,
            partID,
        });
        if (result.error) {
            console.warn(`Revert failed: ${result.error}`);
            return false;
        }
        console.log(`↩️ Reverted session ${sessionId.slice(0, 8)}... to message ${messageID}`);
        return true;
    }
    catch (error) {
        console.error('Failed to revert session:', error.message);
        return false;
    }
}
export async function unrevertSession(sessionId) {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return false;
        const result = await opencode.client.session.unrevert({
            sessionID: sessionId
        });
        if (result.error) {
            console.warn(`Unrevert failed: ${result.error}`);
            return false;
        }
        console.log(`↩️ Unreverted session ${sessionId.slice(0, 8)}...`);
        return true;
    }
    catch (error) {
        console.error('Failed to unrevert session:', error.message);
        return false;
    }
}

export async function listProviders() {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return null;
        // Config2.providers() → GET /config/providers (same as v1)
        const result = await opencode.client.config.providers();
        if (result.error) return null;
        // v2 returns { providers: [...] }, v1 returns { all: [...] }
        const data = result.data?.providers || result.data?.all || result.data || [];
        return Array.isArray(data) ? data : null;
    } catch (error) {
        console.error('Failed to list providers:', error.message);
        return null;
    }
}

export async function updateGlobalModel(modelStr) {
    try {
        const opencode = await initOpenCode();
        if (!opencode) return false;
        const result = await opencode.client.config.update({
            config: { model: modelStr },
        });
        if (result.error) {
            console.error('Failed to update model:', result.error);
            return false;
        }
        console.log(`✅ Global model updated to: ${modelStr}`);
        return true;
    } catch (error) {
        console.error('Failed to update model:', error.message);
        return false;
    }
}
