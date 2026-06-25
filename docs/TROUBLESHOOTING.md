# Troubleshooting

Common issues and how to fix them.

## Bot won't start

### Symptom: `npm start` exits immediately
1. Check Node version: `node --version` → must be ≥ 18
2. Check `~/.opencode-remote/` directory permissions
3. Run with debug logs: `DEBUG_RAW=1 npm start`

### Symptom: "Address already in use" for ports 4096-4098
```bash
# Windows
netstat -ano | findstr ":4096"
taskkill /F /PID <pid>
```
Or just restart the bot — it has automatic port cleanup before spawn.

### Symptom: "OPENCODE_TIMEOUT" not respected
The timeout is in **seconds**, not milliseconds:
- `OPENCODE_TIMEOUT=180` means 180 seconds = 3 minutes
- Default is 180s (3 minutes)

## Bot starts but messages don't get through

### Symptom: User sends message but bot doesn't respond
1. Check ownership: First user must `/start` to claim ownership
2. Check bot logs for auth rejection: `🚫 你无权使用此 bot`
3. If owner was claimed on a different account, reset auth:
   ```bash
   rm ~/.opencode-remote/weixin/credentials*.json
   # Or for encrypted storage:
   rm ~/.opencode-remote/weixin/credentials/*.json
   ```

### Symptom: Bot responds to commands but not AI messages
- OpenCode server might be down. Run `/diagnose`
- If `❌ OpenCode 离线`, restart OpenCode: `/restart`

### Symptom: "Failed to resume session" errors
Sessions go stale if OpenCode server restarts. The bot tries to auto-recover:
1. Deletes dead session from local cache
2. Creates new session on next message
If this keeps happening, OpenCode server is unstable — check `~/.opencode-remote/state/state.json` is writable.

## Bot crashes repeatedly

### Symptom: "crashes in 60s, giving up"
The parent process gives up after 5 crashes in 60 seconds. To debug:
1. Run in foreground (not via parent): `OPENCODE_CHILD=1 npm start`
2. Look at the actual error in the child process output
3. Common causes:
   - WeChat credentials expired → re-login
   - OpenCode server crashed → kill any zombies on ports 4096-4098
   - Memory leak in long-running session → restart every 24h via cron

### Symptom: IPC heartbeat timeout (child killed every 120s)
The child isn't sending heartbeats. Causes:
- Bot is stuck on synchronous I/O (CPU bound)
- Event loop is blocked by a heavy computation
- A setInterval is keeping the loop busy

To debug, check what the child is doing when it gets killed. Add logging to long-running operations.

## Long task issues

### Symptom: User sends `/esc` but task keeps running
This is fixed in recent versions. If you see this:
1. Make sure you're on v0.17.0+
2. The `/esc` command bypasses thread lock and triggers `abortSession`
3. If task still doesn't abort, the OpenCode SDK session is hung → `/restart`

### Symptom: Long task takes > 3 minutes and times out
Default timeout is 180 seconds. To extend:
```bash
OPENCODE_TIMEOUT=600 npm start   # 10 minutes
```
Or in your environment file.

After timeout, the bot:
1. Aborts the SDK request
2. Retries once (so total wait = 360s)
3. If retry also times out, kills and restarts the OpenCode server
4. Returns the actual error to the user

### Symptom: "❌ Empty response" from LLM
The LLM returned a successful response with no content. Causes:
- Model returned `info.finish=length` (truncated due to max_tokens)
- Model returned an error in `info.error` field (now propagated as error)
- Streaming connection was interrupted mid-response

The bot now propagates the actual error instead of generic placeholder. If you see this consistently, check:
- Your model provider's quota/rate limit
- Network stability between bot and OpenCode server
- The model itself (try a different one)

## State persistence issues

### Symptom: threadHistory is empty after restart
State is persisted to `~/.opencode-remote/state/state.json`. Check:
1. File exists and is readable
2. JSON is valid: `cat ~/.opencode-remote/state/state.json | jq`
3. Disk space available (state can grow to ~20MB with 1000 threads)

If file is corrupted:
1. Stop the bot
2. Delete `state.json.bad` if exists
3. Rename `state.json.bak` to `state.json` (if .bak exists)
4. Restart

### Symptom: Agent routing forgotten (back to OpenCode after restart)
Check `threadAgent` field in state.json:
```bash
cat ~/.opencode-remote/state/state.json | jq '.threadAgent'
```

If a thread is missing from this object, the routing is lost. Re-send `/cc`, `/cx`, etc. to set it again.

## Memory leaks

### Symptom: Bot process memory grows unbounded over days
Causes:
- `contextTokens` Map not cleaning up (fixed: now wrapped with `_ts` timestamp)
- `threadLastActive` Map not cleaning up (fixed: 1-hour cleanup)
- `userAdapterMap` not cleaning up (fixed: max 5000 + 30min interval)

If you still see growth:
1. Restart bot every 24h via cron
2. Check for plugin memory leaks in `dist/plugins/agents/*/index.js`

## Diagnostic commands

### /diagnose
Shows current state:
- OpenCode connection status
- WeChat API status
- Memory usage
- Recent log lines

### /status
Shows current session state for this thread:
- Active OpenCode session ID
- Thread agent routing
- Last activity timestamp

### /restart
Kills and respawns the child process. Useful when:
- Bot is unresponsive
- WeChat credentials need refresh
- OpenCode server state is suspect

### /reset
Resets the current thread's session and history. Does NOT restart the bot.

## Getting help

If you're stuck, gather:
1. `~/.opencode-remote/bot-YYYY-MM-DD.log` (latest log)
2. `~/.opencode-remote/state/state.json` (state at time of issue)
3. Output of `/diagnose`
4. Steps to reproduce

The logs contain timestamps, error messages, and stack traces that will help diagnose the issue.