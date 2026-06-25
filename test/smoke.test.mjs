// Smoke test — verifies key modules load and core exports exist
let failed = 0;
let passed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, msg) { failed++; console.log(`  ❌ ${name}: ${msg}`); }

async function tryImport(path, names) {
    try {
        const mod = await import(path);
        if (names && names.length) {
            const missing = names.filter(n => mod[n] === undefined);
            if (missing.length) { fail(path, `missing exports: ${missing.join(', ')}`); return; }
        }
        ok(path);
    } catch (e) { fail(path, e.message); }
}

console.log('\n🔍 Smoke test\n');

const D = '../dist';

// Core modules
await tryImport(`${D}/core/state.js`, ['threadHistory', 'threadAgent', 'initState', 'flushWrite']);
await tryImport(`${D}/core/log.js`, ['logger', 'initLogger', 'cleanOldLogs']);
await tryImport(`${D}/core/retry.js`, ['retryTransient', 'isTransientError']);
await tryImport(`${D}/core/lru.js`, ['LRUSessionMap']);
await tryImport(`${D}/core/crypto.js`, ['encryptCredential', 'decryptCredential']);
await tryImport(`${D}/core/agent-registry.js`, ['registerAgentProcess', 'unregisterAgentProcess', 'killAgentProcess']);
await tryImport(`${D}/core/handler.js`, ['createHandler', 'formatLabOutput']);
await tryImport(`${D}/core/router.js`, ['detectCommand', 'getHelpText', 'COMMAND_ALIASES']);
await tryImport(`${D}/core/auth.js`, ['isAuthorized', 'hasOwner', 'claimOwnership']);
await tryImport(`${D}/core/notifications.js`, ['splitMessage']);

// Platform handlers
await tryImport(`${D}/weixin/handler.js`, ['handleMessage', 'forwardToOpenCode']);
await tryImport(`${D}/weixin/commands.js`, ['handleCommand', 'handleAgentSwitch']);
await tryImport(`${D}/feishu/handler.js`, ['handleMessage', 'forwardToOpenCode']);
await tryImport(`${D}/feishu/commands.js`, ['handleCommand']);

// Telegram adapter
await tryImport(`${D}/telegram/adapter.js`, ['telegramAdapter']);
const tg = await import(`${D}/telegram/adapter.js`);
if (typeof tg.telegramAdapter.reply === 'function') ok('telegram adapter has reply()');
else fail('telegram adapter', 'missing reply()');
if (typeof tg.telegramAdapter.sendTypingIndicator === 'function') ok('telegram adapter has sendTypingIndicator()');
else fail('telegram adapter', 'missing sendTypingIndicator()');

// Agent adapters
await tryImport(`${D}/plugins/agents/claude-code/index.js`, ['ClaudeCodeAgentAdapter']);
await tryImport(`${D}/plugins/agents/opencode/index.js`, ['OpenCodeAgentAdapter']);
await tryImport(`${D}/plugins/agents/codex/index.js`, ['CodexAgentAdapter']);
await tryImport(`${D}/plugins/agents/copilot/index.js`, ['CopilotAgentAdapter']);

// State API check
const ta = (await import(`${D}/core/state.js`)).threadAgent;
if (typeof ta.get === 'function' && typeof ta.set === 'function') ok('threadAgent has get/set');
else fail('threadAgent', 'missing get/set');

const th = (await import(`${D}/core/state.js`)).threadHistory;
if (typeof th.get === 'function' && typeof th.set === 'function') ok('threadHistory has get/set');
else fail('threadHistory', 'missing get/set');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
