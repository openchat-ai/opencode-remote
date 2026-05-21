import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

describe('core/router.js', () => {
  const mod = '../dist/core/router.js';

  it('COMMAND_ALIASES contains all expected commands', async () => {
    const { COMMAND_ALIASES } = await import(mod);
    const expected = ['start', 'help', 'status', 'reset', 'stop', 'restart',
      'sessions', 'delsessions', 'loop', 'edit',
      'refresh', 'copy', 'revert', 'upload', 'delete',
      'oc', 'cc', 'cx', 'copilot', 'agents', 'model'];
    for (const cmd of expected) {
      assert.ok(COMMAND_ALIASES[cmd], `Missing command: ${cmd}`);
    }
    assert.equal(Object.keys(COMMAND_ALIASES).length, 22);
  });

  it('detectCommand parses / prefixed commands', async () => {
    const { detectCommand } = await import(mod);
    const r = detectCommand('/status');
    assert.deepEqual(r, { name: 'status', arg: '' });
  });

  it('detectCommand parses . prefixed commands', async () => {
    const { detectCommand } = await import(mod);
    const r = detectCommand('.help');
    assert.deepEqual(r, { name: 'help', arg: '' });
  });

  it('detectCommand parses 。 prefixed commands', async () => {
    const { detectCommand } = await import(mod);
    const r = detectCommand('。start');
    assert.deepEqual(r, { name: 'start', arg: '' });
  });

  it('detectCommand handles h and ? as help', async () => {
    const { detectCommand } = await import(mod);
    assert.deepEqual(detectCommand('h'), { name: 'help', arg: '' });
    assert.deepEqual(detectCommand('?'), { name: 'help', arg: '' });
  });

  it('detectCommand returns null for plain text', async () => {
    const { detectCommand } = await import(mod);
    assert.equal(detectCommand('hello world'), null);
  });

  it('detectCommand extracts arg correctly', async () => {
    const { detectCommand } = await import(mod);
    const r = detectCommand('/model anthropic/claude-sonnet');
    assert.deepEqual(r, { name: 'model', arg: 'anthropic/claude-sonnet' });
  });

  it('parseMessage detects agent commands', async () => {
    const { parseMessage } = await import(mod);
    const r = parseMessage('/oc hello');
    assert.equal(r.type, 'agent');
    assert.equal(r.agent, 'opencode');
    assert.equal(r.prompt, 'hello');
  });

  it('parseMessage returns default for non-command', async () => {
    const { parseMessage } = await import(mod);
    const r = parseMessage('fix this bug');
    assert.equal(r.type, 'default');
    assert.equal(r.prompt, 'fix this bug');
  });

  it('parseMessage returns default for empty string', async () => {
    const { parseMessage } = await import(mod);
    const r = parseMessage('');
    assert.equal(r.type, 'default');
    assert.equal(r.prompt, '');
  });
});
