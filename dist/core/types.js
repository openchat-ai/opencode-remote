// Core types for OpenCode Remote Control
// Message templates - emoji vocabulary
export const EMOJI = {
    SUCCESS: '✅',
    ERROR: '❌',
    LOADING: '⏳',
    THINKING: '🤔',
    APPROVAL: '📝',
    FILES: '📄',
    CODE: '🔧',
    START: '🚀',
    EXPIRED: '💤',
    WARNING: '⚠️',
    QUESTION: '💬',
};
export function loadConfig() {
    return {
        telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
        feishuAppId: process.env.FEISHU_APP_ID || undefined,
        feishuAppSecret: process.env.FEISHU_APP_SECRET || undefined,
        weixinToken: process.env.WEIXIN_TOKEN || undefined,
        weixinBaseUrl: process.env.WEIXIN_BASE_URL || undefined,
        opencodeServerUrl: process.env.OPENCODE_SERVER_URL || 'http://localhost:3000',
        tunnelUrl: process.env.TUNNEL_URL || '',
        sessionIdleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '1800000', 10),
        cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '300000', 10),
        approvalTimeoutMs: parseInt(process.env.APPROVAL_TIMEOUT_MS || '300000', 10),
    };
}
