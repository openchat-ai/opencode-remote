# Error Handling Specification

This document is the **contract** for error handling in the codebase. All contributors must follow these rules when adding new code.

## Core principle

**Errors are propagated honestly. Never wrap a real error in a fake placeholder.**

❌ Bad: `return '⏰ 请求超时'` when the actual error was `ECONNREFUSED`
✅ Good: `throw new Error('ECONNREFUSED')` and let retryTransient handle it

❌ Bad: `responseText = '[empty response]'` when LLM returned `info.error="quota exceeded"`
✅ Good: `throw new Error('quota exceeded')` so user sees the real reason

## Decision matrix

| Scenario | Action | Why |
|----------|--------|-----|
| Network error (ECONNREFUSED, ECONNRESET, fetch failed) | **Retry** via `retryTransient()` | Transient — likely recovers |
| SDK timeout (AbortError) | **Throw** + retryTransient retries | Same request might succeed |
| LLM returned `info.error` | **Throw** with `info.error` text | User needs to know |
| LLM returned `parsed.error` | **Throw** with the error | User needs to know |
| `finish !== 'stop'` (e.g., length, error) | **Throw** with `finish=...` | Truncation / abnormal end |
| Empty response (no content, finish=stop) | **Throw** `Empty response ...` | Suspicious — retry |
| Stream parse error (JSON.parse failed) | **Throw** if `rawJson` empty; else use rawJson | Raw might have error text |
| HTTP 5xx from OpenCode | **Throw** + retryTransient | Transient |
| HTTP 4xx from OpenCode | **Throw** with status code | Permanent (auth, etc.) |
| WeChat rate limit (-1001, -1002, 45009, 45047) | **Retry** with backoff | Transient rate limit |
| WeChat session expired (-14) | **Refresh token + retry** | Recoverable |
| Unauthorized user | **Reply** with rejection message, return | User-facing concern |
| Missing credentials | **Throw** at startup, not at runtime | Config issue |

## Throw vs return string

### Functions that **throw** errors (let callers decide what to do):

- `sendMessage()` in `opencode/client.js` — all errors throw
- `agent.sendPrompt()` in plugins — all errors throw
- All `core/*` helpers — all errors throw
- All `retryTransient`-wrapped calls — errors propagate up

### Functions that **return** strings for the user:

- Top-level handler reply functions (after catch) — return the error as user message
- `adapter.reply()` returns nothing (success) or throws (failure)
- `handleCommand()` returns `true` (handled) or `false` (not handled)

### NEVER:

❌ Wrap a thrown error in a fake message and return it. This silently breaks retry.

```js
// BAD - swallows error from retryTransient
try {
    return await sendToOpenCode(...);
} catch (e) {
    return `❌ ${e.message}`;  // retryTransient can't retry this!
}
```

✅ Throw all the way up; only convert to user message at the top-level reply boundary:

```js
// GOOD
const result = await retryTransient(() => sendToOpenCode(...));
// result is either the success text or thrown error from retryTransient

// At the top level (handler), convert to user reply:
}).catch(e => {
    if (/AbortError/i.test(e.message)) { /* auto-restart OpenCode */ }
    return `❌ ${e.message}`;  // Real error from LLM/SDK
});
```

## Empty catch blocks

Empty `catch {}` is **forbidden** unless explicitly justified. Add a debug log:

```js
// BAD
try { unlinkSync(file); } catch {}

// GOOD
try { unlinkSync(file); } catch (e) { console.debug('[module] cleanup:', e.message); }
```

The ONLY acceptable empty catches:
- Process shutdown cleanup where nothing useful can be logged
- Fire-and-forget operations where failure is expected

If you must use one, add a comment explaining why:
```js
// Process is exiting; unlink may fail if file was already removed.
process.on('exit', () => { try { unlinkSync(PID_FILE); } catch {} });
```

## Retry semantics

`retryTransient(fn, opts)` retries on **transient errors** (see `dist/core/retry.js`):

```js
import { retryTransient, TRANSIENT_PATTERNS } from './retry.js';

const result = await retryTransient(async () => {
    return await sendToOpenCode(...);  // must throw on error
}, {
    maxAttempts: 2,
    baseDelayMs: 2000,
    maxDelayMs: 8000,
    onRetry: (err, attempt, delay) => { /* notify user */ },
});
```

**If your function returns a string instead of throwing on error, retry will NOT trigger.**

## Logging levels

Use these consistently:

| Level | When | Console |
|-------|------|---------|
| `console.error` | Errors that affect user | `[module] message` |
| `console.warn` | Recoverable issues | `[module] message` |
| `console.log` | Significant state changes | emoji-prefixed |
| `console.debug` | Diagnostic, not for users | `[module] detail` |
| `console.info` | Normal flow | (rarely) |

Always include the **module name** in brackets: `[fwdToOpenCode]`, `[sendMessage]`, etc.

## User-facing error messages

When the bot shows an error to the user, follow these rules:

1. **Show the actual error**, not a placeholder
2. **Prefix with `❌`** for errors
3. **Be concise** — one line is best
4. **Include context** when helpful (e.g., which agent failed)
5. **Don't apologize** — just state the fact

```js
// GOOD
replyTo(tid, `❌ ${e.message}`, adapter);

// BAD — fake, generic
replyTo(tid, '❌ 处理失败，请重试', adapter);
```

## Process-level errors

The parent process handles errors differently than child:

### Parent (`cli.js`)
- Child exit code 0 → no action
- Child exit code 200 → restart after 1s (user-initiated `/restart`)
- Child exit null → killed by signal, restart with backoff
- Other exit codes → crash, restart with backoff
- 5 crashes in 60s → give up, require manual intervention

### Child
- All errors caught by handlers, logged, replied to user
- Unhandled rejection → logged but not fatal (Node.js default)
- Uncaught exception → would crash, parent restarts

## Adding new error-prone code

When writing new code that interacts with external systems:

1. **Identify all error paths** (network, parse, business logic)
2. **Categorize each** as transient or permanent (decision matrix above)
3. **Throw** on errors, return on success
4. **Wrap** with `retryTransient()` only if transient
5. **At the top-level handler**, convert thrown errors to user messages
6. **Test** the error path explicitly (not just happy path)

## Review checklist

Before merging PRs with error handling:

- [ ] All new `try/catch` blocks have meaningful bodies (not empty)
- [ ] Errors are thrown, not wrapped in fake messages
- [ ] `retryTransient` is used for transient errors only
- [ ] User-facing messages show the real error
- [ ] Logs include module name in brackets
- [ ] Integration tests cover the error path
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes