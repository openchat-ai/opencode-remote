// OpenCode Remote Control - Bot runner module
import { loadConfig } from './core/config.js';
import { hasTelegramConfig, hasFeishuConfig, hasWeixinConfig, printBanner } from './core/setup.js';
import { startBot } from './telegram/bot.js';
import { startFeishuBot } from './feishu/bot.js';
import { startWeixinBot } from './weixin/bot.js';
import { registry } from './core/registry.js';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export function createShutdownHandler() {
    let isShuttingDown = false;
    return () => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        console.log('\n🛑 Shutting down...');
        setTimeout(() => {
            console.log('Goodbye!');
            process.exit(0);
        }, 1000);
    };
}

export async function runAgentsCommand() {
    printBanner();
    console.log('🤖 Available Agents\n');

    await registry.loadBuiltInPlugins();

    const agents = registry.listAgents();

    if (agents.length === 0) {
        console.log('No agents registered yet.');
        console.log('');
        console.log('Install an agent to get started:');
        console.log('  • OpenCode: npm i -g opencode-ai');
        console.log('  • Claude Code: npm i -g @anthropic-ai/claude-code');
        console.log('  • Codex: npm i -g @openai/codex');
        console.log('  • Copilot: gh extension install github/gh-copilot');
        return;
    }

    console.log('Checking agent availability...\n');

    const results = await Promise.allSettled(agents.map(async (name) => {
        const agent = registry.getAgent(name);
        const available = await agent?.isAvailable().catch(() => false);
        return { name, available, aliases: agent?.aliases || [] };
    }));

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const { name, available, aliases } = result.value;
            const aliasStr = aliases.length ? ` (${aliases.join(', ')})` : '';
            console.log(`  ${available ? '✅' : '❌'} ${name}${aliasStr}`);
        }
    }

    console.log('\nUse /<agent> in chat to switch agents.');
    console.log('Example: /cc to switch to Claude Code');
}

export async function runStart() {
    const config = await loadConfig();
    const hasTelegram = hasTelegramConfig(config);
    const hasFeishu = hasFeishuConfig(config);
    const hasWeixin = hasWeixinConfig();
    if (!hasTelegram && !hasFeishu && !hasWeixin) {
        console.log('❌ No bots configured!');
        console.log('\nRun: opencode-remote config');
        process.exit(1);
    }

    let shuttingDown = false;
    const childProcs = [];

    if (hasWeixin) {
        runWeixinOnly();
        return;
    }

    const promises = [];
    if (hasTelegram) {
        console.log('🤖 Starting Telegram bot...');
        process.env.TELEGRAM_BOT_TOKEN = config.telegramBotToken;
        promises.push(startBot().catch((err) => {
            console.error('Telegram bot failed:', err);
            return { status: 'rejected', reason: err };
        }));
    }
    if (hasFeishu) {
        console.log('🤖 Starting Feishu bot...');
        promises.push(startFeishuBot(config).catch((err) => {
            console.error('Feishu bot failed:', err);
            return { status: 'rejected', reason: err };
        }));
    }

    if (promises.length > 0) {
        const results = await Promise.allSettled(promises);
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
            console.log(`\n⚠️ ${failed.length} bot(s) failed to start`);
            process.exit(1);
        }
    }

    if (!hasWeixin) {
        console.log('\n✅ All bots started!');
    }

    process.once('SIGINT', () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('\n🛑 Shutting down...');
        for (const p of childProcs) { try { p.kill('SIGTERM'); } catch {} }
        setTimeout(() => process.exit(0), 2000);
    });
    process.once('SIGTERM', () => {
        if (shuttingDown) return;
        shuttingDown = true;
        for (const p of childProcs) { try { p.kill('SIGTERM'); } catch {} }
        setTimeout(() => process.exit(0), 2000);
    });

    await new Promise(() => {});
}

export async function runTelegramOnly() {
    const config = await loadConfig();
    if (!hasTelegramConfig(config)) {
        console.log('❌ Telegram bot not configured!');
        console.log('\nRun: opencode-remote config');
        process.exit(1);
    }
    printBanner();
    console.log('🤖 Starting Telegram bot...');
    process.env.TELEGRAM_BOT_TOKEN = config.telegramBotToken;
    try {
        await startBot();
    }
    catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
    }
}

export async function runFeishuOnly() {
    const config = await loadConfig();
    if (!hasFeishuConfig(config)) {
        console.log('❌ Feishu bot not configured!');
        console.log('\nRun: opencode-remote config');
        process.exit(1);
    }
    printBanner();
    console.log('🤖 Starting Feishu bot...');
    try {
        await startFeishuBot(config);
    }
    catch (error) {
        console.error('Failed to start:', error);
        process.exit(1);
    }
}

export async function runWeixinOnly() {
    const config = await loadConfig();
    printBanner();
    console.log('🤖 Starting Weixin bot...');
    try {
        await startWeixinBot(config);
    }
    catch (error) {
        console.error('Bot error:', error.message);
        process.exit(1);
    }
}


