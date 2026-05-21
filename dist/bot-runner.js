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

export async function runInitMemory() {
    const projectRoot = process.cwd();
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🧠 Initialize Memory System');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  Project: ${projectRoot}`);
    console.log('');

    const agentsPath = join(projectRoot, 'AGENTS.md');
    const memoryPath = join(projectRoot, 'MEMORY.md');
    const memoryDir = join(projectRoot, 'memory');
    const dailyLogsDir = join(projectRoot, 'daily-logs');

    if (!existsSync(agentsPath)) {
        const agentsContent = `# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

## 技术栈
<!-- 填写项目技术栈 -->

## 关键命令
<!-- 填写构建/测试/运行命令 -->

## 代码规范
<!-- 填写代码规范 -->
`;
        writeFileSync(agentsPath, agentsContent, 'utf-8');
        console.log('  ✅ Created AGENTS.md');
    } else {
        const existing = readFileSync(agentsPath, 'utf-8');
        if (!existing.includes('MEMORY.md')) {
            const updated = `# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

` + existing;
            writeFileSync(agentsPath, updated, 'utf-8');
            console.log('  ✅ Updated AGENTS.md (added memory reference)');
        } else {
            console.log('  ⏭️  AGENTS.md already references MEMORY.md');
        }
    }

    if (!existsSync(memoryPath)) {
        const memoryContent = `# MEMORY.md — 项目记忆

> 本文件是项目的持久化记忆索引，供 AI 编码代理在每次会话开始时加载。
> 格式：\`- [日期] 教训/决策/模式\`（每行一条，日期戳用于轮转）
> 硬限制：200行，超出部分不可见

## 架构决策

<!-- 格式：- [YYYY-MM-DD] 决策内容 -->

## 编码规范

<!-- 格式：- [YYYY-MM-DD] 规范内容 -->

## 经验教训

<!-- 格式：- [YYYY-MM-DD] 教训内容 -->

## 最近会话摘要

<!-- 每次 /flush 时在此追加一行摘要，格式：- [YYYY-MM-DD] 简要总结 -->

## 主题文件路由表

> 当涉及以下领域时，读取对应的 memory/ 主题文件

| 触发关键词 | 主题文件 | 说明 |
|-----------|----------|------|
| 核心逻辑 | \`memory/core-logic.md\` | 核心业务逻辑 |
| 调试经验 | \`memory/debugging.md\` | 调试经验、常见 bug |

## 开放线程

<!-- /flush 时更新当前未完成的 work item -->
`;
        writeFileSync(memoryPath, memoryContent, 'utf-8');
        console.log('  ✅ Created MEMORY.md');
    } else {
        console.log('  ⏭️  MEMORY.md already exists');
    }

    if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
        const defaultTopics = {
            'core-logic.md': `# 核心逻辑记忆

> 触发词：核心、core、业务逻辑

## 架构决策

<!-- 格式：- [YYYY-MM-DD] 决策内容 -->

## 经验教训

<!-- 格式：- [YYYY-MM-DD] 教训内容 -->
`,
            'debugging.md': `# 调试经验记忆

> 触发词：调试、debug、bug、错误、error

## 常见问题

<!-- 格式：- [YYYY-MM-DD] 问题描述和解决方案 -->

## 经验教训

<!-- 格式：- [YYYY-MM-DD] 教训内容 -->
`
        };
        for (const [filename, content] of Object.entries(defaultTopics)) {
            writeFileSync(join(memoryDir, filename), content, 'utf-8');
        }
        console.log('  ✅ Created memory/ directory with 2 topic files');
    } else {
        console.log('  ⏭️  memory/ directory already exists');
    }

    if (!existsSync(dailyLogsDir)) {
        mkdirSync(dailyLogsDir, { recursive: true });
        console.log('  ✅ Created daily-logs/ directory');
    } else {
        console.log('  ⏭️  daily-logs/ directory already exists');
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅ Memory system initialized!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Usage:');
    console.log('  • Open this project in opencode');
    console.log('  • AI will automatically load MEMORY.md via AGENTS.md');
    console.log('  • During work: append lessons to memory files');
    console.log('  • End of session (/flush): update summaries');
    console.log('');
    console.log('  File structure:');
    console.log('  ├── AGENTS.md          (project instructions)');
    console.log('  ├── MEMORY.md          (memory index)');
    console.log('  ├── memory/            (topic files)');
    console.log('  └── daily-logs/        (daily logs)');
    console.log('');
}
