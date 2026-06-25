// userId → adapter 映射，用于跨用户消息路由
// 定期清理防内存泄漏
const MAX_SIZE = 5000;
export const userAdapterMap = new Map();

setInterval(() => {
    if (userAdapterMap.size > MAX_SIZE) {
        const toDelete = userAdapterMap.size - MAX_SIZE;
        const keys = [...userAdapterMap.keys()];
        for (let i = 0; i < toDelete; i++) userAdapterMap.delete(keys[i]);
    }
}, 30 * 60 * 1000).unref();
