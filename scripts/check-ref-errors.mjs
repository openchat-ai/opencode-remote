// Phase 3: ReferenceError check for ESM strict mode
// Catches undeclared variable assignments that would throw at runtime
import { readdirSync, readFileSync } from 'fs';
import { join, extname, relative } from 'path';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const SRC_DIR = join(root, 'dist');
const GLOBALS = new Set([
  'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'globalThis', 'Promise', 'setTimeout', 'clearTimeout',
  'fetch', 'Request', 'Response', 'Headers',
  'AbortController', 'AbortSignal',
  'TextEncoder', 'TextDecoder',
  'WebSocket', 'URL', 'URLSearchParams',
  'BigInt', 'Symbol',
]);

function stripJS(src) {
  // Remove string literals and comments to avoid false matches
  return src
    .replace(/'[^']*'/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function collectDeclarations(src) {
  const decls = new Set();
  // let X, const X, var X
  const declRe = /(?:let|const|var)\s+([a-zA-Z_$][\w$]*)/g;
  let m;
  while ((m = declRe.exec(src)) !== null) decls.add(m[1]);
  // function X
  const funcRe = /function\s+([a-zA-Z_$][\w$]*)/g;
  while ((m = funcRe.exec(src)) !== null) decls.add(m[1]);
  // import { X }
  const importRe = /import\s+(?:\{\s*([^}]+)\}|([a-zA-Z_$][\w$]*)\s+from)/g;
  while ((m = importRe.exec(src)) !== null) {
    const names = (m[1] || m[2] || '').split(',').map(s => {
      const a = s.trim().split(/\s+as\s+/);
      return a[a.length - 1]?.trim();
    }).filter(Boolean);
    names.forEach(n => decls.add(n));
  }
  // import * as X
  const nsRe = /import\s+\*\s+as\s+([a-zA-Z_$][\w$]*)/g;
  while ((m = nsRe.exec(src)) !== null) decls.add(m[1]);
  // function parameters: function(a, b, c)
  const paramRe = /(?:async\s+)?function\s*\*?\s*\(([^)]*)\)/g;
  while ((m = paramRe.exec(src)) !== null) {
    m[1].split(',').map(s => {
      const p = s.trim().split(/\s*=\s*/)[0].trim();
      if (p && /^[a-zA-Z_$][\w$]*$/.test(p)) decls.add(p);
    });
  }
  // arrow params: (a, b) =>  or a =>
  const arrowRe = /(?:\(([^)]*)\)|([a-zA-Z_$][\w$]*))\s*=>/g;
  while ((m = arrowRe.exec(src)) !== null) {
    const params = (m[1] || m[2] || '').split(',').map(s => {
      const p = s.trim().split(/\s*=\s*/)[0].trim();
      if (p && /^[a-zA-Z_$][\w$]*$/.test(p)) decls.add(p);
    });
  }
  // catch(e)
  const catchRe = /catch\s*\(([^)]+)\)/g;
  while ((m = catchRe.exec(src)) !== null) decls.add(m[1].trim());
  return decls;
}

function findAssignments(src) {
  const assigns = [];
  // x = ..., x += ..., x++, x-- (not obj.x, not this.x)
  // Simple heuristic: identifier followed by =/+=-=/=/=/*=/%=/||=/&&=/??=
  const assignRe = /(?:^|[^a-zA-Z_$])([a-zA-Z_$][\w$]*)\s*(?:=(?!>)|[-+*/%&|^]=|\+\+|--)/gm;
  let m;
  while ((m = assignRe.exec(src)) !== null) {
    const name = m[1];
    // Filter out property access: obj.x is already split, but catch patterns like arr[i]
    const before = src.slice(Math.max(0, m.index - 10), m.index);
    if (/[.\]]/.test(before.slice(-1))) continue;
    if (name === 'exports' || name === 'module') continue;
    assigns.push({ name, index: m.index });
  }
  return assigns;
}

let exitCode = 0;
const allDecls = new Set(GLOBALS);

console.log('◆ Phase 3: ReferenceError check (undeclared assignments)');

function walk(dir, depth = 0) {
  if (depth > 4) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, depth + 1); continue; }
    const ext = extname(entry.name);
    if (ext !== '.js' && ext !== '.mjs') continue;
    const rel = relative(root, full);
    const src = readFileSync(full, 'utf8');
    const clean = stripJS(src);
    const decls = collectDeclarations(clean);
    const assigns = findAssignments(clean);
    for (const a of assigns) {
      if (!decls.has(a.name) && !GLOBALS.has(a.name)) {
        console.error(`  ✖ ${rel}: undeclared assignment '${a.name}'`);
        exitCode = 1;
      }
    }
  }
}

walk(SRC_DIR);

if (exitCode === 0) {
  console.log('  ✅ No undeclared assignments found');
} else {
  console.log('\n  Tip: Add `let`, `const`, or `import` for each flagged name.');
}
process.exit(exitCode);
