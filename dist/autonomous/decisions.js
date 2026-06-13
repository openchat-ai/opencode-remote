const pendingDecisions = new Map();

export function hasPendingDecision(threadId) {
    return pendingDecisions.has(threadId);
}

export function resolveDecision(threadId, input) {
    const pd = pendingDecisions.get(threadId);
    if (!pd) return false;
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > pd.options.length) return false;
    clearTimeout(pd.timer);
    pendingDecisions.delete(threadId);
    pd.resolve(num);
    return true;
}

export function sendDecision({ adapter, threadId, question, options, recommended, timeoutMs = 5 * 60 * 1000, broadcastTo = [] }) {
    return new Promise((resolve) => {
        if (pendingDecisions.has(threadId)) {
            pendingDecisions.get(threadId).resolve(0);
            clearTimeout(pendingDecisions.get(threadId).timer);
            pendingDecisions.delete(threadId);
        }

        const lines = [
            `🤖 需要你决定：`,
            `${question}`,
            ``,
        ];
        options.forEach((opt, i) => {
            const mark = i + 1 === recommended ? ' ✅ 推荐' : '';
            lines.push(`  ${i + 1}. ${opt}${mark}`);
        });
        const timeoutMin = Math.round(timeoutMs / 60000);
        lines.push(``, `⏱ ${timeoutMin}分钟无回复自动选择推荐项`);

        const msg = lines.join('\n');
        adapter.reply(threadId, msg).catch(() => {});

        const targets = new Set([threadId, ...broadcastTo]);
        for (const tid of targets) {
            if (tid !== threadId) {
                adapter.reply(tid, msg).catch(() => {});
            }
        }

        const timer = setTimeout(() => {
            if (pendingDecisions.has(threadId)) {
                pendingDecisions.delete(threadId);
                const choice = recommended;
                const timeoutMsg = `⏰ 超时，自动选择推荐项: ${options[choice - 1]}`;
                adapter.reply(threadId, timeoutMsg).catch(() => {});
                for (const tid of targets) {
                    if (tid !== threadId) {
                        adapter.reply(tid, timeoutMsg).catch(() => {});
                    }
                }
                resolve(choice);
            }
        }, timeoutMs);

        pendingDecisions.set(threadId, { resolve, timer, options, recommended });
    });
}

export function cancelDecision(threadId, reason = '') {
    const pd = pendingDecisions.get(threadId);
    if (!pd) return;
    clearTimeout(pd.timer);
    pendingDecisions.delete(threadId);
    pd.resolve(0);
}
