import * as lark from '@larksuiteoapi/node-sdk';

function createFeishuAdapter(client) {
    return {
        async reply(threadId, text) {
            const chatId = threadId.replace('feishu:', '');
            try {
                const result = await client.im.message.create({
                    params: { receive_id_type: 'chat_id' },
                    data: {
                        receive_id: chatId,
                        msg_type: 'text',
                        content: JSON.stringify({ text }),
                    },
                });
                return result.data?.message_id || '';
            }
            catch (error) {
                console.error('发送飞书消息失败:', error);
                throw error;
            }
        },
        async sendTypingIndicator(threadId) {
            const chatId = threadId.replace('feishu:', '');
            try {
                const result = await client.im.message.create({
                    params: { receive_id_type: 'chat_id' },
                    data: {
                        receive_id: chatId,
                        msg_type: 'text',
                        content: JSON.stringify({ text: '⏳ 思考中...' }),
                    },
                });
                return result.data?.message_id || '';
            }
            catch (error) {
                console.error('发送思考指示失败:', error);
                return '';
            }
        },
        async updateMessage(threadId, messageId, text) {
            if (!messageId)
                return;
            try {
                await client.im.message.patch({
                    path: { message_id: messageId },
                    data: {
                        content: JSON.stringify({ text }),
                    },
                });
            }
            catch (error) {
                console.warn('更新消息失败:', error);
            }
        },
        async deleteMessage(threadId, messageId) {
            if (!messageId)
                return;
            try {
                await client.im.message.delete({
                    path: { message_id: messageId },
                });
            }
            catch (error) {
                console.warn('删除消息失败:', error);
            }
        },
    };
}

export { createFeishuAdapter };
export default createFeishuAdapter;
