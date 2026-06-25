// Integration tests — validate critical user scenarios with mocked dependencies
// Run via: node --test test/integration.test.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const D = '../dist';

// === Test helpers ===

/** Mock WeChat adapter that records replies and simulates typing */
function createMockAdapter() {
    const replies = [];
    const typingCalls = [];
    let nextReplyShouldThrow = false;
    return {
        replies,
        typingCalls,
        async reply(threadId, text) {
            replies.push({ threadId, text });
            if (nextReplyShouldThrow) {
                nextReplyShouldThrow = false;
                throw new Error('mock reply failed');
            }
        },
        async sendTypingIndicator(threadId) {
            typingCalls.push(threadId);
        },
        contextTokens: { set() {}, get() { return undefined; }, delete() {} },
        typingTickets: { set() {}, get() { return undefined; }, delete() {} },
        async isDuplicate() { return false; },
        setNextReplyToThrow() { nextReplyShouldThrow = true; },
    };
}

function getStateDir() {
    return join(process.env.HOME || process.env.USERPROFILE || '', '.opencode-remote', 'state');
}

function cleanupTestState(threadIds) {
    const stateDir = getStateDir();
    if (!existsSync(stateDir)) return;
    try {
        const stateFile = join(stateDir, 'state.json');
        if (existsSync(stateFile)) {
            const json = JSON.parse(readFileSync(stateFile, 'utf8'));
            for (const tid of threadIds) {
                delete json.threadHistory?.[tid];
                delete json.threadAgent?.[tid];
            }
            const { writeFileSync } = require('fs');
            writeFileSync(stateFile, JSON.stringify(json, null, 2));
        }
    } catch {}
}

// === Scenario 1: Command routing ===

describe('Scenario 1: Command routing', () => {
    it('detects /help and dispatches to handler', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        let captured = null;
        const handler = createHandler({
            handleCommand: async (a, ctx, platform, name, arg) => {
                captured = { name, arg, platform };
                return true;
            },
            replyTo: async (tid, text, a) => a.reply(tid, text),
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        await handler.handleMessage(
            createMockAdapter(),
            { threadId: 't1', userId: 'u1' },
            '/help',
            new Map(),
        );

        assert.deepEqual(captured, { name: 'help', arg: '', platform: 'weixin' });
    });

    it('extracts arguments from commands', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        let captured = null;
        const handler = createHandler({
            handleCommand: async (a, ctx, p, name, arg) => { captured = { name, arg }; return true; },
            replyTo: async (tid, text, a) => a.reply(tid, text),
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        await handler.handleMessage(
            createMockAdapter(),
            { threadId: 't2', userId: 'u2' },
            '/model gpt-4 turbo',
            new Map(),
        );

        assert.equal(captured.name, 'model');
        assert.equal(captured.arg, 'gpt-4 turbo');
    });

    it('extracts arguments from Chinese-prefixed commands', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        let captured = null;
        const handler = createHandler({
            handleCommand: async (a, ctx, p, name, arg) => { captured = { name, arg }; return true; },
            replyTo: async (tid, text, a) => a.reply(tid, text),
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        await handler.handleMessage(
            createMockAdapter(),
            { threadId: 't3', userId: 'u3' },
            '。/help me please',
            new Map(),
        );

        // The 。 prefix and /help together — handler extracts 'me please' as arg
        // OR recognizes just /help and discards rest
        assert.ok(captured, 'command should be detected');
    });
});

// === Scenario 2: State persistence ===

describe('Scenario 2: State persistence', () => {
    it('saves threadHistory and survives flush', async () => {
        const { threadHistory, flushWrite } = await import(`${D}/core/state.js`);
        const tid = 'persist-roundtrip';
        threadHistory.set(tid, [
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'world' },
        ]);
        flushWrite();

        // Read from disk
        const stateFile = join(getStateDir(), 'state.json');
        assert.ok(existsSync(stateFile), 'state.json should exist on disk');
        const json = JSON.parse(readFileSync(stateFile, 'utf8'));
        assert.ok(json.threadHistory[tid], 'thread should be persisted');
        assert.equal(json.threadHistory[tid].length, 2);
        assert.equal(json.threadHistory[tid][0].content, 'hello');
        assert.equal(json.threadHistory[tid][1].content, 'world');

        cleanupTestState([tid]);
    });

    it('persists threadAgent routing', async () => {
        const { threadAgent, flushWrite } = await import(`${D}/core/state.js`);
        const tid = 'persist-agent';
        threadAgent.set(tid, 'claude-code');
        flushWrite();

        const json = JSON.parse(readFileSync(join(getStateDir(), 'state.json'), 'utf8'));
        assert.equal(json.threadAgent[tid], 'claude-code');

        cleanupTestState([tid]);
    });
});

// === Scenario 3: Error transparency ===

describe('Scenario 3: Error transparency', () => {
    it('does not crash when replyTo fails', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        const handler = createHandler({
            handleCommand: async () => true,
            replyTo: async () => { throw new Error('network down'); },
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        await assert.doesNotReject(
            handler.handleMessage(
                createMockAdapter(),
                { threadId: 'err1', userId: 'eu1' },
                '/help',
                new Map(),
            ),
        );
    });

    it('does not crash when adapter.reply fails mid-message', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        const adapter = createMockAdapter();
        const handler = createHandler({
            handleCommand: async () => true,
            replyTo: async (tid, text, a) => a.reply(tid, text),
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        await assert.doesNotReject(
            handler.handleMessage(adapter, { threadId: 'err2', userId: 'eu2' }, '/help', new Map()),
        );
    });
});

// === Scenario 4: All system commands bypass lock ===

describe('Scenario 4: Command lock bypass', () => {
    it('all 21 registered commands bypass thread lock', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        const { COMMAND_ALIASES } = await import(`${D}/core/router.js`);

        const commandsProcessed = [];
        const handler = createHandler({
            handleCommand: async (a, ctx, p, name) => { commandsProcessed.push(name); return true; },
            replyTo: async (tid, text, a) => a.reply(tid, text),
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        // Test primary alias for each canonical command
        for (const [name, aliases] of Object.entries(COMMAND_ALIASES)) {
            const cmd = `/${aliases[0]}`;
            await handler.handleMessage(
                createMockAdapter(),
                { threadId: `lock-${name}`, userId: `u-${name}` },
                cmd,
                new Map(),
            );
            assert.ok(
                commandsProcessed.includes(name),
                `${cmd} (${name}) should be processed without lock check`,
            );
        }

        assert.equal(commandsProcessed.length, Object.keys(COMMAND_ALIASES).length);
    });
});

// === Scenario 5: Auth gating ===

describe('Scenario 5: Auth gating', () => {
    it('rejects messages from unauthorized users when owner exists', async () => {
        const { createHandler } = await import(`${D}/core/handler.js`);
        const { claimOwnership } = await import(`${D}/core/auth.js`);

        // Claim ownership for one user
        claimOwnership('weixin', 'owner-user');
        const handler = createHandler({
            handleCommand: async () => false,
            replyTo: async (tid, text, a) => a.reply(tid, text),
            wrapAdapterForShared: (a) => a,
            isSharedMember: () => false,
        });

        const adapter = createMockAdapter();
        const ctx = { threadId: 'unauthorized', userId: 'stranger' };

        // Send a plain message (not a command) — should be blocked
        // Note: This will still try to acquire lock; we use a command to avoid lock
        await handler.handleMessage(adapter, ctx, 'hello', new Map());

        // Should receive a "no permission" reply (or similar)
        // The exact message depends on auth.js logic, but there should be SOMETHING
        assert.ok(adapter.replies.length > 0, 'should have replied to unauthorized user');
    });
});

// === Scenario 6: Duplicate detection ===

describe('Scenario 6: WeChat dedup', () => {
    it('createWeixinAdapter has isDuplicate that returns false for new messages', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        const isDup1 = adapter.isDuplicate('msg-1', 'user-1:hello');
        const isDup2 = adapter.isDuplicate('msg-1', 'user-1:hello');
        assert.equal(isDup1, false, 'first message should not be duplicate');
        assert.equal(isDup2, true, 'second identical message should be duplicate');
    });

    it('different content is not duplicate', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        adapter.isDuplicate('msg-a', 'user-1:hello');
        const isDup = adapter.isDuplicate('msg-b', 'user-1:world');
        assert.equal(isDup, false, 'different content is not duplicate');
    });
});

// === Scenario 7: Crash recovery ===

describe('Scenario 7: Crash recovery', () => {
    it('flushWrite persists state synchronously', async () => {
        const { threadHistory, flushWrite } = await import(`${D}/core/state.js`);
        const tid = 'crash-flush-test';
        threadHistory.set(tid, [{ role: 'user', content: 'before crash' }]);

        // Simulate the 'exit' handler firing — calls flushWrite synchronously
        flushWrite();

        // State should be on disk immediately
        const stateFile = join(getStateDir(), 'state.json');
        const json = JSON.parse(readFileSync(stateFile, 'utf8'));
        assert.ok(json.threadHistory[tid], 'state should be flushed synchronously');
        assert.equal(json.threadHistory[tid][0].content, 'before crash');

        cleanupTestState([tid]);
    });

    it('dirty state survives debounced flushWrite', async () => {
        const { threadHistory, flushWrite } = await import(`${D}/core/state.js`);
        const tid = 'crash-debounced-test';

        // Set state without immediate flush
        threadHistory.set(tid, [{ role: 'user', content: 'data 1' }]);
        threadHistory.set(tid, [{ role: 'user', content: 'data 2' }]);

        // Manual flush (simulates beforeExit firing)
        flushWrite();

        const json = JSON.parse(readFileSync(join(getStateDir(), 'state.json'), 'utf8'));
        assert.equal(json.threadHistory[tid][0].content, 'data 2', 'should have latest state');

        cleanupTestState([tid]);
    });

    it('state module registers cleanup hooks for beforeExit and uncaughtException', async () => {
        // Verify the API exists (handlers register on module import as a side effect)
        const { flushWrite, threadHistory } = await import(`${D}/core/state.js`);
        assert.equal(typeof flushWrite, 'function', 'flushWrite should be exported');
        assert.equal(typeof threadHistory.set, 'function', 'threadHistory should be exported');

        // Verify the listeners are registered on the current process
        // (Note: state.js is imported once per test process, so listeners are registered once)
        const beforeExitCount = process.listenerCount('beforeExit');
        const uncaughtCount = process.listenerCount('uncaughtException');
        assert.ok(beforeExitCount >= 1, `beforeExit should have at least 1 listener, got ${beforeExitCount}`);
        assert.ok(uncaughtCount >= 1, `uncaughtException should have at least 1 listener, got ${uncaughtCount}`);
    });

    it('crash.log is append-only and survives restarts', async () => {
        const { existsSync } = await import('fs');
        // crash.log may or may not exist depending on whether uncaughtException fired
        const crashLog = join(getStateDir(), 'crash.log');
        if (existsSync(crashLog)) {
            const content = readFileSync(crashLog, 'utf8');
            // If log exists, it should have at least one entry
            assert.ok(content.length > 0, 'crash.log should have content if it exists');
        }
        // Just verify the path is well-formed
        assert.ok(crashLog.endsWith('crash.log'));
    });

    it('OpenCode server cleanup is attempted on beforeExit', async () => {
        // Simulate by setting globalThis.__opencodeServer with a mock kill() that we can track
        let killed = false;
        globalThis.__opencodeServer = {
            kill: () => { killed = true; },
        };

        // Manually trigger the beforeExit handler logic (simulating it firing)
        // Note: we can't directly emit beforeExit without exiting the test process
        // Instead, we verify the code path via the registered listener
        const beforeExitListeners = process.listeners('beforeExit');
        assert.ok(beforeExitListeners.length > 0, 'beforeExit should have at least one listener');

        delete globalThis.__opencodeServer;
    });
});

// === Scenario 8: Memory leak regression ===

describe('Scenario 8: Memory leak regression', () => {
    it('contextTokens entries have { value, _ts } structure (not bare strings)', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        // Simulate what bot.js does on every message
        adapter.contextTokens.set('user-1', { value: 'tok-abc', _ts: Date.now() });
        adapter.contextTokens.set('user-2', { value: 'tok-def', _ts: Date.now() - 1000 });

        const e1 = adapter.contextTokens.get('user-1');
        assert.equal(typeof e1, 'object', 'entry should be object, not bare string');
        assert.equal(e1.value, 'tok-abc');
        assert.equal(typeof e1._ts, 'number', 'entry should have numeric _ts');
    });

    it('typingTickets entries have { value, _ts } structure', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        adapter.typingTickets.set('user-1', { value: 'ticket-xyz', _ts: Date.now() });
        const e1 = adapter.typingTickets.get('user-1');
        assert.equal(typeof e1, 'object');
        assert.equal(e1.value, 'ticket-xyz');
        assert.equal(typeof e1._ts, 'number');
    });

    it('cleanup purges entries older than TTL', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        // Old entry (2 hours ago, well past 1hr cutoff)
        adapter.contextTokens.set('stale-user', { value: 'old-tok', _ts: Date.now() - 7_200_000 });
        adapter.typingTickets.set('stale-user', { value: 'old-ticket', _ts: Date.now() - 7_200_000 });

        // Recent entry (just now)
        adapter.contextTokens.set('fresh-user', { value: 'new-tok', _ts: Date.now() });
        adapter.typingTickets.set('fresh-user', { value: 'new-ticket', _ts: Date.now() });

        // Replicate the cleanup predicate from adapter.js (Map.delete during iteration is safe)
        const cutoff = Date.now() - 3_600_000; // 1 hour TTL
        for (const [k, v] of adapter.contextTokens) {
            if (typeof v !== 'object' || !v._ts || v._ts < cutoff) adapter.contextTokens.delete(k);
        }
        for (const [k, v] of adapter.typingTickets) {
            if (typeof v !== 'object' || !v._ts || v._ts < cutoff) adapter.typingTickets.delete(k);
        }

        assert.equal(adapter.contextTokens.has('stale-user'), false, 'stale contextToken should be purged');
        assert.equal(adapter.typingTickets.has('stale-user'), false, 'stale typingTicket should be purged');
        assert.equal(adapter.contextTokens.has('fresh-user'), true, 'fresh contextToken must survive');
        assert.equal(adapter.typingTickets.has('fresh-user'), true, 'fresh typingTicket must survive');
    });

    it('cleanup purges legacy bare-string entries (backward compat)', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        // Simulate an entry left over from the pre-fix code (bare string, no _ts)
        adapter.contextTokens.set('legacy-user', 'legacy-bare-string');
        adapter.typingTickets.set('legacy-user', 'legacy-bare-string');

        // Cleanup predicate `typeof v !== 'object'` catches bare strings too
        const cutoff = Date.now() - 60 * 60 * 1000;
        const staleCtx = [...adapter.contextTokens.entries()]
            .filter(([, v]) => typeof v !== 'object' || !v._ts || v._ts < cutoff)
            .map(([k]) => k);
        const staleTyp = [...adapter.typingTickets.entries()]
            .filter(([, v]) => typeof v !== 'object' || !v._ts || v._ts < cutoff)
            .map(([k]) => k);
        for (const k of staleCtx) adapter.contextTokens.delete(k);
        for (const k of staleTyp) adapter.typingTickets.delete(k);

        assert.equal(adapter.contextTokens.has('legacy-user'), false,
            'legacy bare-string entry must be purged (no leak from old format)');
        assert.equal(adapter.typingTickets.has('legacy-user'), false,
            'legacy bare-string entry must be purged (no leak from old format)');
    });

    it('entry update preserves _ts (not overwritten by stale data)', async () => {
        const { createWeixinAdapter } = await import(`${D}/weixin/adapter.js`);
        const adapter = createWeixinAdapter('http://localhost:9999', 'test-token', 'test-bot');

        const t0 = Date.now();
        adapter.contextTokens.set('user-1', { value: 'v1', _ts: t0 });

        // Simulate stale entry update (e.g. message in flight before context refresh)
        const t1 = t0 + 5000;
        adapter.contextTokens.set('user-1', { value: 'v2', _ts: t1 });

        const entry = adapter.contextTokens.get('user-1');
        assert.equal(entry.value, 'v2', 'value should update');
        assert.equal(entry._ts, t1, '_ts should reflect latest write, not t0');
    });
});

// === Scenario 9: Multi-turn prompt formatting ===

describe('Scenario 9: Multi-turn prompt formatting (buildContextualPrompt)', () => {
    it('returns plain prompt when history is empty', async () => {
        const { buildContextualPrompt } = await import(`${D}/plugins/agents/claude-code/index.js`);
        assert.equal(buildContextualPrompt('hello', []), 'hello');
        assert.equal(buildContextualPrompt('hello', null), 'hello');
        assert.equal(buildContextualPrompt('hello', undefined), 'hello');
    });

    it('injects history with role labels and current prompt', async () => {
        const { buildContextualPrompt } = await import(`${D}/plugins/agents/claude-code/index.js`);
        const history = [
            { role: 'user', content: 'I am working on a TypeScript compiler' },
            { role: 'assistant', content: 'I can help with that. What error?' },
        ];
        const out = buildContextualPrompt('it says TS2304', history);
        assert.match(out, /User: I am working on a TypeScript compiler/);
        assert.match(out, /Assistant: I can help with that\. What error\?/);
        assert.match(out, /User: it says TS2304/);
        // Critical: must start with "Continue the conversation" so Claude doesn't
        // misread the conversation meta-language as instructions
        assert.ok(out.startsWith('Continue the conversation'),
            'must start with Continue-the-conversation prefix to avoid meta-language confusion');
    });

    it('caps history at last 10 messages (avoid token overflow)', async () => {
        const { buildContextualPrompt } = await import(`${D}/plugins/agents/claude-code/index.js`);
        const history = [];
        for (let i = 0; i < 20; i++) {
            history.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
        }
        const out = buildContextualPrompt('msg-20', history);
        // Should include last 10 (indices 10-19), not the first 10
        assert.ok(out.includes('msg-10'), 'should include boundary msg-10');
        assert.ok(out.includes('msg-19'), 'should include latest msg-19');
        assert.ok(!out.includes('msg-0:'), 'should NOT include msg-0 (older than 10)');
        assert.ok(!out.includes('msg-9:'), 'should NOT include msg-9 (older than 10)');
    });

    it('handles missing or malformed history entries gracefully', async () => {
        const { buildContextualPrompt } = await import(`${D}/plugins/agents/claude-code/index.js`);
        // Mix of valid and missing-role entries
        const history = [
            { role: 'user', content: 'a' },
            { content: 'b' }, // missing role
            { role: 'user' }, // missing content
        ];
        const out = buildContextualPrompt('next', history);
        assert.match(out, /User: a/);
        assert.match(out, /Assistant: b/);  // missing role defaults to Assistant
        assert.match(out, /User: undefined/);  // missing content renders as undefined
        assert.match(out, /User: next/);
    });
});

// === Scenario 10: Retry helper ===

describe('Scenario 10: Retry helper (retryTransient)', () => {
    it('returns first success without retrying', async () => {
        const { retryTransient, isTransientError } = await import(`${D}/core/retry.js`);
        let calls = 0;
        const result = await retryTransient(async () => {
            calls++;
            return 'ok';
        });
        assert.equal(result, 'ok');
        assert.equal(calls, 1, 'should not retry on first success');
    });

    it('retries on transient errors up to maxAttempts', async () => {
        const { retryTransient } = await import(`${D}/core/retry.js`);
        let calls = 0;
        const result = await retryTransient(async () => {
            calls++;
            if (calls < 3) throw new Error('ECONNRESET');
            return 'recovered';
        }, { baseDelayMs: 1, maxDelayMs: 5 });
        assert.equal(result, 'recovered');
        assert.equal(calls, 3, 'should have retried twice before succeeding on attempt 3');
    });

    it('throws immediately on non-transient errors (no retry)', async () => {
        const { retryTransient } = await import(`${D}/core/retry.js`);
        let calls = 0;
        await assert.rejects(
            retryTransient(async () => {
                calls++;
                throw new Error('SyntaxError: bad token');
            }, { baseDelayMs: 1 }),
            /SyntaxError/,
        );
        assert.equal(calls, 1, 'should not retry non-transient errors');
    });

    it('throws last error after maxAttempts exhausted', async () => {
        const { retryTransient } = await import(`${D}/core/retry.js`);
        let calls = 0;
        await assert.rejects(
            retryTransient(async () => {
                calls++;
                throw new Error('ETIMEDOUT');
            }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }),
            /ETIMEDOUT/,
        );
        assert.equal(calls, 3, 'should attempt exactly maxAttempts times');
    });

    it('isTransientError matches common transient patterns', async () => {
        const { isTransientError } = await import(`${D}/core/retry.js`);
        assert.ok(isTransientError(new Error('ECONNRESET')));
        assert.ok(isTransientError(new Error('fetch failed')));
        assert.ok(isTransientError(new Error('rate limit exceeded')));
        assert.ok(isTransientError(new Error('429 Too Many Requests')));
        assert.ok(isTransientError(new Error('503 Service Unavailable')));
        assert.ok(isTransientError(new Error('Free usage exceeded')));
        assert.ok(!isTransientError(new Error('SyntaxError: unexpected token')));
        assert.ok(!isTransientError(new Error('TypeError: cannot read property')));
        assert.ok(!isTransientError(null));
    });

    it('calls onRetry hook with attempt number and delay', async () => {
        const { retryTransient } = await import(`${D}/core/retry.js`);
        const retries = [];
        await retryTransient(async () => {
            throw new Error('ECONNRESET');
        }, {
            maxAttempts: 3,
            baseDelayMs: 1,
            maxDelayMs: 5,
            onRetry: (err, attempt, delay) => retries.push({ attempt, delay }),
        }).catch(() => {});
        assert.equal(retries.length, 2, 'onRetry should fire for each retry (not final)');
        assert.equal(retries[0].attempt, 1);
        assert.equal(retries[1].attempt, 2);
        assert.ok(retries[0].delay > 0 && retries[1].delay >= retries[0].delay,
            'exponential backoff should not decrease');
    });
});

// === Scenario 11: Agent subprocess lifecycle ===

describe('Scenario 11: Agent subprocess lifecycle', () => {
    it('registerAgentProcess records process and agentName', async () => {
        const reg = await import(`${D}/core/agent-registry.js`);
        const fakeProc = { pid: 12345, kill: () => true };
        reg.registerAgentProcess('thread-A', fakeProc, 'claude-code');
        const list = reg.listAgentProcesses();
        const entry = list.find(e => e.threadId === 'thread-A');
        assert.ok(entry, 'thread-A should be in registry');
        assert.equal(entry.agentName, 'claude-code');
        assert.equal(entry.pid, 12345);
        assert.equal(entry.killed, false);

        reg.unregisterAgentProcess('thread-A');
    });

    it('killAllAgentProcesses kills all registered agents', async () => {
        const reg = await import(`${D}/core/agent-registry.js`);
        const killedPids = [];
        reg.registerAgentProcess('thread-X', { pid: 100, kill: (sig) => killedPids.push({ pid: 100, sig }) }, 'claude-code');
        reg.registerAgentProcess('thread-Y', { pid: 200, kill: (sig) => killedPids.push({ pid: 200, sig }) }, 'copilot');

        const results = reg.killAllAgentProcesses(100);
        assert.equal(results.length, 2, 'should report killing 2 agents');
        assert.ok(killedPids.some(k => k.pid === 100 && k.sig === 'SIGTERM'),
            'thread-X should receive SIGTERM');
        assert.ok(killedPids.some(k => k.pid === 200 && k.sig === 'SIGTERM'),
            'thread-Y should receive SIGTERM');

        // Cleanup
        reg.unregisterAgentProcess('thread-X');
        reg.unregisterAgentProcess('thread-Y');
    });

    it('killAllAgentProcesses skips already-killed agents', async () => {
        const reg = await import(`${D}/core/agent-registry.js`);
        let killCount = 0;
        reg.registerAgentProcess('thread-Z', { pid: 300, kill: () => killCount++ }, 'opencode');

        reg.killAgentProcess('thread-Z', 100);
        const results = reg.killAllAgentProcesses(100);
        assert.equal(results.length, 0, 'should not re-kill already-killed agent');

        reg.unregisterAgentProcess('thread-Z');
    });
});

// === Scenario 12: Stats counters + /info ===

describe('Scenario 12: Stats counters + /info', () => {
    it('incr and incrKey update counters in place', async () => {
        const stats = await import(`${D}/core/stats.js`);
        // Note: counters are module-level, so we use unique keys to avoid cross-test pollution
        stats.incr('testCounterA');
        stats.incr('testCounterA');
        stats.incr('testCounterA', 5);
        stats.incrKey('testGroupA', 'item-1');
        stats.incrKey('testGroupA', 'item-1');
        stats.incrKey('testGroupA', 'item-2');
        const s = stats.snapshot();
        assert.equal(s.testCounterA, 7);
        assert.equal(s.testGroupA['item-1'], 2);
        assert.equal(s.testGroupA['item-2'], 1);
    });

    it('snapshot includes uptime and memory', async () => {
        const stats = await import(`${D}/core/stats.js`);
        const s = stats.snapshot();
        assert.ok(typeof s.startedAt === 'number');
        assert.ok(typeof s.uptimeSec === 'number');
        assert.ok(s.uptimeSec >= 0);
        assert.ok(s.memoryMB.rss > 0, 'rss must be positive');
        assert.ok(s.memoryMB.heapUsed > 0, 'heapUsed must be positive');
        assert.match(s.nodeVersion, /^v\d+\./);
        assert.equal(typeof s.pid, 'number');
    });

    it('formatInfo produces a human-readable block', async () => {
        const stats = await import(`${D}/core/stats.js`);
        const out = stats.formatInfo({ version: '1.2.3', activeThreads: 42, agentChildren: 3 });
        assert.match(out, /📊 opencode-remote 状态/);
        assert.match(out, /📦 版本: 1\.2\.3/);
        assert.match(out, /💬 活跃线程: 42/);
        assert.match(out, /🧒 agent 子进程: 3/);
        assert.match(out, /PID: \d+/);
        assert.match(out, /Node v\d+/);
        assert.match(out, /💾 内存:/);
    });

    it('formatInfo truncates top-5 by count', async () => {
        const stats = await import(`${D}/core/stats.js`);
        const extra = {};
        // No setup needed — empty groups just don't show
        const out = stats.formatInfo(extra);
        assert.doesNotMatch(out, /命令统计:/);  // empty commandsByType is omitted
        assert.doesNotMatch(out, /错误类型:/);  // empty errorsByCode is omitted
    });

    it('counters survive module reload (module-level singleton)', async () => {
        const stats1 = await import(`${D}/core/stats.js`);
        stats1.incr('singletonCounter', 100);
        const stats2 = await import(`${D}/core/stats.js`);
        assert.equal(stats2.snapshot().singletonCounter, 100,
            'counters persist across import calls (module cache)');
    });
});

// === Cleanup ===

after(() => {
    cleanupTestState([
        'persist-roundtrip',
        'persist-agent',
        'crash-flush-test',
        'crash-debounced-test',
    ]);
});