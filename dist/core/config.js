// OpenCode Remote Control - canonical config loader
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.opencode-remote');
const CONFIG_FILE = join(CONFIG_DIR, '.env');

export function loadConfig() {
  const config = {
    opencodeServerUrl: 'http://localhost:3000',
    tunnelUrl: '',
    sessionIdleTimeoutMs: 1800000,
    cleanupIntervalMs: 300000,
    approvalTimeoutMs: 300000,
  };

  // 1. Read ~/.opencode-remote/.env
  if (existsSync(CONFIG_FILE)) {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const token = content.match(/TELEGRAM_BOT_TOKEN=(.+)/)?.[1]?.trim();
    if (token && token !== 'your_bot_token_here') config.telegramBotToken = token;

    const appId = content.match(/FEISHU_APP_ID=(.+)/)?.[1]?.trim();
    if (appId) config.feishuAppId = appId;

    const appSecret = content.match(/FEISHU_APP_SECRET=(.+)/)?.[1]?.trim();
    if (appSecret) config.feishuAppSecret = appSecret;
  }

  // 2. Read ./.env (local project, lower priority)
  const localEnv = join(process.cwd(), '.env');
  if (existsSync(localEnv)) {
    const content = readFileSync(localEnv, 'utf-8');

    // Telegram: only if not already set (preserves original behavior)
    if (!config.telegramBotToken) {
      const token = content.match(/TELEGRAM_BOT_TOKEN=(.+)/)?.[1]?.trim();
      if (token && token !== 'your_bot_token_here') config.telegramBotToken = token;
    }

    // Feishu: always fills (preserves original behavior)
    const appId = content.match(/FEISHU_APP_ID=(.+)/)?.[1]?.trim();
    if (appId) config.feishuAppId = appId;

    const appSecret = content.match(/FEISHU_APP_SECRET=(.+)/)?.[1]?.trim();
    if (appSecret) config.feishuAppSecret = appSecret;
  }

  // 3. Env vars override everything
  if (process.env.TELEGRAM_BOT_TOKEN?.trim()) config.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN.trim();
  if (process.env.FEISHU_APP_ID?.trim()) config.feishuAppId = process.env.FEISHU_APP_ID.trim();
  if (process.env.FEISHU_APP_SECRET?.trim()) config.feishuAppSecret = process.env.FEISHU_APP_SECRET.trim();
  if (process.env.OPENCODE_SERVER_URL) config.opencodeServerUrl = process.env.OPENCODE_SERVER_URL;
  if (process.env.TUNNEL_URL) config.tunnelUrl = process.env.TUNNEL_URL;
  if (process.env.SESSION_IDLE_TIMEOUT_MS) config.sessionIdleTimeoutMs = parseInt(process.env.SESSION_IDLE_TIMEOUT_MS, 10);
  if (process.env.CLEANUP_INTERVAL_MS) config.cleanupIntervalMs = parseInt(process.env.CLEANUP_INTERVAL_MS, 10);
  if (process.env.APPROVAL_TIMEOUT_MS) config.approvalTimeoutMs = parseInt(process.env.APPROVAL_TIMEOUT_MS, 10);

  return config;
}
