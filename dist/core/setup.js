// OpenCode Remote Control - Setup/Config module
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadWeixinCredentials } from '../weixin/bot.js';

const CONFIG_DIR = join(homedir(), '.opencode-remote');
const CONFIG_FILE = join(CONFIG_DIR, '.env');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const VERSION = packageJson.version;

export { VERSION };

export function printBanner() {
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OpenCode Remote Control v${VERSION}
  Control OpenCode from Telegram, Feishu, or WeChat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

export async function promptChannel() {
    console.log('\n📝 Select a channel to configure:');
    console.log('');
    console.log('  1. Telegram');
    console.log('  2. Feishu (飞书)');
    console.log('  3. Weixin (微信)');
    console.log('');
    process.stdout.write('Enter your choice (1, 2 or 3): ');
    const choice = await new Promise((resolve) => {
        process.stdin.setEncoding('utf8');
        const cleanup = () => {
            process.stdin.pause();
            process.removeListener('SIGINT', onSigint);
        };
        const onSigint = () => {
            cleanup();
            console.log('\nCancelled');
            process.exit(0);
        };
        process.once('SIGINT', onSigint);
        process.stdin.once('data', (chunk) => {
            cleanup();
            resolve(chunk.toString().trim());
        });
    });
    if (choice === '1' || choice.toLowerCase() === 'telegram') {
        return 'telegram';
    }
    else if (choice === '2' || choice.toLowerCase() === 'feishu') {
        return 'feishu';
    }
    else if (choice === '3' || choice.toLowerCase() === 'weixin' || choice.toLowerCase() === '微信') {
        return 'weixin';
    }
    console.log('Invalid choice, defaulting to Telegram');
    return 'telegram';
}

export async function promptToken() {
    console.log('\n📝 Setup required: Telegram Bot Token');
    console.log('\nHow to get a token:');
    console.log('  1. Open Telegram');
    console.log('  2. Search @BotFather');
    console.log('  3. Send /newbot and follow instructions');
    console.log('  4. Copy the token you receive');
    console.log('');
    process.stdout.write('Enter your bot token: ');
    const token = await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const cleanup = () => {
            process.stdin.pause();
            process.removeListener('SIGINT', onSigint);
        };
        const onSigint = () => {
            cleanup();
            console.log('\nCancelled');
            process.exit(0);
        };
        process.once('SIGINT', onSigint);
        process.stdin.once('data', (chunk) => {
            cleanup();
            resolve(chunk.toString().trim());
        });
    });
    if (!token) {
        console.log('\nCancelled');
        process.exit(0);
    }
    return token;
}

export async function promptFeishuConfig() {
    let existingAppId = '';
    let existingAppSecret = '';
    if (existsSync(CONFIG_FILE)) {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        const appIdMatch = content.match(/FEISHU_APP_ID=(.+)/);
        if (appIdMatch)
            existingAppId = appIdMatch[1].trim();
        const appSecretMatch = content.match(/FEISHU_APP_SECRET=(.+)/);
        if (appSecretMatch)
            existingAppSecret = appSecretMatch[1].trim();
    }
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📁 Config file: ' + CONFIG_FILE);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📝 Step 1: Create Feishu App');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  1. Go to https://open.feishu.cn/app');
    console.log('  2. Click "创建企业自建应用" (Create enterprise app)');
    console.log('  3. Fill in app name and description');
    console.log('  4. Go to "凭证与基础信息" (Credentials) page');
    console.log('');
    console.log('⚠️  Important: In "事件订阅" (Event Subscription),');
    console.log('   select "使用长连接接收事件" (Use long connection to receive events)');
    console.log('   This allows the bot to work without ngrok/cloudflared!');
    console.log('');
    const promptInput = async (promptText, defaultValue) => {
        if (defaultValue) {
            const masked = defaultValue.length > 8
                ? defaultValue.slice(0, 4) + '****' + defaultValue.slice(-4)
                : '****';
            process.stdout.write(`${promptText} [current: ${masked}]: `);
        }
        else {
            process.stdout.write(promptText);
        }
        return new Promise((resolve) => {
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            const cleanup = () => {
                process.stdin.pause();
                process.removeListener('SIGINT', onSigint);
            };
            const onSigint = () => {
                cleanup();
                console.log('\nCancelled');
                process.exit(0);
            };
            process.once('SIGINT', onSigint);
            process.stdin.once('data', (chunk) => {
                cleanup();
                const input = chunk.toString().trim();
                resolve(input || defaultValue);
            });
        });
    };
    const appId = await promptInput('Enter your App ID', existingAppId);
    if (!appId) {
        console.log('\n❌ App ID is required. Press Ctrl+C to cancel.');
        process.exit(0);
    }
    const appSecret = await promptInput('Enter your App Secret', existingAppSecret);
    if (!appSecret) {
        console.log('\n❌ App Secret is required. Press Ctrl+C to cancel.');
        process.exit(0);
    }
    return { appId, appSecret };
}

export function showFeishuSetupGuide() {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📋 Step 2: Configure App Permissions');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Go to: 权限管理 → API权限');
    console.log('');
    console.log('  Click "批量添加" (Batch Add) and paste this JSON:');
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────┐');
    console.log('  │                                                    │');
    console.log('  │   {                                                │');
    console.log('  │     "im:message",                                  │');
    console.log('  │     "im:message:send_as_bot",                      │');
    console.log('  │     "im:message:receive_as_bot"                    │');
    console.log('  │   }                                                │');
    console.log('  │                                                    │');
    console.log('  └────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  📋 Or add manually:');
    console.log('     • im:message              - 获取与发送消息');
    console.log('     • im:message:send_as_bot  - 以应用身份发消息');
    console.log('     • im:message:receive_as_bot - 接收机器人消息');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🤖 Step 3: Enable Robot Capability');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Go to: 应用能力 → 机器人');
    console.log('');
    console.log('  Enable these options:');
    console.log('     ☑️  启用机器人');
    console.log('     ☑️  机器人可主动发送消息给用户');
    console.log('     ☑️  用户可与机器人进行单聊');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🚀 Step 4: Start the Bot FIRST! (CRITICAL)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  ⚠️  You MUST start the bot BEFORE configuring event subscription!');
    console.log('');
    console.log('  Run in another terminal:');
    console.log('');
    console.log('       opencode-remote feishu');
    console.log('');
    console.log('  Wait for: "ws client ready" (WebSocket connected)');
    console.log('');
    console.log('  ✨ Long Connection Mode = NO ngrok/cloudflared needed!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔗 Step 5: Configure Event Subscription');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  (Make sure the bot is running! If not, start it first)');
    console.log('');
    console.log('  1. Go to "事件订阅" (Event Subscription) page');
    console.log('  2. 订阅方式: 选择 "使用长连接接收事件"');
    console.log('     (NOT "将事件发送至开发者服务器"!)');
    console.log('  3. Click "添加事件" and select:');
    console.log('     - im.message.receive_v1 (接收消息)');
    console.log('  4. Save configuration');
    console.log('');
    console.log('  ❌ If you see "未检测到应用连接信息":');
    console.log('     → The bot is not running. Start it first!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📤 Step 6: Publish App');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  1. Go to "版本管理与发布" (Version & Publish)');
    console.log('  2. Click "创建版本" (Create Version)');
    console.log('  3. Fill in version info and submit for review');
    console.log('  4. After approval, click "发布" (Publish)');
    console.log('  5. Search your bot in Feishu and start chatting!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

export async function saveConfig(token) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
    let existing = '';
    if (existsSync(CONFIG_FILE)) {
        existing = readFileSync(CONFIG_FILE, 'utf-8');
    }
    const lines = existing.split('\n').filter(line => !line.startsWith('TELEGRAM_BOT_TOKEN='));
    lines.push(`TELEGRAM_BOT_TOKEN=${token}`);
    writeFileSync(CONFIG_FILE, lines.join('\n'));
    console.log(`\n✅ Token saved to ${CONFIG_FILE}`);
}

export async function saveFeishuConfig(appId, appSecret) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
    let existing = '';
    if (existsSync(CONFIG_FILE)) {
        existing = readFileSync(CONFIG_FILE, 'utf-8');
    }
    const lines = existing.split('\n').filter(line => !line.startsWith('FEISHU_APP_ID=') &&
        !line.startsWith('FEISHU_APP_SECRET='));
    lines.push(`FEISHU_APP_ID=${appId}`);
    lines.push(`FEISHU_APP_SECRET=${appSecret}`);
    writeFileSync(CONFIG_FILE, lines.join('\n'));
    console.log(`\n✅ Feishu config saved to ${CONFIG_FILE}`);
    showFeishuSetupGuide();
}

export function getCurrentTimeout() {
    if (existsSync(CONFIG_FILE)) {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        const match = content.match(/OPENCODE_REQUEST_TIMEOUT_MINUTES=(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
    }
    return 30;
}

export async function saveTimeoutConfig(timeoutMinutes) {
    if (!existsSync(CONFIG_DIR)) {
        mkdirSync(CONFIG_DIR, { recursive: true });
    }
    let existing = '';
    if (existsSync(CONFIG_FILE)) {
        existing = readFileSync(CONFIG_FILE, 'utf-8');
    }
    const lines = existing.split('\n').filter(line => !line.startsWith('OPENCODE_REQUEST_TIMEOUT_MINUTES='));
    lines.push(`OPENCODE_REQUEST_TIMEOUT_MINUTES=${timeoutMinutes}`);
    writeFileSync(CONFIG_FILE, lines.join('\n'));
    console.log(`\n✅ Timeout saved: ${timeoutMinutes} minutes`);
}

export async function runConfigTimeout() {
    printBanner();
    const currentTimeout = getCurrentTimeout();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ⏱️  Request Timeout Configuration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  This sets how long to wait for OpenCode responses.');
    console.log('  Increase this if you get "fetch failed" errors for long tasks.');
    console.log('');
    console.log(`  Current timeout: ${currentTimeout} minutes`);
    console.log('');
    console.log('  Recommended values:');
    console.log('    • 30 minutes  (default, good for most tasks)');
    console.log('    • 60 minutes  (for complex refactoring)');
    console.log('    • 120 minutes (for large projects)');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    process.stdout.write('Enter timeout in minutes (or press Enter to keep current): ');
    const input = await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const cleanup = () => {
            process.stdin.pause();
            process.removeListener('SIGINT', onSigint);
        };
        const onSigint = () => {
            cleanup();
            console.log('\nCancelled');
            process.exit(0);
        };
        process.once('SIGINT', onSigint);
        process.stdin.once('data', (chunk) => {
            cleanup();
            resolve(chunk.toString().trim());
        });
    });
    if (!input) {
        console.log('\n⏭️  No change made.');
        process.exit(0);
    }
    const timeout = parseInt(input, 10);
    if (isNaN(timeout) || timeout < 1) {
        console.log('\n❌ Invalid number. Please enter a positive number.');
        process.exit(1);
    }
    if (timeout > 480) {
        console.log('\n⚠️  Warning: Timeout exceeds 8 hours. Are you sure?');
    }
    await saveTimeoutConfig(timeout);
    console.log('\n🚀 Restart opencode-remote for the change to take effect.');
    process.exit(0);
}

export async function runConfig() {
    printBanner();
    const channel = await promptChannel();
    if (channel === 'telegram') {
        const token = await promptToken();
        if (!token || token === 'your_bot_token_here') {
            console.log('\n❌ Invalid token. Please try again.');
            process.exit(1);
        }
        await saveConfig(token);
        console.log('\n🚀 Ready! Run `opencode-remote` to start the bot.');
    }
    else if (channel === 'feishu') {
        const { appId, appSecret } = await promptFeishuConfig();
        if (!appId || !appSecret) {
            console.log('\n❌ Invalid credentials. Please try again.');
            process.exit(1);
        }
        await saveFeishuConfig(appId, appSecret);
        console.log('\n🚀 Ready! Run `opencode-remote feishu` to start the Feishu bot.');
    }
    else if (channel === 'weixin') {
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  📱 Weixin (微信) Login');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('  Weixin bot uses QR code login.');
        console.log('  No manual configuration needed!');
        console.log('');
        console.log('  To set up Weixin:');
        console.log('');
        console.log('  1. Run: opencode-remote weixin');
        console.log('  2. Scan the QR code with your WeChat app');
        console.log('  3. Confirm login on your phone');
        console.log('');
        console.log('  Credentials will be saved automatically.');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('🚀 Run `opencode-remote weixin` to start the login process.');
    }
    process.exit(0);
}

export function hasTelegramConfig(config) {
    return !!(config.telegramBotToken?.trim());
}

export function hasFeishuConfig(config) {
    return !!(config.feishuAppId?.trim() &&
        config.feishuAppSecret?.trim());
}

export function hasWeixinConfig() {
    const creds = loadWeixinCredentials();
    return !!(creds?.token && creds?.accountId);
}
