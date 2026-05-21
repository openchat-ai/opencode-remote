#!/usr/bin/env node
import { spawn } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '../dist/cli.js');

let childProc = null;
let shuttingDown = false;

function spawnBot() {
    if (shuttingDown) return;
    if (childProc) {
        try { childProc.kill('SIGTERM'); } catch {}
    }

    const args = process.argv.slice(2);

    childProc = spawn('node', [cliPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
    });

    // 转发输出
    childProc.stdout.on('data', (d) => process.stdout.write(d));
    childProc.stderr.on('data', (d) => process.stderr.write(d));

    // 监听退出 - code 0 是正常停止，code 200 是 restart，其他是崩溃
    childProc.on('close', (code) => {
        console.log(`[parent] Child process closed with code: ${code}`);
        if (shuttingDown) {
            console.log('[parent] Shutting down, not restarting');
            return;
        }
        if (code === 200 || code === null) {
            // 200 = restart 命令，其他 null = 崩溃
            console.log(`\n🔄 Bot exited (code ${code}), restarting...`);
            setTimeout(spawnBot, 1000);
        } else {
            console.log(`[parent] Bot exited with code ${code}, not restarting`);
        }
    });
}

// 处理来自子进程的消息
process.on('message', (msg) => {
    if (msg === 'restart') {
        console.log('\n[parent] Received restart signal from child');
        shuttingDown = true;
        if (childProc) {
            childProc.kill('SIGTERM');
        }
        console.log('[parent] Restarting bot...');
        shuttingDown = false;
        setTimeout(spawnBot, 500);
    }
});

// Handle Ctrl+C
process.on('SIGINT', () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');
    if (childProc) childProc.kill('SIGTERM');
    setTimeout(() => process.exit(0), 1000);
});

spawnBot();