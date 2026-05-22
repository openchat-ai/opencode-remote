#!/usr/bin/env node
// OpenCode Remote Control - CLI entry point
import { watch } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
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
  /status — Check connection
  /stop — Interrupt task
  /reset — Reset session
  /restart — Restart bot
  /sessions — Browse sessions
  /delsessions — Delete sessions
  /loop — Loop task
  /refresh — Refresh context
  /copy — Copy latest reply
  /revert — Undo last message
  /upload — Upload build artifacts
  /model — Switch AI model

Multi-Agent Commands:
  /oc <prompt> — Use OpenCode (default)
  /cc <prompt> — Use Claude Code
  /cx <prompt> — Use Codex
  /copilot <prompt> — Use GitHub Copilot
  /agents — List all available agents

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
    let childProc = null;
    let shuttingDown = false;
    let isRestart = false;

    const spawnChild = (fromRestart = false) => {
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
            console.log(`[parent] Child process closed with code: ${code}`);
            if (shuttingDown) {
                console.log('[parent] Shutting down, not restarting');
                return;
            }
            if (code === 200 || code === null) {
                console.log(`\n🔄 Bot exited (code ${code}), restarting...`);
                isRestart = true;
                setTimeout(() => spawnChild(true), 1000);
            } else {
                console.log(`[parent] Bot exited with code ${code}, not restarting`);
            }
        });

        childProc.on('error', (err) => {
            console.error('[parent] Child error:', err.message);
        });
    };

    // 文件监控 - 代码变化时自动重启
    const distDir = __dirname;
    let debounceTimer = null;
    watch(distDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith('.js') && !shuttingDown) {
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
