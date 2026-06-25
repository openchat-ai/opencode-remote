// Router unit tests
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Use dynamic import with path resolution
const { detectCommand, COMMAND_ALIASES } = await import('../dist/core/router.js');

describe('detectCommand', () => {
    // Build reverse map: name → primary alias
    const primaryAliases = {};
    for (const [name, aliases] of Object.entries(COMMAND_ALIASES)) {
        primaryAliases[name] = aliases[0];
    }

    it('detects /help command', () => {
        const r = detectCommand('/help');
        assert.equal(r?.name, 'help');
    });

    it('detects /start command', () => {
        const r = detectCommand('/start');
        assert.equal(r?.name, 'start');
    });

    it('detects /restart command', () => {
        const r = detectCommand('/restart');
        assert.equal(r?.name, 'restart');
    });

    it('detects /bind command', () => {
        const r = detectCommand('/bind');
        assert.equal(r?.name, 'bind');
    });

    it('detects /esc command', () => {
        const r = detectCommand('/esc');
        assert.equal(r?.name, 'esc');
    });

    it('detects /abort alias for esc', () => {
        const r = detectCommand('/abort');
        assert.equal(r?.name, 'esc');
    });

    it('detects /stop alias for esc', () => {
        const r = detectCommand('/stop');
        assert.equal(r?.name, 'esc');
    });

    it('detects /h shortcut for help', () => {
        const r = detectCommand('h');
        assert.equal(r?.name, 'help');
    });

    it('detects ? shortcut for help', () => {
        const r = detectCommand('?');
        assert.equal(r?.name, 'help');
    });

    it('detects /deploy command', () => {
        const r = detectCommand('/deploy');
        assert.equal(r?.name, 'deploy');
    });

    it('detects /gitpush alias for deploy', () => {
        const r = detectCommand('/gitpush');
        assert.equal(r?.name, 'deploy');
    });

    it('returns null for unrecognized command', () => {
        const r = detectCommand('/nonexistent');
        assert.strictEqual(r, null);
    });

    it('returns null for plain text', () => {
        const r = detectCommand('hello world');
        assert.strictEqual(r, null);
    });

    it('extracts argument from command', () => {
        const r = detectCommand('/model gpt-4');
        assert.equal(r?.name, 'model');
        assert.equal(r?.arg, 'gpt-4');
    });

    it('handles Chinese dot prefix', () => {
        const r = detectCommand('。/help');
        assert.equal(r?.name, 'help');
    });

    it('handles period prefix', () => {
        const r = detectCommand('.help');
        assert.equal(r?.name, 'help');
    });

    it('all registered aliases are resolvable', () => {
        const cmds = Object.values(COMMAND_ALIASES).flat();
        for (const alias of cmds) {
            const r = detectCommand(`/${alias}`);
            assert.ok(r !== null, `/${alias} should resolve to a command`);
            assert.ok(COMMAND_ALIASES[r.name] !== undefined, `${r.name} should be in COMMAND_ALIASES`);
        }
    });

    it('expert is NOT in COMMAND_ALIASES (content trigger only)', () => {
        assert.strictEqual(COMMAND_ALIASES['expert'], undefined);
    });

    it('invite is NOT in COMMAND_ALIASES (removed, no handler)', () => {
        assert.strictEqual(COMMAND_ALIASES['invite'], undefined);
    });

    it('/expert returns null (falls through to content trigger)', () => {
        const r = detectCommand('/expert');
        assert.strictEqual(r, null);
    });
});
