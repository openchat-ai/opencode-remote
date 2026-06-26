# Changelog

All notable changes to opencode-remote are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `/info` command — bot runtime diagnostics (uptime, message count, error types, memory, agent children)
- `dist/core/stats.js` — in-memory runtime counters with `incr`, `incrKey`, `snapshot`, `formatInfo`
- `dist/core/agent-registry.js#killAllAgentProcesses()` — bulk-kill all registered agent subprocesses
- SIGTERM/SIGINT/SIGBREAK graceful shutdown handlers in `dist/core/state.js`
- `beforeExit` handler that flushes state and kills OpenCode server
- `uncaughtException` handler that writes stack trace to `~/.opencode-remote/state/crash.log`
- `dist/core/state.js#flushWrite` exported for explicit synchronous flush
- Multi-turn conversation context (fixed regression where `buildContextualPrompt` produced misformatted output)
- 95+ integration tests across 14 scenarios
- HTTP health check endpoint (`GET /health`, port 9090 via `HEALTH_PORT` env) — returns 200/503 based on child process heartbeat
- `dist/opencode/client.js#resetOpenCode()` — force-clear cached singleton to make auto-recovery actually work after AbortError
- `test/helpers/agent-simulator.mjs` — behavior-level simulation encoding 5 real CLI bug patterns
- `dist/core/stats.js` counters wired into handler.js (messagesReceived, authRejections, retries, errorsByCode, opencodeRestarts)

### Changed
- Memory leak fix in `dist/weixin/adapter.js`: `contextTokens` and `typingTickets` now store `{ value, _ts }` instead of bare strings
- Empty catch blocks audited; added `console.debug` to non-critical ones
- `/status` and `/info` documented in `getHelpText()` groups
- `detectCommand` strips duplicate `。`/`.` prefix (e.g. `。/help` → `help`)
- All commands bypass thread lock (only regular AI messages acquire it)
- Default `thinkVisibleEnabled` changed to `true`
- Session cleanup intervals in feishu/bot.js and weixin/bot.js now call `.unref()` so they don't prevent process exit
- Build context prompt format changed to `[Previous conversation — for context only, answer the LATEST question below]` (fixes claude-code CLI session-memory refusal)
- `setInterval` in startTypingPing auto-clears after 30s of inactivity
- All 4 agent CLIs (claude-code/codex/copilot/opencode) apply same shell-safe transform: strip `\n\r &|<>^"` before `spawn("shell: true")`
- Docker HEALTHCHECK now uses HTTP health endpoint instead of PID file check

### Fixed
- **AbortError auto-recovery broken**: `initOpenCode()` returned stale cached `opencodeInstance` singleton after kill, making automatic restart a no-op. Added `resetOpenCode()` to null the cache before retry.
- **Agent subprocess orphan bug**: SIGTERM only killed OpenCode server, leaving claude-code/copilot/codex children running as orphans. Now `killAllAgentProcesses()` cleans up before exit.
- 3 ESM strict-mode `ReferenceError`s in cli.js/handler.js/bot.js (missing `let`/`const` declarations)
- `sendMessage` no longer wraps real errors in placeholder messages; throws are caught by `retryTransient` for proper retry
- `formatLabOutput` no longer silently swallows JSON parse failures
- `isDuplicate` uses content-based dedup (WeChat may return same message with different IDs)
- Memory leak in adapter.js: legacy bare-string entries in contextTokens/typingTickets now purged by `typeof v !== 'object'` check
- Thread lock stale cleanup: 10-min timeout auto-releases; threadLastActive also cleaned at 1hr cutoff
- IPC heartbeat honesty: no fake "⏳ 处理中" or "lab 跑失败" placeholders
- AbortError now triggers SIGKILL on OpenCode server + re-initOpenCode (not just returns error string)
- `/lab` command injection (HIGH): `execSync(string)` replaced with `spawnSync('node', ['lab.mjs', subCmd], { shell: false })` + whitelist
- `/deploy` command injection (HIGH): all `execSync` calls replaced with `execFileSync(git, args[])` + branch whitelist
- All 4 agents fixed for `shell: true` + newline truncation bug (claude-code CLI drops everything after first `\n`)
- All 4 agents fixed for shell metachar injection (`&|<>^"` stripped from prompts before spawn)
- Build context prompt format fixed: claude-code CLI refused "Continue the conversation" prefix on fresh sessions
- Missing `.unref()` on persistent session cleanup intervals in feishu/bot.js and weixin/bot.js
- 3 ESM strict-mode `ReferenceError`s (isRestart, recentHistory→history, firstAdapter)

### Security
- TLS cert verification enabled for WeChat API calls
- Credentials encrypted at rest via `dist/core/crypto.js`
- Auth gating: first `/start` claims ownership; subsequent users blocked unless shared room
- **Shell injection in /lab**: subCmd now validated against `/^[a-zA-Z0-9_-]+$/` whitelist
- **Shell injection in /deploy**: branch name validated via `isValidGitRef` whitelist; all `execSync` → `execFileSync` with args arrays
- **Shell metachar sanitization**: all 4 agent CLIs strip `&|<>^"` from prompts before passing to `spawn("shell: true")`

### Documentation
- `docs/ARCHITECTURE.md` — process model, module map, message routing pipeline
- `docs/TROUBLESHOOTING.md` — bot won't start, messages not getting through, crashes, long task issues
- `docs/CONFIG.md` — env vars, state paths, port allocation, multi-bot setup
- `docs/ERROR_HANDLING.md` — throw vs return string decision matrix; forbidden patterns
- `LICENSE` (MIT)
- `README.md` updated with documentation index and quality assurance section

### Tooling
- TypeScript `checkJs` enabled via `tsconfig.json` (`npm run typecheck`); 22 type errors fixed → 0
- GitHub Actions CI matrix (Ubuntu/Windows × Node 20/22): `ci.yml`
- `Dockerfile` (multi-stage, node:22-alpine, dumb-init, HTTP healthcheck)
- `docker-compose.yml` (persistent state volume, log rotation, healthcheck)
- `.dockerignore`
- `CHANGELOG.md` with Unreleased section

## [0.18.0] — 2026-06-26

All changes from [Unreleased] section stabilized into this release.

### Added
- `/info` command, `stats.js` runtime counters, HTTP health endpoint on 9090
- `resetOpenCode()` for proper AbortError auto-recovery
- Agent simulator with 5 CLI bug pattern encodings
- 95 integration tests (up from 42)

### Changed
- Session cleanup intervals `.unref()`'d
- All 4 agents use shell-safe prompt transform
- Docker HEALTHCHECK uses HTTP endpoint

### Fixed
- AbortError auto-recovery (was broken by stale singleton cache)
- /lab + /deploy command injection (HIGH severity)
- Agent newline truncation + shell metachar injection
- Missing `.unref()` on timers preventing graceful exit
- 3 ReferenceErrors, memory leak, orphan agent children

## [0.17.0] — 2026-06-25

Initial stable release shipped via PM2/Windows Service.
- WeChat bot via iLink protocol
- Feishu bot via WebSocket
- Telegram bot via long-polling
- 4 agent plugins: opencode (default), claude-code, codex, copilot
- File storage via Qiniu (S3-compatible)
- Thread locking per conversation context
- Shared room mode for multi-user collaboration

[Unreleased]: https://github.com/yvhitxcel/opencode-remote/compare/v0.17.0...HEAD
[0.17.0]: https://github.com/yvhitxcel/opencode-remote/releases/tag/v0.17.0