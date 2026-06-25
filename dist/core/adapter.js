// BotAdapter interface — all platform adapters must implement these methods
//   reply(threadId, text)                — send a text message to user
//   sendTypingIndicator(threadId)         — show typing indicator (start)
//   sendTypingEnd?(threadId)              — stop typing indicator [optional]
//   updateMessage?(threadId, msgId, text) — edit a message [optional]
//   deleteMessage?(threadId, msgId)       — delete a message [optional]
//   platform                             — string identifier ('weixin'|'feishu'|'telegram')

export {};

// This module only exists as the contract reference.
// Each platform adapter (weixin/adapter.js etc.) independently satisfies this shape.
