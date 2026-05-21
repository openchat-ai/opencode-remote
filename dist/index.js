// OpenChat - Main entry point
import './patch_spawn.js';
import { startBot } from './telegram/bot.js';
import { startFeishuBot } from './feishu/bot.js';
import { startWeixinBot } from './weixin/bot.js';
import { setGlobalProxy } from './opencode/client.js';
import { loadWeixinCredentials } from './weixin/bot.js';
import { registry } from './core/registry.js';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { loadConfig } from './core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export { startBot, startFeishuBot, startWeixinBot, setGlobalProxy, loadWeixinCredentials, registry };

export function startAllBots(options = {}) {
    const { telegram = true, feishu = true, weixin = true } = options;
    const config = loadConfig();
    
    // Only start bots that have their credentials configured
    if (telegram && config.telegramBotToken && config.telegramBotToken !== 'your_bot_token_here') {
        // Telegram bot loads config internally, so don't pass it
        startBot().catch(console.error);
    }
    if (feishu && config.feishuAppId && config.feishuAppSecret) {
        startFeishuBot(config).catch(console.error);
    }
    if (weixin && config.weixinToken) {
        startWeixinBot(config).catch(console.error);
    }
}

const CONFIG_DIR = join(homedir(), '.opencode-remote');
const CONFIG_FILE = join(CONFIG_DIR, '.env');

if (existsSync(CONFIG_FILE)) {
    const config = readFileSync(CONFIG_FILE, 'utf-8');
    const proxyMatch = config.match(/^PROXY=(.+)$/m);
    if (proxyMatch) {
        setGlobalProxy(proxyMatch[1]);
    }
}

startAllBots();
