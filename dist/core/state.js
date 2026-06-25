// Persistent state manager — saves threadHistory + threadAgent to disk
// Bot restart preserves conversation context and agent routing
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { killAllAgentProcesses } from './agent-registry.js';

const STATE_DIR = join(homedir(), '.opencode-remote', 'state');
const STATE_FILE = join(STATE_DIR, 'state.json');
const STATE_TMP = join(STATE_DIR, 'state.json.tmp');
const STATE_BAK = join(STATE_DIR, 'state.json.bak');

const MAX_HISTORY_PER_THREAD = 20;  // 同步 threadHistory 上限
const MAX_THREADS = 1000;            // 总 thread 上限
const WRITE_DEBOUNCE_MS = 2000;      // 写盘防抖

let writeTimer = null;
let dirty = false;

function ensureDir() {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function loadState() {
    ensureDir();
    let raw = null;
    if (existsSync(STATE_FILE)) raw = readFileSync(STATE_FILE, 'utf8');
    else if (existsSync(STATE_BAK)) raw = readFileSync(STATE_BAK, 'utf8');
    if (!raw) return { threadHistory: {}, threadAgent: {} };
    try {
        const s = JSON.parse(raw);
        return {
            threadHistory: s.threadHistory || {},
            threadAgent: s.threadAgent || {},
        };
    } catch (e) {
        console.error('[state] Corrupt state, starting fresh:', e.message);
        return { threadHistory: {}, threadAgent: {} };
    }
}

function doWrite() {
    ensureDir();
    const snapshot = {
        threadHistory: Object.fromEntries(threadHistoryMap),
        threadAgent: Object.fromEntries(threadAgentMap),
    };
    const json = JSON.stringify(snapshot);
    try {
        writeFileSync(STATE_TMP, json, 'utf8');
        if (existsSync(STATE_FILE)) {
            try { renameSync(STATE_FILE, STATE_BAK); } catch {}
        }
        renameSync(STATE_TMP, STATE_FILE);
    } catch (e) {
        console.error('[state] Write failed:', e.message);
    }
}

export function scheduleWrite() {
    dirty = true;
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
        writeTimer = null;
        if (dirty) {
            dirty = false;
            doWrite();
        }
    }, WRITE_DEBOUNCE_MS);
}

export function flushWrite() {
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }
    if (dirty) {
        dirty = false;
        doWrite();
    }
}

// In-memory mirror of persistent state
const threadHistoryMap = new Map();  // threadId -> [{role, content}]
const threadAgentMap = new Map();     // threadId -> agentName

export const threadHistory = {
    get(threadId) {
        const h = threadHistoryMap.get(threadId);
        return h ? h.slice() : [];
    },
    set(threadId, history) {
        if (!Array.isArray(history) || history.length === 0) {
            threadHistoryMap.delete(threadId);
        } else {
            const trimmed = history.slice(-MAX_HISTORY_PER_THREAD);
            threadHistoryMap.set(threadId, trimmed);
            // 上限淘汰: 删最旧的不活跃
            if (threadHistoryMap.size > MAX_THREADS) {
                const first = threadHistoryMap.keys().next().value;
                threadHistoryMap.delete(first);
            }
        }
        scheduleWrite();
    },
    delete(threadId) {
        threadHistoryMap.delete(threadId);
        scheduleWrite();
    },
    has(threadId) {
        return threadHistoryMap.has(threadId);
    },
    size() {
        return threadHistoryMap.size;
    },
};

export const threadAgent = {
    get(threadId) { return threadAgentMap.get(threadId); },
    set(threadId, agentName) { threadAgentMap.set(threadId, agentName); scheduleWrite(); },
    delete(threadId) { threadAgentMap.delete(threadId); scheduleWrite(); },
    size() { return threadAgentMap.size; },
};

// 启动时加载
export function initState() {
    const s = loadState();
    let loaded = 0;
    for (const [k, v] of Object.entries(s.threadHistory)) {
        if (loaded >= MAX_THREADS) break;
        if (Array.isArray(v)) { threadHistoryMap.set(k, v); loaded++; }
    }
    for (const [k, v] of Object.entries(s.threadAgent)) {
        threadAgentMap.set(k, v);
    }
    console.log(`[state] Loaded ${threadHistoryMap.size} history, ${threadAgentMap.size} agent routes`);
}

// 退出时刷盘（exit 事件自动触发，无需额外信号处理）
process.on('exit', () => flushWrite());

// beforeExit: 异步清理窗口。所有 setImmediate / Promise 微任务完成时触发。
// 比 'exit' 更早，能在进程自然结束时先清理资源（杀 OpenCode server、刷状态）
process.on('beforeExit', () => {
    flushWrite();
    try { globalThis.__opencodeServer?.kill?.(); } catch {}
});

// 未捕获异常：写日志 + 尝试刷盘 + 退出（让父进程决定是否重启）
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err);
    try {
        const crashLog = join(STATE_DIR, 'crash.log');
        const line = `[${new Date().toISOString()}] ${err.stack || err.message}\n`;
        appendFileSync(crashLog, line);
    } catch {}
    flushWrite();
    try { globalThis.__opencodeServer?.kill?.(); } catch {}
    // 给 logger 一点时间刷盘，然后退出（非 0 表示异常，父进程会重启）
    setTimeout(() => process.exit(1), 100);
});

process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] unhandledRejection:', reason);
    // 不退出：unhandled rejection 不一定致命
});

// SIGTERM/SIGINT: 优雅关停（PM2 重启、Ctrl+C、kill <pid>）
// beforeExit 在 kill -9 / 异常崩溃时不可靠，必须独立处理信号
function gracefulShutdown(signal) {
    console.log(`[shutdown] received ${signal}`);
    try { flushWrite(); } catch (e) { console.error('[shutdown] flushWrite failed:', e); }
    try { globalThis.__opencodeServer?.kill?.(); } catch (e) { console.error('[shutdown] kill OpenCode failed:', e); }
    // 杀掉所有 agent 子进程（claude-code/copilot/codex/opencode plugins）
    // 不杀的话，bot 重启后它们会变孤儿进程
    try {
        const killed = killAllAgentProcesses(1000);
        if (killed.length > 0) {
            console.log(`[shutdown] killed ${killed.length} agent subprocess(es):`,
                killed.map(k => `${k.agentName}@${k.threadId}`).join(', '));
        }
    } catch (e) { console.error('[shutdown] killAllAgentProcesses failed:', e); }
    // 给 logger / agent-registry / agent children 一点时间清理
    setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Windows 没有 SIGTERM 但 npm start 转发 Ctrl+C 事件走 SIGINT
// SIGBREAK 是 Windows Ctrl+Break（PM2 偶尔发）
process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK'));
