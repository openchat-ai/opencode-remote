# Configuration

All configuration via environment variables or `~/.opencode-remote/.env`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_TIMEOUT` | `180` | Per-request timeout in **seconds** for OpenCode SDK. Long-running agents may need higher values. |
| `OPENCODE_REQUEST_TIMEOUT_MINUTES` | `30` | HTTP request timeout for global HTTP dispatcher. Affects all fetch calls. |
| `OPENCODE_KEEP_ALIVE_SECONDS` | `60` | Keep-alive timeout for HTTP connections. |
| `OPENCODE_CHILD` | (set by parent) | When `1`, indicates child process mode (suppresses parent supervision). |
| `OPENCODE_RESTART` | (set by parent) | When `1`, child is restarting (loads `.restart_user.json` for notification). |
| `OPENCODE_INSTANCE_ID` | `default` | For multi-bot support (e.g., `--id bot1`, `--id bot2`). |
| `DEBUG_RAW` | `0` | Set to `1` to log raw OpenCode SDK responses to console. |
| `HTTP_PROXY` / `HTTPS_PROXY` | (none) | Proxy URL for outbound HTTP/HTTPS. See `dist/opencode/client.js` `getProxyUrl()`. |
| `SHARE_SESSIONS` | `false` | When `true`, auto-share OpenCode sessions via share URL. |
| `HOME` | (system) | Used for state directory location. On Windows, defaults to `USERPROFILE`. |

## Config file: `~/.opencode-remote/.env`

Format: `KEY=VALUE` (one per line, no quotes).

Example:
```bash
OPENCODE_TIMEOUT=600
OPENCODE_REQUEST_TIMEOUT_MINUTES=60
DEBUG_RAW=0
```

Only specific keys are read; see `dist/opencode/client.js` `readTimeoutFromConfig()`.

## Path configuration

State and logs are stored under `~/.opencode-remote/`:

```
~/.opencode-remote/
├── parent.pid              # Parent process PID (lock)
├── .env                    # User config (optional)
├── state/
│   ├── state.json          # Current state
│   ├── state.json.bak      # Backup (atomic write)
│   └── state.json.tmp      # In-progress write
├── logs/
│   └── bot-YYYY-MM-DD.log  # Daily rotating logs (5MB, 7-day retention)
├── weixin/
│   ├── credentials.json    # Legacy single-bot credentials
│   └── credentials/
│       └── credentials-<accountId>.json   # Per-bot encrypted credentials
└── memory/                 # Reserved for future use
```

**On Windows**, `~` resolves to `%USERPROFILE%` (usually `C:\Users\<username>`).

## Port allocation

| Port | Service |
|------|---------|
| 4096 | OpenCode SDK server (preferred) |
| 4097 | OpenCode SDK server (fallback) |
| 4098 | OpenCode SDK server (fallback) |

The bot tries ports in order 4096 → 4097 → 4098. Before each spawn, it kills any process on these ports via `cleanupPorts()` (netstat + taskkill).

## Command aliases

To add a new command, modify these three files:

1. `dist/core/router.js` — add to `COMMAND_ALIASES`
2. `dist/core/router.js` — add to `COMMAND_HELP` and `getHelpText()` groups
3. `dist/weixin/commands.js` — add `case 'yourcommand':` to switch

For Telegram/Feishu, also add to their respective files.

## Multi-bot setup

Run multiple instances with different IDs:
```bash
opencode-remote weixin --id bot1   # Uses credentials-bot1.json
opencode-remote weixin --id bot2   # Uses credentials-bot2.json
```

Each has its own:
- Credentials file
- OpenCode session map (LRU)
- Log file (with instance ID in path)

Note: They share the OpenCode server (port 4096-4098) — the first to start wins.

## HTTP proxy

Set `HTTP_PROXY` or `HTTPS_PROXY`:
```bash
HTTP_PROXY=http://192.168.1.100:7890 npm start
```

Or via CLI flag:
```bash
opencode-remote start --proxy http://192.168.1.100:7890
```

The proxy is applied to all fetch requests (WeChat API + OpenCode SDK) via undici's ProxyAgent.

## Timeouts reference

| Operation | Default | Override |
|-----------|---------|----------|
| OpenCode SDK prompt | 180s | `OPENCODE_TIMEOUT` env |
| HTTP dispatcher | 30min | `OPENCODE_REQUEST_TIMEOUT_MINUTES` |
| WeChat long-poll | 35s | `longPollTimeoutMs` param |
| WeChat API call | 15s | `timeoutMs` param |
| Agent CLI timeout | 600s (env-driven) | `OPENCODE_TIMEOUT` |
| Thread lock cleanup | 10min | (hardcoded) |
| LRU session TTL | 30min | (hardcoded in adapter) |
| IPC heartbeat | 30s send, 120s timeout | (hardcoded in cli.js) |
| Crash backoff | 1s, 2s, 4s, 8s | (hardcoded) |
| State write debounce | 2s | (hardcoded) |
| Log rotation | 5MB, 7-day | (hardcoded in core/log.js) |