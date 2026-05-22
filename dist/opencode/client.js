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
let lastReportedStatus = '';
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
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
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
            const { createOpencodeClient } = await import('@opencode-ai/sdk');
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
            body: { title },
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
                path: { id: sessionId }
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
export async function sendMessage(session, message, callbacks) {
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minute timeout
    const POLL_INTERVAL = 2000; // 2 seconds between polls
    
    try {
        // Verify session is valid first
        try {
            const sessionCheck = await session.client.session.get({ path: { id: session.sessionId } });
            if (sessionCheck.error) {
                console.error('[sendMessage] Session error:', sessionCheck.error);
                return '❌ 会话无效，请发送 /restart 重启';
            }
        } catch (e) {
            console.error('[sendMessage] Session check failed:', e.message);
            return '❌ 会话连接失败，请发送 /restart 重启';
        }
        
        // Get last message ID and count before sending
        let lastMsgId = null;
        let msgCountBefore = 0;
        try {
            const msgsBefore = await session.client.session.messages({ path: { id: session.sessionId } });
            if (msgsBefore.data?.length > 0) {
                lastMsgId = msgsBefore.data[msgsBefore.data.length - 1].info?.id;
                msgCountBefore = msgsBefore.data.length;
            }
        } catch { /* ignore */ }
        
        // Send message using promptAsync (non-blocking)
        const promptBody = {
            parts: [{ type: 'text', text: message }]
        };
        // Per-message model override if set on session
        if (session.model?.providerID && session.model?.modelID) {
            promptBody.model = {
                providerID: session.model.providerID,
                modelID: session.model.modelID,
            };
        }
        const sendResult = await session.client.session.promptAsync({
            path: { id: session.sessionId },
            body: promptBody,
        });

        // Poll for new response - keep going as long as new content keeps arriving
        const startTime = Date.now();
        const FIRST_RESPONSE_TIMEOUT = callbacks?.idleThreshold > 20 ? 120000 : 60000;
        let responseText = '';
        let hasToolActivity = false;
        let idleSince = 0; // 最后一次收到新内容的时间戳

        while (Date.now() - startTime < TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL));

            try {
                const msgsResult = await session.client.session.messages({
                    path: { id: session.sessionId }
                });

                if (msgsResult.error) { console.error('[sendMessage] Messages error:', msgsResult.error); break; }
                if (!msgsResult.data?.length) continue;

                const messages = msgsResult.data;

                // 工具活动
                for (let i = msgCountBefore; i < messages.length; i++) {
                    const msg = messages[i];
                    if (msg.parts) for (const part of msg.parts) {
                        if (part.type === 'tool_use' || part.type === 'tool_result') {
                            hasToolActivity = true;
                            callbacks?.onEvent?.({ type: 'tool.call', properties: { name: part.name || part.tool_name || 'unknown', input: part.input || {} } });
                            break;
                        }
                    }
                    if (hasToolActivity) break;
                }

                // 收集所有新的 assistant 回复（累加，不丢内容）
                if (lastMsgId) {
                    const idx = messages.findIndex(m => m.info?.id === lastMsgId);
                    const startIdx = idx >= 0 ? idx + 1 : 0;
                    const newParts = [];
                    for (let i = startIdx; i < messages.length; i++) {
                        const msg = messages[i];
                        if (msg.info?.role === 'assistant' && msg.parts) {
                            for (const p of msg.parts) {
                                if (p.type === 'text' && p.text) newParts.push(p.text);
                            }
                        }
                    }
                    const fullText = newParts.join('\n');
                    if (fullText && fullText !== responseText) {
                        const delta = fullText.slice(responseText.length);
                        responseText = fullText;
                        callbacks?.onTextDelta?.(delta);
                        callbacks?.onNewContent?.(delta);
                        idleSince = Date.now();
                        continue;
                    }
                }

                // 第一条回复超时
                if (!responseText && Date.now() - startTime > FIRST_RESPONSE_TIMEOUT) {
                    console.warn('[sendMessage] First response timeout');
                    const finalMsgs = await session.client.session.messages({ path: { id: session.sessionId }, query: { limit: 50 } }).catch(() => {});
                    if (finalMsgs?.data?.length) {
                        for (let i = finalMsgs.data.length - 1; i >= 0; i--) {
                            const msg = finalMsgs.data[i];
                            if (msg.info?.role === 'assistant' && msg.parts) {
                                const parts = msg.parts.filter(p => p.type === 'text' && p.text);
                                if (parts.length) { responseText = parts.map(p => p.text).join('\n'); break; }
                            }
                        }
                    }
                    break;
                }

                // 检查 AI 是否还在忙（thinking/pending_tool 说明还没干完）
                const latestStatus = msgsResult.data?.length ? msgsResult.data[msgsResult.data.length - 1]?.info?.status : '';
                if (latestStatus === 'thinking' || latestStatus === 'pending_tool') {
                    idleSince = Date.now();
                }
                if (latestStatus && latestStatus !== lastReportedStatus) {
                    lastReportedStatus = latestStatus;
                    console.log(`[AI状态] ${latestStatus}`);
                }

                // 有回复后：等 30 秒无新内容且 AI 不忙才退出
                if (responseText && Date.now() - idleSince > 30000) {
                    break;
                }
            } catch (e) {
                console.warn('Poll error:', e.message);
            }
        }
        
        if (!responseText) {
            console.warn('⏰ Timeout waiting for response, status:', lastStatus);
            // Try one more time with a fresh message query
            try {
                const finalMsgs = await session.client.session.messages({ path: { id: session.sessionId }, query: { limit: 50 } });
                if (finalMsgs.data?.length) {
                    for (let i = finalMsgs.data.length - 1; i >= 0; i--) {
                        const msg = finalMsgs.data[i];
                        if (msg.info?.role === 'assistant' && msg.parts) {
                            const textParts = msg.parts.filter(p => p.type === 'text' && p.text).map(p => p.text);
                            if (textParts.length > 0) {
                                responseText = textParts.join('\n');
                                break;
                            }
                        }
                    }
                }
            } catch { /* ignore */ }
            
            if (!responseText) {
                return '⏰ 请求超时，请重试';
            }
        }
        
        callbacks?.onStatusChange?.({ type: 'idle', hasToolActivity });
        console.log(`💬 Response: ${responseText.slice(0, 100)}...`);
        return responseText;
    }
    catch (error) {
        console.error('Error sending message:', error);
        return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
}
export async function getSession(session) {
    try {
        const result = await session.client.session.get({
            path: { id: session.sessionId }
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
            path: { id: session.sessionId }
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
            path: { id: session.sessionId }
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
            path: { id: session.sessionId }
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
        const getResult = await opencode.client.session.get({ path: { id: sessionId } });
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
            status: s.status?.type || 'unknown',
            directory: s.directory || '',
            createdAt: s.created_at || 0,
            lastActivity: s.updated_at || 0,
        }));
    }
    catch (error) {
        console.error('Failed to list OpenCode sessions:', error.message);
        return [];
    }
}
export async function listOpenCodeSessionsFromServer(baseUrl) {
    try {
        const { createOpencodeClient } = await import('@opencode-ai/sdk');
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
            status: s.status?.type || 'unknown',
            directory: s.directory || '',
            createdAt: s.created_at || 0,
            lastActivity: s.updated_at || 0,
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
            body: { title }
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
            path: { id: sessionId }
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
        const result = await session.client.session.patch({
            path: { id: session.sessionId },
            body: { title }
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
            path: { id: sessionId },
            body: { messageID },
            query: directory ? { directory } : {}
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
            path: { id: sessionId },
            body: { messageID, partID }
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
            path: { id: sessionId }
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
        const result = await opencode.client.provider.list();
        if (result.error || !result.data?.all) return null;
        return result.data.all;
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
            body: { model: modelStr },
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
