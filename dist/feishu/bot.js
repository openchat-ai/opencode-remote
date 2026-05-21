import * as lark from '@larksuiteoapi/node-sdk';
import { initSessionManager } from '../core/session.js';
import { initOpenCode } from '../opencode/client.js';
import { getAuthStatus } from '../core/auth.js';
import { createFeishuAdapter } from './adapter.js';
import { handleMessage } from './handler.js';

let feishuClient = null;
let wsClient = null;
let config = null;
let openCodeSessions = null;

function feishuEventToContext(event) {
    return {
        platform: 'feishu',
        threadId: `feishu:${event.message.chat_id}`,
        userId: event.sender?.sender_id?.user_id || 'unknown',
        messageId: event.message.message_id,
    };
}

const rateLimitMap = new Map();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60000;

function checkRateLimit(chatId) {
    const now = Date.now();
    const entry = rateLimitMap.get(chatId);
    if (!entry || now > entry.resetTime) {
        rateLimitMap.set(chatId, { count: 1, resetTime: now + RATE_WINDOW });
        return true;
    }
    if (entry.count >= RATE_LIMIT) {
        return false;
    }
    entry.count++;
    return true;
}

export async function startFeishuBot(botConfig) {
    config = botConfig;
    if (!config.feishuAppId || !config.feishuAppSecret) {
        throw new Error('飞书未配置。运行: opencode-remote config');
    }
    feishuClient = new lark.Client({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
    });
    initSessionManager(config);
    openCodeSessions = new Map();
    console.log('🔧 正在初始化 OpenCode...');
    try {
        await initOpenCode();
        console.log('✅ OpenCode 就绪');
    }
    catch (error) {
        console.error('❌ OpenCode 初始化失败:', error);
    }
    const adapter = createFeishuAdapter(feishuClient);
    wsClient = new lark.WSClient({
        appId: config.feishuAppId,
        appSecret: config.feishuAppSecret,
    });
    const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
            console.log('📩 收到消息事件');
            try {
                if (!data?.message) {
                    console.warn('收到无消息内容的事件');
                    return { code: 0 };
                }
                const chatId = data.message.chat_id;
                if (!checkRateLimit(chatId)) {
                    console.warn(`频率超限: ${chatId}`);
                    return { code: 0 };
                }
                let text = '';
                try {
                    const content = JSON.parse(data.message.content);
                    text = content.text || '';
                }
                catch {
                    text = data.message.content || '';
                }
                if (!text.trim()) {
                    return { code: 0 };
                }
                const ctx = feishuEventToContext(data);
                handleMessage(adapter, ctx, text, openCodeSessions).catch(error => {
                    console.error('处理飞书消息失败:', error);
                });
                return { code: 0 };
            }
            catch (error) {
                console.error('飞书事件处理器错误:', error);
                return { code: 0 };
            }
        },
    });
    console.log('🔗 正在启动飞书 WebSocket 长连接...');
    console.log('');
    console.log('✨ 长连接模式 - 无需隧道/ngrok！');
    console.log('   确保你的电脑可以访问互联网。');
    console.log('');
    const authStatus = getAuthStatus();
    if (!authStatus.feishu) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  🔐 安全提示');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('  Bot 尚未绑定安全所有者！');
        console.log('  FIRST 发送 /start 的人将成为所有者。');
        console.log('');
        console.log('  👉 打开飞书向 Bot 发送 /start！');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    }
    else {
        console.log('🔒 Bot 已绑定（所有者已认证）');
        console.log('');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📋 配置检查清单');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('  Step 1: 添加权限 (权限管理 → API权限)');
    console.log('  ────────────────────────────────────────');
    console.log('  点击"批量添加"(Batch Add) 并粘贴以下 JSON:');
    console.log('');
    console.log('  ┌────────────────────────────────────────────────────┐');
    console.log('  │ {                                                  │');
    console.log('  │   "im:message",                                   │');
    console.log('  │   "im:message:send_as_bot",                       │');
    console.log('  │   "im:message:receive_as_bot"                     │');
    console.log('  │ }                                                  │');
    console.log('  └────────────────────────────────────────────────────┘');
    console.log('');
    console.log('  Step 2: 启用机器人 (应用能力 → 机器人)');
    console.log('  ────────────────────────────────────────');
    console.log('  - 启用"启用机器人"');
    console.log('  - 启用"机器人可主动发送消息给用户"');
    console.log('  - 启用"用户可与机器人进行单聊"');
    console.log('');
    console.log('  Step 3: 事件订阅 (事件订阅)');
    console.log('  ────────────────────────────────────────');
    console.log('  ⚠️  必须先启动此 Bot 再保存事件配置！');
    console.log('  - 选择"使用长连接接收事件"');
    console.log('  - 添加事件: im.message.receive_v1');
    console.log('  - 点击保存');
    console.log('');
    console.log('  Step 4: 发布应用 (版本管理与发布)');
    console.log('  ────────────────────────────────────────');
    console.log('  - 创建版本 → 申请发布 → 发布');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  🔍 调试: 在飞书中向你的 Bot 发送消息！');
    console.log('     你将看到: 📩 收到消息事件');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    const shutdown = () => {
        console.log('\n🛑 关闭飞书 Bot...');
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    await wsClient.start({ eventDispatcher });
}
