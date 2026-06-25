import { createHandler } from '../core/handler.js';
import { handleCommand } from './commands.js';

const handler = createHandler({
    handleCommand,
    replyTo: (userId, text, fallbackAdapter) => fallbackAdapter.reply(userId, text),
    wrapAdapterForShared: (adapter) => adapter,
});

export const handleMessage = handler.handleMessage;
export const forwardToOpenCode = handler.forwardToOpenCode;
