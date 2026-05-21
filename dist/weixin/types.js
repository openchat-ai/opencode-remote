/**
 * Weixin API types (based on @tencent-weixin/openclaw-weixin)
 */
// Message types
export const MessageItemType = {
    NONE: 0,
    TEXT: 1,
    IMAGE: 2,
    VOICE: 3,
    FILE: 4,
    VIDEO: 5,
};
export const MessageType = {
    NONE: 0,
    USER: 1,
    BOT: 2,
};
export const MessageState = {
    NEW: 0,
    GENERATING: 1,
    FINISH: 2,
};
// Constants
export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
