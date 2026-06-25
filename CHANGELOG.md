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
  - Flushes state to disk
  - Kills OpenCode server
  - Kills all agent children (claude-code/copilot/codex/opencode)
- `beforeExit` handler that flushes state and kills OpenCode server
- `uncaughtException` handler that writes stack trace to `~/.opencode-remote/state/crash.log`
- `dist/core/state.js#flushWrite` exported for explicit synchronous flush
- Multi-turn conversation context (fixed regression where `buildContextualPrompt` produced misformatted output)
- 42+ integration tests across 12 scenarios (command routing, state persistence, error transparency, command lock bypass, auth gating, WeChat dedup, crash recovery, memory leak regression, multi-turn prompt, retry helper, agent subprocess lifecycle, stats counters)

### Changed
- Memory leak fix in `dist/weixin/adapter.js`: `contextTokens` and `typingTickets` now store `{ value, _ts }` instead of bare strings; cleanup checks `typeof v !== 'object'` for backward compatibility
- Empty catch blocks audited; added `console.debug` to non-critical ones in telegram adapter
- `/status` and `/info` documented in `getHelpText()` groups
- `detectCommand` strips duplicate `。`/`.` prefix (e.g. `。/help` → `help`)
- All commands bypass thread lock (only regular AI messages acquire it)

### Fixed
- **Agent subprocess orphan bug**: SIGTERM only killed OpenCode server, leaving claude-code/copilot/codex children running as orphans. Now `killAllAgentProcesses()` cleans up before exit.
- 3 ESM strict-mode `ReferenceError`s in cli.js/handler.js/bot.js (missing `let`/`const` declarations)
- `sendMessage` no longer wraps real errors in placeholder messages; throws are caught by `retryTransient` for proper retry
- `formatLabOutput` no longer silently swallows JSON parse failures
- `isDuplicate` uses content-based dedup (WeChat may return same message with different IDs)
- Buildcontext prompt now starts with `Continue the conversation as the assistant.` to prevent Claude from misreading conversation meta-language as instructions

### Security
- TLS cert verification enabled for WeChat API calls
- Credentials encrypted at rest via `dist/core/crypto.js`
- Auth gating: first `/start` claims ownership; subsequent users blocked unless shared room

### Documentation
- `docs/ARCHITECTURE.md` — process model, module map, message routing pipeline
- `docs/TROUBLESHOOTING.md` — bot won't start, messages not getting through, crashes, long task issues
- `docs/CONFIG.md` — env vars, state paths, port allocation, multi-bot setup
- `docs/ERROR_HANDLING.md` — throw vs return string decision matrix; forbidden patterns
- `LICENSE` (MIT)
- `README.md` updated with documentation index and quality assurance section

### Tooling
- TypeScript `checkJs` enabled via `tsconfig.json` (`npm run typecheck`)
- GitHub Actions CI matrix (Ubuntu/Windows × Node 20/22): `ci.yml`
- `Dockerfile` (multi-stage, node:22-alpine, dumb-init, healthcheck)
- `docker-compose.yml` (persistent state volume, log rotation, healthcheck)
- `.dockerignore`

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