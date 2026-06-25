#!/usr/bin/env node
// OpenCode Remote Control - CLI entry point
// @ts-nocheck — process.env spread has type issues with strict @types/node
import { watch, existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { setGlobalProxy } from './opencode/client.js';
import { printBanner, VERSION, runConfig, runConfigTimeout } from './core/setup.js';
import { runStart, runTelegramOnly, runFeishuOnly, runWeixinOnly, runAgentsCommand } from './bot-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function printHelp() {
    console.log(`
Usage: opencode-remote [command]

Commands:
  start              Start all configured bots (default)
  telegram           Start Telegram bot only
  feishu             Start Feishu bot only
  weixin             Start Weixin (微信) bot only
  config             Configure a channel (interactive selection)
  config timeout     Set request timeout (for long-running tasks)
  agents             List available AI agents
  help               Show this help message
  version            Show version information

Options:
  -v, --version      Show version number
  --proxy <url>      Use HTTP/HTTPS proxy for all requests
                     (e.g., --proxy http://192.168.1.100:7890)
  --id <name>        Instance ID for multi-bot support
                     (e.g., --id bot1, --id bot2)

Proxy Configuration:
  You can also set proxy via environment variables:
    HTTP_PROXY, HTTPS_PROXY, ALL_PROXY

Multi-Bot Support:
  Run multiple Weixin bots with different accounts:
    opencode-remote weixin --id bot1   # First Weixin account
    opencode-remote weixin --id bot2   # Second Weixin account

  Each instance has its own credentials and sessions.

Weixin Bot Commands (send in WeChat):
  /start — Claim ownership
  /help — Show all commands
  /reset — Reset session
  /restart — Restart bot
  /diagnose — System diagnostics
  /model — Switch AI model

Multi-Agent Commands:
  /oc <prompt> — Use OpenCode (default)
  /cc <prompt> — Use Claude Code
  /cx <prompt> — Use Codex
  /copilot <prompt> — Use GitHub Copilot

Examples:
  opencode-remote              # Start all bots
  opencode-remote start        # Start all bots
  opencode-remote telegram     # Start Telegram only
  opencode-remote feishu       # Start Feishu only
  opencode-remote weixin       # Start Weixin only
  opencode-remote weixin --id bot1   # Start Weixin bot1
  opencode-remote weixin --id bot2   # Start Weixin bot2
  opencode-remote config       # Interactive channel selection
  opencode-remote config timeout  # Set request timeout
  opencode-remote --version    # Show version
  opencode-remote --proxy http://192.168.1.100:7890  # With proxy
`);
}

// Main CLI
// 父进程管理：如果不是子进程，则启动父进程模式
if (process.env.OPENCODE_CHILD !== '1') {
    process.on('unhandledRejection', (reason) => { console.error('[parent] Unhandled Rejection:', reason); });

    // PID 文件锁：确保只有一个父进程实例
    const PID_FILE = join(homedir(), '.opencode-remote', 'parent.pid');
    try {
        if (existsSync(PID_FILE)) {
            const oldPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
            if (oldPid && oldPid !== process.pid) {
                try { process.kill(oldPid, 'SIGTERM'); } catch { console.debug('[pid] old process already dead'); }
                try { execSync(`taskkill /F /T /PID ${oldPid}`, { timeout: 2000 }); } catch { console.debug('[pid] taskkill failed'); }
            }
        }
    } catch (e) { console.debug('[pid] Failed to read PID file:', e.message); }
    try { writeFileSync(PID_FILE, String(process.pid), 'utf8'); } catch (e) { console.debug('[pid] Failed to write PID file:', e.message); }
    process.on('exit', () => { try { unlinkSync(PID_FILE); } catch {} });

    let childProc = null;
    let shuttingDown = false;
    let isRestart = false;
    let crashCount = 0;
    let lastCrashTs = 0;
    let lastSpawnTs = 0;
    let lastHeartbeatTs = Date.now();
    let heartbeatCheckTimer = null;

    function cleanupPorts() {
        for (const port of [4096, 4097, 4098]) {
            try {
                const out = execSync(`netstat -ano | findstr ":${port} "`, { timeout: 3000 });
                for (const line of out.toString().trim().split('\n')) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && pid !== '0') {
                        try { execSync(`taskkill /F /PID ${pid}`, { timeout: 2000 }); } catch { console.debug('[cleanup] kill failed (already dead?)', pid); }
                    }
                }
            } catch { console.debug('[cleanup] no process on port', port); }
        }
    }

    const spawnChild = (fromRestart = false) => {
        cleanupPorts();
        lastSpawnTs = Date.now();
        if (shuttingDown) return;
        if (childProc) {
            try { childProc.kill('SIGTERM'); } catch {}
        }

        const args = process.argv.slice(2);
        const childEnv = { ...process.env, OPENCODE_CHILD: '1' };
        if (fromRestart) {
            childEnv.OPENCODE_RESTART = '1';
        }
        childProc = spawn('node', [process.argv[1], ...args], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            env: childEnv,
            windowsHide: true,
        });

        childProc.stdout.on('data', (d) => process.stdout.write(d));
        childProc.stderr.on('data', (d) => process.stderr.write(d));

        childProc.on('close', (code) => {
            const wasSignal = code === null;
            console.log(`[parent] Child process closed with code: ${code}${wasSignal ? ' (signal)' : ''}`);
            if (shuttingDown) {
                console.log('[parent] Shutting down, not restarting');
                return;
            }

            // 区分：200=主动重启请求, null=信号杀, 其他=异常退出
            if (code === 200) {
                // 主动 /restart
                isRestart = true;
                setTimeout(() => spawnChild(true), 1000);
                return;
            }

            // 崩溃检测: 60 秒内连续多次崩溃 → 不再重启 (避免崩循环)
            const now = Date.now();
            if (now - lastCrashTs < 60_000) {
                crashCount++;
            } else {
                crashCount = 1;
            }
            lastCrashTs = now;

            if (crashCount >= 5) {
                console.error(`[parent] ${crashCount} crashes in 60s, giving up. Manual restart required.`);
                process.exit(1);
            }

            // 退避重启: 1s, 2s, 4s, 8s
            const backoff = Math.min(8000, 1000 * Math.pow(2, crashCount - 1));
            console.log(`[parent] Bot ${wasSignal ? 'killed by signal' : `crashed (code ${code})`}, restarting in ${backoff}ms (crash #${crashCount})`);
            isRestart = true;
            setTimeout(() => spawnChild(true), backoff);
        });

        childProc.on('error', (err) => {
            console.error('[parent] Child error:', err.message);
        });

        // IPC 心跳：子进程每 30s 发心跳，超过 120s 无心跳视为卡死
        childProc.on('message', (msg) => {
            if (msg?.type === 'heartbeat') lastHeartbeatTs = Date.now();
        });
        lastHeartbeatTs = Date.now();
        clearInterval(heartbeatCheckTimer);
        heartbeatCheckTimer = setInterval(() => {
            if (shuttingDown) return;
            if (Date.now() - lastHeartbeatTs > 120_000) {
                console.error('[parent] No heartbeat for 120s, killing stuck child...');
                isRestart = true;
                try { childProc.kill('SIGKILL'); } catch {}
            }
        }, 30_000);
        if (heartbeatCheckTimer.unref) heartbeatCheckTimer.unref();
    };

    // 文件监控 - 代码变化时自动重启 (spawn 后 3s 静默, 避免重启循环)
    const distDir = __dirname;
    let debounceTimer = null;
    watch(distDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith('.js') && !shuttingDown && Date.now() - lastSpawnTs > 3000) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                console.log(`\n📝 ${filename} changed, restarting...`);
                if (childProc) {
                    isRestart = true;
                    childProc.kill('SIGTERM');
                }
            }, 500);
        }
    });

    process.on('SIGINT', () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('\nShutting down...');
        if (childProc) childProc.kill('SIGTERM');
        setTimeout(() => process.exit(0), 1000);
    });

    process.on('SIGTERM', () => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (childProc) childProc.kill('SIGTERM');
        setTimeout(() => process.exit(0), 1000);
    });

    spawnChild();
} else {
    runCli();
}

function runCli() {
    const args = process.argv.slice(2);
    let proxyUrl = null;
    let instanceId = null;
    let command = 'start';
    let subCommand = null;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--proxy') {
            proxyUrl = args[++i];
            if (!proxyUrl) {
                console.error('Error: --proxy requires a URL argument');
                process.exit(1);
            }
        }
        else if (arg.startsWith('--proxy=')) {
            proxyUrl = arg.slice('--proxy='.length);
        }
        else if (arg === '--id') {
            instanceId = args[++i];
            if (!instanceId) {
                console.error('Error: --id requires an argument');
                process.exit(1);
            }
        }
        else if (arg.startsWith('--id=')) {
            instanceId = arg.slice('--id='.length);
        }
        else if (arg === '--version' || arg === '-v') {
            command = 'version';
        }
        else if (arg === '--help' || arg === '-h') {
            command = 'help';
        }
        else if (!arg.startsWith('-')) {
            if (command === 'start') {
                command = arg;
            }
            else if (command === 'config' && !subCommand) {
                subCommand = arg;
            }
        }
    }
    if (instanceId) {
        process.env.OPENCODE_INSTANCE_ID = instanceId;
    }
    if (proxyUrl) {
        setGlobalProxy(proxyUrl);
    }
    if (command === 'config' && subCommand === 'timeout') {
        runConfigTimeout();
        process.exit(0);
    }
    switch (command) {
        case 'start':
            runStart();
            break;
        case 'telegram':
            runTelegramOnly();
            break;
        case 'feishu':
            runFeishuOnly();
            break;
        case 'weixin':
            runWeixinOnly();
            break;
        case 'config':
            runConfig();
            break;
        case 'help':
        case '--help':
        case '-h':
            printBanner();
            printHelp();
            break;
        case 'version':
        case '--version':
        case '-v':
            console.log(`opencode-remote v${VERSION}`);
            break;
        case 'agents':
            runAgentsCommand();
            break;
        default:
            console.log(`Unknown command: ${command}`);
            printHelp();
            process.exit(1);
    }
}
