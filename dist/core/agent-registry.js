// Global registry of running agent/CLI processes
// /esc uses this to kill the actual subprocess, not just abort the SDK session
import { logger } from './log.js';

const _registry = new Map();  // threadId -> { process, agentName, killed, killTimer }

export function registerAgentProcess(threadId, proc, agentName) {
    // 若已存在先杀掉旧的
    const old = _registry.get(threadId);
    if (old && !old.killed) {
        try { old.process.kill('SIGKILL'); } catch {}
    }
    _registry.set(threadId, { process: proc, agentName, killed: false, killTimer: null });
    logger.info('agent-process:registered', { threadId, agentName, pid: proc.pid });
}

export function unregisterAgentProcess(threadId) {
    const e = _registry.get(threadId);
    if (!e) return;
    if (e.killTimer) clearTimeout(e.killTimer);
    _registry.delete(threadId);
    logger.info('agent-process:unregistered', { threadId });
}

/**
 * Kill the running agent process for a thread.
 * @param {string} threadId
 * @param {number} forceAfterMs - if process doesn't die, SIGKILL after this many ms
 * @returns {{ killed: boolean, agentName: string|null }}
 */
export function killAgentProcess(threadId, forceAfterMs = 3000) {
    const e = _registry.get(threadId);
    if (!e) return { killed: false, agentName: null };
    if (e.killed) return { killed: true, agentName: e.agentName };
    e.killed = true;
    try {
        e.process.kill('SIGTERM');
        logger.warn('agent-process:sigterm', { threadId, agentName: e.agentName, pid: e.process.pid });
    } catch (err) {
        logger.error('agent-process:sigterm-failed', { threadId, error: err.message });
    }
    e.killTimer = setTimeout(() => {
        try {
            e.process.kill('SIGKILL');
            logger.warn('agent-process:sigkill', { threadId, agentName: e.agentName });
        } catch {}
    }, forceAfterMs);
    return { killed: true, agentName: e.agentName };
}

export function getAgentProcess(threadId) {
    return _registry.get(threadId) || null;
}

export function listAgentProcesses() {
    const out = [];
    for (const [tid, e] of _registry.entries()) {
        out.push({ threadId: tid, agentName: e.agentName, pid: e.process.pid, killed: e.killed });
    }
    return out;
}

/**
 * Kill ALL registered agent processes (used during graceful shutdown).
 * Sends SIGTERM first, escalates to SIGKILL after 1s to avoid hanging on stuck children.
 * @param {number} forceAfterMs
 * @returns {Array<{ threadId: string, agentName: string, killed: boolean }>}
 */
export function killAllAgentProcesses(forceAfterMs = 1000) {
    const results = [];
    for (const [tid, e] of _registry.entries()) {
        if (e.killed) continue;
        const r = killAgentProcess(tid, forceAfterMs);
        results.push({ threadId: tid, agentName: r.agentName || e.agentName, killed: r.killed });
    }
    return results;
}
