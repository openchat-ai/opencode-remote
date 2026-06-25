// Unified handler — platform-agnostic. Created via createHandler(deps).
//   deps: { handleCommand, replyTo, wrapAdapterForShared }
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { splitMessage } from './notifications.js';
import { createSession, sendMessage as sendToOpenCode, checkConnection, shareSession, listOpenCodeSessions, resumeSession, initOpenCode } from '../opencode/client.js';
import { isAuthorized, hasOwner } from './auth.js';
import { threadHistory, threadAgent } from './state.js';
import { retryTransient, isTransientError } from './retry.js';
import { detectCommand, EXPERT_SYSTEM_PROMPT, startTypingPing } from './router.js';
import { hasPendingDecision, resolveDecision } from '../autonomous/decisions.js';
import { registry } from './registry.js';
import { incr, incrKey } from './stats.js';

const IDLE_MODEL_HINT_MS = 5 * 60 * 1000;
const threadLastActive = new Map();
const threadLock = new Set();
const THREAD_LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟线程锁超时

// 定期清理超过 10 分钟的线程锁（防卡死）
setInterval(() => {
    const now = Date.now();
    const staleLock = [];
    for (const tid of threadLock) {
        const lastActive = threadLastActive.get(tid) || 0;
        if (lastActive > 0 && now - lastActive > THREAD_LOCK_TIMEOUT_MS) {
            staleLock.push(tid);
        }
    }
    for (const tid of staleLock) {
        threadLock.delete(tid);
        threadLastActive.delete(tid);
        console.log(`[handler] Force-unlocked stale thread ${tid.slice(0, 8)} (>${THREAD_LOCK_TIMEOUT_MS / 1000}s)`);
    }
    // 清理超过 1 小时的 threadLastActive 条目
    const cutoff = now - 3600_000;
    for (const [tid, ts] of threadLastActive) {
        if (ts < cutoff) threadLastActive.delete(tid);
    }
}, 60_000).unref?.();

export function createHandler(deps) {
    const { handleCommand, replyTo, wrapAdapterForShared } = deps;

    async function fwdToOpenCode(adapter, ctx, text, openCodeSessions, expertPrompt) {
        adapter.sendTypingIndicator(ctx.threadId).catch(() => {});
        let openCodeSession = null;
        let pendingModelHint = null;

        const isShared = deps.isSharedMember ? deps.isSharedMember(ctx.threadId) : false;
        const sharedRoom = deps.sharedRoom || { busy: false, session: null, members: [] };

        if (isShared) {
            if (sharedRoom.busy) { await adapter.reply(ctx.threadId, '⏳ 当前有人在用，请稍等...'); return; }
            if (sharedRoom.session) { openCodeSession = sharedRoom.session; }
            else {
                openCodeSession = await createSession(`shared-${Date.now()}`, '共享会话');
                if (!openCodeSession) { await adapter.reply(ctx.threadId, '❌ 无法创建共享会话'); return; }
                sharedRoom.session = openCodeSession;
                console.log(`✅ 共享会话已创建: ${openCodeSession.sessionId.slice(0, 8)}`);
            }
            sharedRoom.busy = true;
        } else {
            const lastActive = threadLastActive.get(ctx.threadId) || 0;
            const isIdle = !expertPrompt && lastActive > 0 && (Date.now() - lastActive) > IDLE_MODEL_HINT_MS;
            if (isIdle) pendingModelHint = true;

            if (expertPrompt) {
                openCodeSession = await createSession(`expert-${Date.now()}`, `专家评审 ${Date.now()}`);
                if (!openCodeSession) { await adapter.reply(ctx.threadId, '❌ 无法创建评审会话'); return; }
                console.log(`✅ 新建评审会话: ${openCodeSession.sessionId.slice(0, 8)}`);
            } else {
                openCodeSession = openCodeSessions.get(ctx.threadId);
                if (!openCodeSession) {
                    console.log(`[fwdToOpenCode] no session, trying to resume...`);
                    try {
                        const sessions = await listOpenCodeSessions();
                        if (sessions.length > 0) {
                            const latest = sessions.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
                            const resumed = await resumeSession(latest.id);
                            if (resumed) { openCodeSession = resumed; openCodeSessions.set(ctx.threadId, openCodeSession); console.log(`[fwdToOpenCode] resumed session ${latest.id.slice(0, 8)}`); }
                        }
                    } catch (e) { console.log(`[fwdToOpenCode] failed to resume: ${e.message}`); }
                    if (!openCodeSession) {
                        console.log(`[fwdToOpenCode] creating new session for thread=${ctx.threadId}`);
                        openCodeSession = await createSession(ctx.threadId, `Session ${ctx.threadId}`);
                        if (!openCodeSession) { await adapter.reply(ctx.threadId, '❌ 无法创建 OpenCode 会话'); return; }
                        openCodeSessions.set(ctx.threadId, openCodeSession);
                    }
                }
            }
        }

        console.log(`📤 Message: → ${text}`);
        let scopedText = text;
        if (expertPrompt) scopedText = `${expertPrompt}\n\n${scopedText}`;

        const typingPing = startTypingPing(adapter, ctx.threadId);
        const startTs = Date.now();
        const projectDir = globalThis.__autoProjectDir || process.cwd();
        const inOpenchat = existsSync(`${projectDir}/bridge/bin/lab.mjs`);

        const runLabStatus = async () => {
            if (!inOpenchat) return;
            try {
                const out = execSync('node bridge/bin/lab.mjs status', { cwd: projectDir, encoding: 'utf8', timeout: 5000 });
                replyTo(ctx.threadId, `⏳ ${formatLabOutput(out, 'status')}`, adapter).catch(() => {});
            } catch (e) { replyTo(ctx.threadId, `⏳ lab status 失败: ${e.message}`, adapter).catch(() => {}); }
        };
        const heartbeat = setInterval(runLabStatus, 50_000);

        const isConnError = (e) => /ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|EHOSTUNREACH|ENETUNREACH/i.test(e?.message || '');

        const result = await retryTransient(async () => {
            try {
                return await sendToOpenCode(openCodeSession, scopedText, {
                    idleThreshold: expertPrompt ? 30 : 10,
                    onNewContent: () => typingPing.poke(),
                    onResponseMeta: (meta) => { if (pendingModelHint && meta.modelID) pendingModelHint = `🧠 ${meta.providerID}/${meta.modelID}`; },
                    onEvent: (event) => {
                        if (event.type === 'tool.call') {
                            const props = event.properties || {};
                            const tn = props.name || props.tool_name || 'unknown';
                            const inp = props.input || {};
                            let desc = `🔧 ${tn}${inp.path ? ` 📁${inp.path}` : ''}${inp.command ? ` 💻${inp.command}` : ''}`;
                            console.log(`[→tool] ${desc}`);
                            (isShared ? [...sharedRoom.members] : [ctx.threadId]).forEach(tid => replyTo(tid, desc, adapter).catch(e => console.error('[→tool] fail:', e.message)));
                            typingPing.poke();
                        }
                    },
                }, ctx.threadId);
            } catch (e) {
                if (isConnError(e)) {
                    console.warn('[fwdToOpenCode] Connection error, reinit OpenCode...');
                    try { const fresh = await initOpenCode(); if (fresh?.client && openCodeSession) { openCodeSession.client = fresh.client; openCodeSession.server = fresh.server; } } catch (e) { console.debug('[fwdToOpenCode] reinit failed:', e.message); }
                }
                throw e;
            }
        }, {
            maxAttempts: 2, baseDelayMs: 2000,
            onRetry: (err, attempt, delay) => {
                incr('retries');
                incrKey('errorsByCode', err.name || err.code || 'Unknown');
                console.log(`[retry] error, attempt ${attempt}, retry in ${delay}ms: ${err.message}`);
                adapter.reply(ctx.threadId, `⚠️ 请求失败，${Math.round(delay/1000)}s 后重试 (${attempt}/2)`).catch(() => {});
            },
        }).catch(e => {
            console.error('[fwdToOpenCode] error:', e.message);
            incrKey('errorsByCode', e.name || e.code || 'Unknown');
            // 客户端超时 / AbortError → 自动重启 OpenCode 服务（防卡死）
            if (/AbortError|aborted/i.test(e.message)) {
                incr('opencodeRestarts');
                try { globalThis.__opencodeServer?.kill?.('SIGKILL'); } catch {}
                setTimeout(() => initOpenCode().catch(() => {}), 1000);
            }
            return `❌ ${e.message || e}`;
        });

        clearInterval(heartbeat);
        typingPing.done();

        const replyTargets = isShared ? [...sharedRoom.members] : [ctx.threadId];
        if (isShared) sharedRoom.busy = false;

        const finalText = (result || '').trim();
        console.log(`📥 AI response (${finalText.length} chars): ${finalText.slice(0, 200)}...`);
        const displayText = typeof pendingModelHint === 'string' ? `${pendingModelHint}\n${finalText}` : finalText;

        if (!finalText || finalText.startsWith('⏰') || finalText.startsWith('❌')) {
            if (!isShared) openCodeSessions.delete(ctx.threadId);
            // 不替 LLM 编空响应消息：sendToOpenCode 已透传真实错误或返回空字符串
            if (finalText) replyTargets.forEach(tid => replyTo(tid, finalText, adapter).catch(e => console.error('[reply] fail:', e.message)));
        } else {
            splitMessage(displayText).forEach(m => m.trim() && replyTargets.forEach(tid => replyTo(tid, m, adapter).catch(e => console.error('[reply] fail:', e.message))));
        }

        threadLastActive.set(ctx.threadId, Date.now());

        if (finalText.length > 0 && !finalText.startsWith('❌') && !finalText.startsWith('⏰')) {
            const shareUrl = await shareSession(openCodeSession);
            if (shareUrl) { try { await adapter.reply(ctx.threadId, `🔗 ${shareUrl}`); } catch (e) { console.error('[fwdToOpenCode] share URL reply failed:', e.message); } }
        }
    }

    async function handleMsg(adapter, ctx, text, openCodeSessions, platform = 'weixin') {
        // Stats: count every incoming message
        incr('messagesReceived');

        // 阶段 1: 所有系统指令都不阻塞，先于 lock 处理
        // - /z 调用 fwdToOpenCode（不 acquire lock）
        // - detectCommand 命中任何命令都直接处理
        const trimmedLower = text.trim().toLowerCase();

        if (text.startsWith('/z')) {
            const arg = text.slice(2).trim();
            if (arg === 'off' || arg === 'reset' || arg === '关闭') { await adapter.reply(ctx.threadId, '⏹️ 自定义 prompt 已清除'); return; }
            if (arg) {
                await adapter.reply(ctx.threadId, `✅ 自定义专家 prompt (${arg.length}字)，本消息生效`);
                await fwdToOpenCode(adapter, ctx, text, openCodeSessions, arg);
            } else {
                await adapter.reply(ctx.threadId, '✅ 专家评审已启动');
                await fwdToOpenCode(adapter, ctx, text, openCodeSessions, EXPERT_SYSTEM_PROMPT);
            }
            return;
        }

        const detected = detectCommand(text);
        if (detected) {
            const cmdAdapter = deps.isSharedMember ? wrapAdapterForShared(adapter, ctx.threadId) : adapter;
            const handled = await handleCommand(cmdAdapter, ctx, platform, detected.name, detected.arg, openCodeSessions);
            if (handled) return;
        }

        // 阶段 2: 普通消息才加 lock
        if (threadLock.has(ctx.threadId)) {
            console.log(`[handler] thread ${ctx.threadId.slice(0, 8)} busy, skipping`);
            return;
        }
        threadLock.add(ctx.threadId);
        try {
        const expertTriggers = ['z', 'Z', '叫全部专家', '叫所有专家', '呼叫专家点评', '专家点评', '专家意见', 'call all experts', 'expert review', '专家会诊', '团队评审', '代码审查', '全员review', 'review all', '请专家', '叫专家', '找专家', 'expert'];
        let expertPrompt = null;

        if (expertTriggers.some(t => trimmedLower.includes(t))) expertPrompt = EXPERT_SYSTEM_PROMPT;

        if (hasPendingDecision(ctx.threadId)) {
            if (/^\d+$/.test(text.trim())) { if (resolveDecision(ctx.threadId, text.trim())) return; }
            if (/^\/(\d+)$/.test(text.trim())) { if (resolveDecision(ctx.threadId, text.trim().slice(1))) return; }
        }

        if (!isAuthorized(platform, ctx.userId)) {
            incr('authRejections');
            if (!hasOwner(platform)) { await adapter.reply(ctx.threadId, '🔐 请先发送 /start 进行安全认证'); return; }
            if (!deps.isSharedMember?.(ctx.threadId)) { await adapter.reply(ctx.threadId, '🚫 你无权使用此 bot'); return; }
        }

        const activeAgentName = threadAgent.get(ctx.threadId);

        if (activeAgentName && activeAgentName !== 'opencode') {
            const agent = registry.findAgent(activeAgentName);
            if (agent) {
                const available = await agent.isAvailable().catch(() => false);
                if (available) {
                    adapter.sendTypingIndicator(ctx.threadId).catch(() => {});
                    const t0 = Date.now();
                    const hbDir = globalThis.__autoProjectDir || process.cwd();
                    const hbLab = existsSync(`${hbDir}/bridge/bin/lab.mjs`);
                    const heartbeat = setInterval(() => {
                        if (hbLab) { try { const out = execSync('node bridge/bin/lab.mjs status', { cwd: hbDir, encoding: 'utf8', timeout: 5000 }); adapter.reply(ctx.threadId, `⏳ ${activeAgentName} · ${formatLabOutput(out, 'status')}`).catch(() => {}); return; } catch (e) { adapter.reply(ctx.threadId, `⏳ ${activeAgentName} lab status 失败: ${e.message}`).catch(() => {}); return; } }
                    }, 50_000);

                    const history = threadHistory.get(ctx.threadId) || [];

                    try {
                        const response = await retryTransient(() => agent.sendPrompt(activeAgentName, text, history, { projectDir: globalThis.__autoProjectDir, threadId: ctx.threadId }), {
                            maxAttempts: 2, baseDelayMs: 2000, onRetry: (err, attempt, delay) => { adapter.reply(ctx.threadId, `⚠️ ${activeAgentName} 失败，${Math.round(delay/1000)}s 后重试 (${attempt}/2)`).catch(() => {}); },
                        });
                        clearInterval(heartbeat);
                        console.log(`📥 AI response (${(response || '').length} chars): ${(response || '').slice(0, 200)}...`);
                        history.push({ role: 'user', content: text }, { role: 'assistant', content: response || '' });
                        threadHistory.set(ctx.threadId, history);
                        splitMessage(response || '无响应').forEach(chunk => adapter.reply(ctx.threadId, chunk));
                    } catch (error) {
                        clearInterval(heartbeat);
                        console.error(`[${activeAgentName}] ❌ ${error.message}`);
                        await adapter.reply(ctx.threadId, `❌ ${activeAgentName} 错误: ${error.message}`);
                    }
                    return;
                }
            }
            threadAgent.delete(ctx.threadId);
        }

        const connected = await checkConnection();
        if (!connected) { await adapter.reply(ctx.threadId, '❌ OpenCode 离线，请检查服务是否运行'); return; }
        await fwdToOpenCode(adapter, ctx, text, openCodeSessions);
        } finally { threadLock.delete(ctx.threadId); }
    }

    return { handleMessage: handleMsg, forwardToOpenCode: fwdToOpenCode };
}

export function formatLabOutput(out, subCmd) {
    const trimmed = (out || '').trim();
    if (!trimmed) return '(空)';
    try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj.total === 'number') return `总计 ${obj.total} · 待 ${obj.pending || 0} · 跑 ${obj.running || 0} · 完成 ${obj.done || 0} · 失败 ${obj.failed || 0}`;
    } catch (e) { console.debug('[formatLabOutput] Not JSON:', e.message); }
    const oneline = trimmed.replace(/\s+/g, ' ').trim();
    return oneline.length > 1800 ? oneline.slice(0, 1800) + '...' : oneline;
}
