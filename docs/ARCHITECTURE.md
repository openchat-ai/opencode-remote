# OpenCode Remote Control — Architecture

## Purpose

Bridge between messaging platforms (WeChat, Feishu, Telegram) and AI agent CLIs (OpenCode, Claude Code, Codex, Copilot). Allows you to control your development environment from your phone.

## High-level data flow

```
┌──────────┐   long-poll    ┌────────────┐   SDK call    ┌──────────────┐
│  WeChat  │ ◄────────────► │  bot.js    │ ◄──────────► │ OpenCode SDK │
│  iLink   │                │  (dist/cli │              │  (HTTP)      │
│   API    │                │    .js)    │              │              │
└──────────┘                └────────────┘              └──────────────┘
                                   │
                                   │ spawn child
                                   ▼
                             ┌────────────┐
                             │  child.js  │
                             │  (worker)  │
                             └────────────┘
```

When the parent process (`dist/cli.js`) starts, it spawns a child process running the actual bot logic. The parent supervises the child via:
- File descriptor close detection → restart
- IPC heartbeat (every 30s, 120s timeout) → kill stuck child
- Crash backoff (1s→2s→4s→8s, 5 in 60s = give up)

## Process model

```
$ npm start
  └─ dist/cli.js (parent, PID=1000)
       └─ node dist/cli.js (child, OPENCODE_CHILD=1, PID=1001)
            └─ opencode serve --port=4096 (OpenCode SDK server, PID=1002)
```

The parent **does not** handle messages — it only supervises. The child runs the actual bot logic and the OpenCode SDK client.

### Why parent/child?

If the child crashes (uncaught exception, OOM, etc.), the parent detects it via `child.on('close')` and respawns. This survives:
- Bot crashes
- Memory leaks (eventually OOM)
- Unhandled rejections (though these are now caught explicitly)

### Restart flow

```
child exits with code:
├─ 0       → clean shutdown, no restart
├─ 200     → explicit /restart, restart after 1s
├─ null    → killed by signal, treat as crash
└─ other   → crash, restart with backoff

if crashCount >= 5 in 60s → exit parent (give up, require manual restart)
```

### PID file lock

`~/.opencode-remote/parent.pid` holds the parent's PID. If another `opencode-remote` starts, it reads the file, kills the old parent tree via `taskkill /F /T /PID`, then writes its own PID. Prevents two parents fighting over ports.

## Module map

```
dist/
├── cli.js                    # Parent process entry + child spawn
├── core/
│   ├── handler.js            # createHandler(deps) → handleMessage, forwardToOpenCode
│   ├── router.js             # detectCommand, COMMAND_ALIASES, EXPERT_SYSTEM_PROMPT
│   ├── state.js              # threadHistory + threadAgent persistence (JSON)
│   ├── retry.js              # retryTransient with exponential backoff
│   ├── auth.js               # Owner claim + per-thread authorization
│   ├── agent-registry.js     # Subprocess tracking (cc/cx/copilot)
│   ├── log.js                # Daily rotating log (5MB, 7-day retention)
│   ├── lru.js                # LRU session map (100 entries, 30min TTL)
│   ├── crypto.js             # AES-256-GCM credential encryption
│   ├── git-push.js           # Multi-mirror git push
│   └── qiniu.js              # Qiniu cloud storage integration
├── opencode/
│   └── client.js             # OpenCode SDK wrapper (sessions, prompt, abort)
├── plugins/agents/
│   ├── claude-code/index.js  # Claude Code CLI wrapper
│   ├── codex/index.js        # OpenAI Codex CLI wrapper
│   ├── copilot/index.js      # GitHub Copilot CLI wrapper
│   └── opencode/index.js     # OpenCode CLI wrapper (alternative)
├── weixin/
│   ├── bot.js                # WeChat bot (login, polling loop, instance mgmt)
│   ├── adapter.js            # WeChat adapter (reply, sendTyping, dedup, contextToken)
│   ├── api.js                # WeChat iLink API (getUpdates, sendMessage, getConfig)
│   ├── commands.js           # Command dispatcher (handleCommand, handleAgentSwitch)
│   └── handler.js            # Wires core handler with weixin deps
├── feishu/
│   └── ...                   # Feishu equivalents
└── telegram/
    └── ...                   # Telegram equivalents (uses grammy)
```

## Message routing pipeline

For every WeChat message received:

```
bot.js:runPollingLoop
  └─ adapter.isDuplicate(messageId, `${userId}:${text}`)  ← skip duplicates
  └─ adapter.contextTokens.set(userId, msg.context_token)
  └─ await handleMessage(adapter, ctx, text, sessions)

handler.js:handleMessage
  ├─ /z handler  → fwdToOpenCode with expertPrompt (bypasses lock)
  ├─ detectCommand → handleCommand (bypasses lock — all 21 commands)
  └─ acquire threadLock
     ├─ expert triggers (sets expertPrompt variable)
     ├─ pending decision check
     ├─ auth check (rejects unauthorized when owner exists)
     ├─ if threadAgent set (cc/cx/copilot) → agent path
     └─ else → fwdToOpenCode (default OpenCode SDK)

fwdToOpenCode
  ├─ Acquire or resume OpenCode session (per-thread)
  ├─ Build prompt (inject expertPrompt, reasoning content)
  ├─ retryTransient(sendMessage)  ← 2 attempts on transient errors
  │   └─ sendToOpenCode
  │       ├─ session.prompt(stream)
  │       ├─ accumulate stream → rawJson
  │       └─ parse, extract parts (text + reasoning)
  ├─ Reply to user (splitMessage for long responses)
  └─ Share session URL if non-error
```

## State model

### threadHistory
- Persisted to `~/.opencode-remote/state/state.json`
- Each entry: `[{ role: 'user'|'assistant', content: string }]`
- Max 20 entries per thread, max 1000 threads
- Auto-debounced write (2s)

### threadAgent
- Maps threadId → agent name (opencode | claude-code | codex | copilot)
- Set by `/cc`, `/cx`, etc.
- Cleared by `/oc` (back to default)

### session.client (in-memory only)
- LRUSessionMap, max 100 entries, 30min TTL
- Maps threadId → OpenCode session object

## Error propagation philosophy

Errors are **propagated honestly**, not wrapped in fake messages:
- LLM SDK errors → `throw new Error(response.error)` → retryTransient retries
- Empty response → `throw new Error('Empty response ...')` → retryTransient retries
- Auth errors → throw → retryTransient → final error to user
- Network errors → caught by retryTransient, retried with backoff

The user sees the **real error message** from the SDK/server, not a placeholder like "请求超时" or "AI 返回为空". If retry succeeds, user sees the actual response. If retry fails, user sees the actual error.

## Key design choices

### Why bypass lock for all commands?
- Users need to `/esc` during long tasks without waiting
- Commands are quick (reply + maybe abort) — safe to run concurrently with AI processing
- Thread lock only prevents concurrent processing of the same thread's messages

### Why per-thread lock instead of per-process lock?
- Different users should be able to send messages in parallel
- Lock granularity is threadId, not global

### Why content-based dedup (not just messageId)?
- WeChat API may return same message with different messageId in consecutive polls
- Content key `${userId}:${text}` is more reliable

### Why IPC heartbeat (vs just `child.on('close')`)?
- Child process can be alive but stuck (event loop blocked, infinite loop)
- `close` event only fires on exit
- IPC heartbeat detects stuck-but-alive scenarios

### Why 180s default timeout (not 600s or 30s)?
- Most AI responses complete in 30-60s
- 180s gives buffer for tool-using agents
- Long tasks can override via `OPENCODE_TIMEOUT` env var
- After timeout, retry once (max 360s total wait)

## Limitations

- WeChat iLink API is a private SDK — protocol changes may break this
- OpenCode SDK has its own breaking change cadence
- No built-in metrics/monitoring (logs only)
- No authentication beyond first-user-claims-owner (not enterprise-grade)
- No rate limit awareness for AI providers (only network-level retries)