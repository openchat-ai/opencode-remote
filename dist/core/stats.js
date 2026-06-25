// In-memory runtime stats — exposed via /info command for self-diagnostics.
// Reset only on process restart. Cheap to read, safe to write from any handler.

const counters = {
    startedAt: Date.now(),
    messagesReceived: 0,
    messagesSent: 0,
    errorsByCode: {},        // error type → count (last 24h, capped)
    opencodeRestarts: 0,
    retries: 0,
    authRejections: 0,
    commandsByType: {},      // command name → count
};

/**
 * Increment a named counter. Safe to call from any handler.
 * @param {string} name
 * @param {number} [by=1]
 */
export function incr(name, by = 1) {
    if (typeof counters[name] !== 'number') counters[name] = 0;
    counters[name] += by;
}

/**
 * Increment a nested counter (e.g., errorsByCode['AbortError']).
 * @param {string} group
 * @param {string} key
 */
export function incrKey(group, key) {
    if (!counters[group] || typeof counters[group] !== 'object') counters[group] = {};
    counters[group][key] = (counters[group][key] || 0) + 1;
}

/**
 * Snapshot of all counters + computed uptime/memory.
 * Cheap to call. Returns a fresh object each time so callers can mutate freely.
 */
export function snapshot() {
    const mem = process.memoryUsage();
    return {
        ...counters,
        uptimeSec: Math.round((Date.now() - counters.startedAt) / 1000),
        memoryMB: {
            rss: Math.round(mem.rss / 1024 / 1024),
            heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
            heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
            external: Math.round(mem.external / 1024 / 1024),
        },
        nodeVersion: process.version,
        pid: process.pid,
    };
}

/**
 * Render a human-readable status block for /info reply.
 * @param {object} [extra] - additional fields to include (e.g., bot version, agent children count)
 * @returns {string}
 */
export function formatInfo(extra = {}) {
    const s = snapshot();
    const fmt = (n) => n.toLocaleString();
    const lines = [
        `📊 opencode-remote 状态`,
        ``,
        `⏱️  启动时间: ${new Date(s.startedAt).toISOString().slice(0, 19)}Z`,
        `⏳ 运行: ${formatDuration(s.uptimeSec)}`,
        `🆔 PID: ${s.pid} · Node ${s.nodeVersion}`,
        ``,
        `📨 收到消息: ${fmt(s.messagesReceived)}`,
        `📤 已回复: ${fmt(s.messagesSent)}`,
        `🔄 OpenCode 重启: ${fmt(s.opencodeRestarts)}`,
        `♻️  重试次数: ${fmt(s.retries)}`,
        `🚫 auth 拒绝: ${fmt(s.authRejections)}`,
    ];

    if (Object.keys(s.commandsByType).length > 0) {
        lines.push('', '📋 命令统计:');
        const top = Object.entries(s.commandsByType)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        for (const [cmd, count] of top) {
            lines.push(`   /${cmd}: ${fmt(count)}`);
        }
    }

    if (Object.keys(s.errorsByCode).length > 0) {
        lines.push('', '⚠️ 错误类型:');
        const top = Object.entries(s.errorsByCode)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        for (const [err, count] of top) {
            lines.push(`   ${err}: ${fmt(count)}`);
        }
    }

    lines.push(
        '',
        `💾 内存: heap ${s.memoryMB.heapUsed}/${s.memoryMB.heapTotal}MB · rss ${s.memoryMB.rss}MB`,
    );

    if (extra.version) lines.push(`📦 版本: ${extra.version}`);
    if (typeof extra.activeThreads === 'number') lines.push(`💬 活跃线程: ${fmt(extra.activeThreads)}`);
    if (typeof extra.agentChildren === 'number') lines.push(`🧒 agent 子进程: ${fmt(extra.agentChildren)}`);

    return lines.join('\n');
}

function formatDuration(sec) {
    if (sec < 60) return `${sec}秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)}分${sec % 60}秒`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}小时${m}分`;
}