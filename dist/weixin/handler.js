import { createHandler } from '../core/handler.js';
import { handleCommand, sharedRoom, isSharedMember } from './commands.js';
import { userAdapterMap } from './user-adapter-map.js';

function replyTo(userId, text, fallbackAdapter) {
    const a = userAdapterMap.get(userId) || fallbackAdapter;
    return a.reply(userId, text);
}

function wrapAdapterForShared(adapter, senderId) {
    return new Proxy(adapter, {
        get(target, prop) {
            if (prop !== 'reply') return target[prop];
            return async (threadId, msg) => {
                const result = await target.reply(threadId, msg).catch(() => {});
                if (threadId === senderId) {
                    for (const tid of sharedRoom.members) {
                        if (tid !== senderId) replyTo(tid, msg, adapter).catch(() => {});
                    }
                }
                return result;
            };
        },
    });
}

const handler = createHandler({
    handleCommand,
    replyTo,
    wrapAdapterForShared,
    isSharedMember,
    sharedRoom,
});

export const handleMessage = handler.handleMessage;
export const forwardToOpenCode = handler.forwardToOpenCode;
