import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
let exitCode = 0;

function run(desc, fn) {
  try { fn(); return true; } catch (e) {
    const msg = e.stderr?.toString() || e.message || '';
    const line = msg.match(/(?:.*\.(?:js|mjs)):\d+/)?.[0] || desc;
    console.error(`\n✖ ${line}`);
    exitCode = 1;
    return false;
  }
}

// Phase 1: syntax check (node --check)
console.log('◆ Phase 1: Syntax check');
function walk(dir, depth = 0) {
  if (depth > 4) return;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { n += walk(full, depth + 1); continue; }
    const ext = extname(entry.name);
    if (ext !== '.js' && ext !== '.mjs') continue;
    run(relative(root, full), () => execSync(`node --check "${full}"`, { stdio: 'pipe' }));
    n++;
  }
  return n;
}
const count = walk(root);
console.log(`  ${count} files checked`);

// Phase 2: module resolution (catch missing exports)
console.log('\n◆ Phase 2: Module resolution');
const entryPoints = [
  'dist/cli.js',
  'dist/index.js',
  'dist/weixin/bot.js',
  'dist/weixin/adapter.js',
  'dist/weixin/commands.js',
  'dist/weixin/handler.js',
  'dist/weixin/api.js',
  'dist/weixin/qiniu-upload.js',
  'dist/weixin/flush.js',
  'dist/weixin/memory-manager.js',
  'dist/weixin/git.js',
  'dist/feishu/bot.js',
  'dist/telegram/bot.js',
  'dist/core/router.js',
  'dist/core/session.js',
  'dist/core/auth.js',
  'dist/core/registry.js',
  'dist/opencode/client.js',
  'bin/opencode-remote.js',
];

(async () => {
  let checked = 0;
  for (const ep of entryPoints) {
    const abs = join(root, ep);
    try {
      await import(abs);
      process.stdout.write('.');
    } catch (e) {
      if (e.code === 'ERR_MODULE_NOT_FOUND' || e.message.includes('does not provide an export')) {
        console.error(`\n✖ ${ep}: ${e.message.split('\n')[0]}`);
        exitCode = 1;
      }
      // Runtime errors (e.g. missing runtime deps) are OK — we only check module graph
    }
    checked++;
  }
  console.log(`\n  ${checked} modules checked`);
  console.log(exitCode === 0 ? '✅ All checks passed' : '❌ Some checks failed');
  process.exit(exitCode);
})();
