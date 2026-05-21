// Session manager - per-conversation state with disk persistence
import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readFile, writeFile, unlink } from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';

const SESSIONS_DIR = join(homedir(), '.opencode-remote', 'sessions');
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

class SessionManager {
    sessions = new Map();
    cleanupTimer;

    async start() {
        await mkdir(SESSIONS_DIR, { recursive: true });
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
        console.log(`Session manager started (sessions: ${SESSIONS_DIR})`);
    }

    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
    }

    async getOrCreateSession(platform, channelId, threadId, agent = 'opencode') {
        const key = `${platform}:${channelId}:${threadId}`;
        const now = new Date();

        let session = this.sessions.get(key);
        if (session) {
            if (now.getTime() - session.lastActivity.getTime() > session.ttl) {
                session = undefined;
            } else {
                session.lastActivity = now;
                await this.saveSession(key, session);
                return session;
            }
        }

        session = await this.loadSession(key);
        if (session && now.getTime() - session.lastActivity.getTime() <= session.ttl) {
            session.lastActivity = now;
            this.sessions.set(key, session);
            await this.saveSession(key, session);
            return session;
        }

        session = {
            id: `${platform}-${channelId}-${threadId}-${Date.now()}`,
            channelId,
            threadId,
            platform,
            agent,
            createdAt: now,
            lastActivity: now,
            ttl: DEFAULT_TTL,
            messages: [],
            opencodeSessionId: undefined,
            pendingApprovals: [],
            viewMode: 'phone',
            projectDir: undefined,
            taskStartTime: null,
            currentTool: null,
            modifiedFiles: [],
        };

        this.sessions.set(key, session);
        await this.saveSession(key, session);
        return session;
    }

    async getExistingSession(platform, channelId, threadId) {
        const key = `${platform}:${channelId}:${threadId}`;
        const now = new Date();

        let session = this.sessions.get(key);
        if (session) {
            if (now.getTime() - session.lastActivity.getTime() > session.ttl) {
                return undefined;
            }
            return session;
        }

        session = await this.loadSession(key);
        if (session && now.getTime() - session.lastActivity.getTime() <= session.ttl) {
            this.sessions.set(key, session);
            return session;
        }
        return undefined;
    }

    async switchAgent(platform, channelId, threadId, newAgent) {
        const key = `${platform}:${channelId}:${threadId}`;
        const existing = this.sessions.get(key) || await this.loadSession(key);
        const now = new Date();

        const session = {
            id: `${platform}-${channelId}-${threadId}-${Date.now()}`,
            channelId,
            threadId,
            platform,
            agent: newAgent,
            createdAt: existing?.createdAt || now,
            lastActivity: now,
            ttl: DEFAULT_TTL,
            messages: existing?.messages || [],
            opencodeSessionId: existing?.opencodeSessionId,
            pendingApprovals: existing?.pendingApprovals || [],
            viewMode: existing?.viewMode || 'phone',
        };

        this.sessions.set(key, session);
        await this.saveSession(key, session);
        return session;
    }

    async addMessage(platform, channelId, threadId, message) {
        const key = `${platform}:${channelId}:${threadId}`;
        const session = this.sessions.get(key) || await this.loadSession(key);
        if (session) {
            session.messages.push(message);
            session.lastActivity = new Date();
            this.sessions.set(key, session);
            await this.saveSession(key, session);
        }
    }

    async resetConversation(platform, channelId, threadId) {
        const key = `${platform}:${channelId}:${threadId}`;
        const session = this.sessions.get(key) || await this.loadSession(key);
        if (session) {
            session.messages = [];
            session.lastActivity = new Date();
            session.id = `${platform}-${channelId}-${threadId}-${Date.now()}`;
            session.opencodeSessionId = undefined;
            session.pendingApprovals = [];
            this.sessions.set(key, session);
            await this.saveSession(key, session);
            return session;
        }
        return undefined;
    }

    async getSessionWithHistory(platform, channelId, threadId) {
        const session = await this.getExistingSession(platform, channelId, threadId);
        if (session) {
            return { session, messages: session.messages };
        }
        return undefined;
    }

    async saveSession(key, session) {
        const filePath = join(SESSIONS_DIR, `${key.replace(/:/g, '-')}.json`);
        try {
            await writeFile(filePath, JSON.stringify(session, null, 2));
        } catch {
            // Ignore save errors - in-memory still works
        }
    }

    async loadSession(key) {
        const filePath = join(SESSIONS_DIR, `${key.replace(/:/g, '-')}.json`);
        try {
            const data = await readFile(filePath, 'utf-8');
            const session = JSON.parse(data);
            session.createdAt = new Date(session.createdAt);
            session.lastActivity = new Date(session.lastActivity);
            if (session.messages) {
                session.messages = session.messages.map(msg => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp)
                }));
            } else {
                session.messages = [];
            }
            // Ensure new fields have defaults
            if (session.taskStartTime === undefined) session.taskStartTime = null;
            if (session.currentTool === undefined) session.currentTool = null;
            if (!session.modifiedFiles) session.modifiedFiles = [];
            if (session.projectDir === undefined) session.projectDir = undefined;
            if (session.ttl === undefined) session.ttl = DEFAULT_TTL;
            if (session.opencodeSessionId === undefined) session.opencodeSessionId = undefined;
            // Don't persist agent switch across restarts; default to opencode
            session.currentAgent = undefined;
            return session;
        } catch {
            return undefined;
        }
    }

    async cleanup() {
        const now = Date.now();
        for (const [key, session] of this.sessions.entries()) {
            if (now - session.lastActivity.getTime() > session.ttl) {
                this.sessions.delete(key);
                const filePath = join(SESSIONS_DIR, `${key.replace(/:/g, '-')}.json`);
                try {
                    await unlink(filePath);
                } catch {
                    // Ignore delete errors
                }
            }
        }
    }
}

export const sessionManager = new SessionManager();

// Legacy exports for backward compatibility
const sessions = new Map();

export function _getSessionsMap() {
    return sessions;
}

export function initSessionManager(config) {
    if (sessionManager.cleanupTimer) {
        clearInterval(sessionManager.cleanupTimer);
    }
    sessionManager.cleanupTimer = setInterval(() => sessionManager.cleanup(), config.cleanupIntervalMs || CLEANUP_INTERVAL);
    console.log(`Session manager initialized`);
}

export async function getOrCreateSession(threadId, platform) {
    const session = await sessionManager.getOrCreateSession(platform, threadId, threadId, 'opencode');
    sessions.set(threadId, session);
    return session;
}

export function getSession(threadId) {
    // Try legacy first, then sessionManager
    const legacy = sessions.get(threadId);
    if (legacy) return legacy;
    return sessionManager.sessions.get(threadId);
}

export function updateSession(threadId, updates) {
    const session = sessions.get(threadId) || sessionManager.sessions.get(threadId);
    if (!session) return undefined;
    Object.assign(session, updates, { lastActivity: Date.now() });
    return session;
}

export function deleteSession(threadId) {
    sessions.delete(threadId);
    sessionManager.sessions.delete(threadId);
    return true;
}

export function getAllSessions() {
    return Array.from(sessions.values());
}

export function getSessionCount() {
    return sessions.size;
}

export async function saveSessionCommandHistory(threadId, commandHistory) {
    const key = `weixin:${threadId}:${threadId}`;
    
    // Load existing session from disk
    let session = await sessionManager.loadSession(key);
    
    if (!session) {
        // Create new session
        session = {
            id: threadId,
            channelId: threadId,
            threadId: threadId,
            platform: 'weixin',
            agent: 'opencode',
            createdAt: new Date(),
            lastActivity: new Date(),
            ttl: 1800000,
            messages: [],
            pendingApprovals: [],
            viewMode: 'phone',
            commandHistory: [],
        };
    }
    
    // Merge: keep existing history and add new items
    const existing = session.commandHistory || [];
    const existingSet = new Set(existing);
    for (const item of commandHistory) {
        if (!existingSet.has(item)) {
            existing.push(item);
            existingSet.add(item);
        }
    }
    // Keep only last 50
    if (existing.length > 50) {
        existing.splice(0, existing.length - 50);
    }
    
    session.commandHistory = existing;
    session.lastActivity = new Date();
    
    // Update in-memory maps
    sessions.set(threadId, session);
    sessionManager.sessions.set(key, session);
    
    // Save to disk
    await sessionManager.saveSession(key, session);
}

export async function getSessionCommandHistory(threadId) {
    const key = `weixin:${threadId}:${threadId}`;
    
    // Try memory first
    let session = sessions.get(threadId) || sessionManager.sessions.get(key);
    
    // Then try disk and UPDATE memory
    if (!session) {
        session = await sessionManager.loadSession(key);
        if (session) {
            sessions.set(threadId, session);
            sessionManager.sessions.set(key, session);
        }
    }
    
    const history = session?.commandHistory || [];
    return history;
}

// Legacy exports for backward compatibility
export function loadSessionMapping() {
    const mappingFile = join(CONFIG_DIR, 'session-mapping.json');
    try {
        if (!existsSync(mappingFile)) {
            return {};
        }
        const raw = readFileSync(mappingFile, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

export function saveSessionMapping() {
    try {
        ensureConfigDir();
        const mapping = {};
        const processedKeys = new Set();

        // Process sessions from both sessionManager and legacy sessions
        const allSessions = new Map([...sessionManager.sessions.entries(), ...sessions.entries()]);

        for (const [key, session] of allSessions.entries()) {
            if (processedKeys.has(key)) continue;
            processedKeys.add(key);

            if (session.opencodeSessionId) {
                // Extract threadId from key (format: platform:channelId:threadId)
                const parts = key.split(':');
                const threadId = parts[parts.length - 1];

                mapping[threadId] = {
                    opencodeSessionId: session.opencodeSessionId,
                    lastActivity: session.lastActivity,
                    platform: session.platform,
                    viewMode: session.viewMode || 'phone',
                    currentViewingFile: session.currentViewingFile,
                    currentViewingMd: session.currentViewingMd,
                    commandHistory: session.commandHistory || [],
                    taskStartTime: session.taskStartTime || null,
                    currentTool: session.currentTool || null,
                    modifiedFiles: session.modifiedFiles || [],
                    projectDir: session.projectDir || null,
                    modelOverride: session.modelOverride || null,
                };

                // Also save full session to disk via sessionManager
                sessionManager.saveSession(key, session).catch(() => {});
            }
        }

        writeFileSync(join(CONFIG_DIR, 'session-mapping.json'), JSON.stringify(mapping, null, 2), 'utf-8');
    } catch (error) {
        console.warn('Failed to save session mapping:', error.message);
    }
}

export function getThreadsBySessionIdFromMapping(opencodeSessionId) {
    const mapping = loadSessionMapping();
    const threads = [];
    for (const [threadId, data] of Object.entries(mapping)) {
        if (data.opencodeSessionId === opencodeSessionId) {
            threads.push(threadId);
        }
    }
    return threads;
}

const CONFIG_DIR = join(homedir(), '.opencode-remote');

function ensureConfigDir() {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
}
