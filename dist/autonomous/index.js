import { createSession, sendMessage } from '../opencode/client.js';
import { sendDecision, cancelDecision } from './decisions.js';

let autoLoopAbort = null;
let autoContext = null;

export function isAutoRunning() {
    return autoLoopAbort !== null && !autoLoopAbort.signal.aborted;
}

export function stopAutoLoop() {
    if (autoLoopAbort) {
        autoLoopAbort.abort();
        autoLoopAbort = null;
    }
    autoContext = null;
}

export async function startAutoLoop({ adapter, threadId, goal, openCodeSessions, broadcastTo = [] }) {
    stopAutoLoop();
    autoLoopAbort = new AbortController();
    const signal = autoLoopAbort.signal;
    autoContext = { adapter, threadId, goal, openCodeSessions, broadcastTo };

    const session = await createSession(`auto-${Date.now()}`, `自主研发: ${goal.slice(0, 40)}`);
    if (!session) {
        await adapter.reply(threadId, '❌ 无法创建自主研发会话');
        return;
    }
    openCodeSessions.set(threadId, session);

    const sysPrompt = `当前项目: 遥控器 (opencode-remote-control)
目标: ${goal}

你是自主开发模式，可以读取项目代码、修改文件、运行命令。
当遇到需要人类决定的选项时，在回复中包含以下格式：

[DECISION]
问题描述
1. 选项一
2. 选项二
推荐: 1
[DECISION]

除此之外，请自主推进工作。完成后输出: ✅ 任务完成: 简要总结`;

    const taskRunner = async () => {
        try {
            await adapter.reply(threadId, `🤖 开始自主开发: ${goal}`);
            let fullText = '';
            await sendMessage(session, sysPrompt, {
                onResponseMeta: (meta) => {
                    if (meta.providerID && meta.modelID) {
                        console.log(`[auto] using ${meta.providerID}/${meta.modelID}`);
                    }
                },
                onText: (text) => {
                    fullText += text;
                    const decisionMatch = fullText.match(/\[DECISION\]([\s\S]*?)\[\/DECISION\]/);
                    if (decisionMatch) {
                        throw new DecisionRequired(decisionMatch[1].trim());
                    }
                },
            }, threadId);

            await adapter.reply(threadId, `✅ 自主开发完成`);
        } catch (e) {
            if (e.name === 'DecisionRequired') {
                await handleDecision(e.message);
            } else if (!signal.aborted) {
                console.error('[auto] error:', e.message);
                await adapter.reply(threadId, `❌ 自主开发出错: ${e.message}`);
            }
        } finally {
            if (!signal.aborted) {
                autoLoopAbort = null;
                autoContext = null;
            }
        }
    };

    taskRunner();
}

class DecisionRequired extends Error {
    constructor(text) { super(text); this.name = 'DecisionRequired'; }
}

async function handleDecision(decisionText) {
    const ctx = autoContext;
    if (!ctx || ctx.signal?.aborted) return;
    const { adapter, threadId, broadcastTo } = ctx;

    const lines = decisionText.split('\n').map(l => l.trim()).filter(Boolean);
    const question = lines[0] || '请选择';
    const options = [];
    let recommended = 1;
    for (const l of lines) {
        const optMatch = l.match(/^(\d+)\.\s*(.+)/);
        if (optMatch) {
            options.push(optMatch[2]);
            if (optMatch[1]) recommended = parseInt(optMatch[1], 10);
        }
        const recMatch = l.match(/推荐:\s*(\d+)/);
        if (recMatch) recommended = parseInt(recMatch[1], 10);
    }
    if (options.length === 0) {
        options.push('继续');
    }

    const choice = await sendDecision({ adapter, threadId, question, options, recommended, timeoutMs: 5 * 60 * 1000, broadcastTo });
    if (ctx.signal?.aborted) return;

    if (choice === 0) {
        await adapter.reply(threadId, '⏹ 决策取消，自主开发停止');
        return;
    }

    const chosen = options[choice - 1];
    const userChoice = `选择了: ${choice}. ${chosen}`;

    const { session } = ctx;
    sendMessage(session, userChoice, {
        onText: (text) => {
            const decisionMatch = text.match(/\[DECISION\]([\s\S]*?)\[\/DECISION\]/);
            if (decisionMatch) {
                throw new DecisionRequired(decisionMatch[1].trim());
            }
        },
    }, threadId).then(async (result) => {
        if (result && result.includes('✅')) {
            await adapter.reply(threadId, `✅ 自主开发完成`);
        }
    }).catch(async (e) => {
        if (e.name === 'DecisionRequired') {
            await handleDecision(e.message);
        } else if (!ctx.signal?.aborted) {
            console.error('[auto] post-decision error:', e.message);
        }
    });
}
