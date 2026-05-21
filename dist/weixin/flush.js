import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const lastFlushTime = new Map();
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const OTHER_SESSIONS_WINDOW_MS = 60 * 60 * 1000;

export async function flushMemory(projectRoot, session, openCodeSession) {
    if (!openCodeSession?.sessionId) {
        return '⚠️ 没有活跃的 OpenCode 会话';
    }

    const memoryPath = findMemoryPath(projectRoot);
    if (!memoryPath) {
        return `⚠️ 未找到 MEMORY.md，请先运行 /initmemory`;
    }

    const searchRoot = join(memoryPath, '..');
    const memoryDir = join(searchRoot, 'memory');

    const now = Date.now();
    const lastFlush = lastFlushTime.get(openCodeSession.sessionId) || 0;

    try {
        const { initOpenCode, listOpenCodeSessions } = await import('../opencode/client.js');
        const opencode = await initOpenCode();
        if (!opencode) {
            return '❌ 无法连接 OpenCode';
        }

        const results = [];
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10);
        const timeStr = today.toTimeString().slice(0, 5);

        let insightsGathered = [];

        const currentSessionInsights = await extractInsightsFromSession(
            opencode,
            openCodeSession.sessionId,
            `当前会话 ${openCodeSession.sessionId.slice(0, 8)}...`
        );

        if (currentSessionInsights.length > 0) {
            insightsGathered.push(...currentSessionInsights);
            results.push(`📝 从当前会话提取 ${currentSessionInsights.length} 条经验`);
        }

        if (now - lastFlush > OTHER_SESSIONS_WINDOW_MS) {
            const otherInsights = await scanOtherSessions(
                opencode,
                projectRoot,
                openCodeSession.sessionId
            );

            if (otherInsights.length > 0) {
                insightsGathered.push(...otherInsights);
                results.push(`🔗 从其它会话提取 ${otherInsights.length} 条经验`);
            }
        } else {
            results.push(`⏭️ 跳过其它会话扫描（${Math.floor((OTHER_SESSIONS_WINDOW_MS - (now - lastFlush)) / 60000)}分钟后重试）`);
        }

        const uniqueInsights = deduplicateInsights(insightsGathered, memoryPath, memoryDir);

        let learnedSummary = null;

        if (uniqueInsights.length > 0) {
            for (const insight of uniqueInsights) {
                const newEntry = `- [${dateStr} ${timeStr}] ${insight.text}`;

                if (insight.topic) {
                    const topicFile = getTopicFile(insight.topic, memoryDir);
                    if (topicFile) {
                        updateMemoryFile(topicFile, newEntry);
                    }
                }

                updateMemoryFile(memoryPath, newEntry);
            }
            results.push(`✅ 已保存 ${uniqueInsights.length} 条新经验`);
            lastFlushTime.set(openCodeSession.sessionId, now);

            learnedSummary = await generateLearnedSummary(opencode, openCodeSession.sessionId, uniqueInsights);
        } else {
            results.push('ℹ️ 没有新的经验教训可保存');
        }

        const summaryResult = results.join('\n') || '⚠️ 没有可保存的内容';
        return { summary: summaryResult, learned: learnedSummary };

    } catch (e) {
        console.error(`[flush] Error: ${e.message}`);
        return { summary: `❌ flush 失败: ${e.message}`, learned: null };
    }
}

async function generateLearnedSummary(opencode, sessionId, insights) {
    try {
        const insightsText = insights.map(i => `- ${i.text}`).join('\n');

        const prompt = `以下是从对话中提取的经验教训，请用简洁自然的方式总结（1-2句话），说明学到了什么：

${insightsText}

格式：💡 学到了：...`;

        const tempSession = await opencode.client.session.create({});
        if (!tempSession?.id) {
            return null;
        }
        const tempId = tempSession.id;

        try {
            await opencode.client.session.promptAsync({
                path: { id: tempId },
                body: { parts: [{ type: 'text', text: prompt }] }
            });

            await new Promise(r => setTimeout(r, 2000));

            const msgsResult = await opencode.client.session.messages({
                path: { id: tempId }
            });

            if (msgsResult.data && msgsResult.data.length > 0) {
                const latestMsg = msgsResult.data[msgsResult.data.length - 1];
                if (latestMsg.parts) {
                    const textParts = latestMsg.parts
                        .filter(p => p.type === 'text' && p.text)
                        .map(p => p.text);
                    const summary = textParts.join('\n').trim();
                    if (summary && summary.includes('学到了')) {
                        return summary;
                    }
                }
            }
        } finally {
            opencode.client.session.delete({ path: { id: tempId } }).catch(() => {});
        }

        return null;
    } catch (e) {
        console.warn(`[flush] Failed to generate summary: ${e.message}`);
        return null;
    }
}

async function extractInsightsFromSession(opencode, sessionId, label) {
    try {
        const msgsResult = await opencode.client.session.messages({
            path: { id: sessionId }
        });

        if (msgsResult.error || !msgsResult.data || msgsResult.data.length === 0) {
            return [];
        }

        const messages = msgsResult.data;
        const conversationText = buildConversationText(messages);

        if (!conversationText.trim()) {
            return [];
        }

        const analysisPrompt = `分析以下对话，提取具体的经验教训（如果有的话）。

要求：
1. 只提取真正有价值的技术经验、踩坑记录、决策原因
2. 不要泛泛的描述，要具体的问题和解决方案
3. 如果对话没有有价值的内容，返回空
4. 按以下格式返回（每条一行）：
[topic] 具体教训

topics 可选：weixin-bot, session-management, opencode-integration, debugging, architecture

对话内容：
${conversationText.slice(-3000)}`;

        const tempSession = await opencode.client.session.create({});
        if (!tempSession?.id) {
            return [];
        }
        const tempId = tempSession.id;

        try {
            await opencode.client.session.promptAsync({
                path: { id: tempId },
                body: { parts: [{ type: 'text', text: analysisPrompt }] }
            });

            await new Promise(r => setTimeout(r, 3000));

            const analysisMsgs = await opencode.client.session.messages({
                path: { id: tempId }
            });

            let insights = [];
            if (analysisMsgs.data && analysisMsgs.data.length > 0) {
                const latestMsg = analysisMsgs.data[analysisMsgs.data.length - 1];
                if (latestMsg.parts) {
                    const textParts = latestMsg.parts
                        .filter(p => p.type === 'text' && p.text)
                        .map(p => p.text);
                    const rawInsights = textParts.join('\n').trim().split('\n');

                    for (const line of rawInsights) {
                        const trimmed = line.trim();
                        if (trimmed.length > 10 && trimmed.includes('[')) {
                            const topicMatch = trimmed.match(/\[([^\]]+)\]/);
                            const topic = topicMatch ? topicMatch[1] : null;
                            const text = trimmed.replace(/\[([^\]]+)\]\s*/, '').trim();

                            if (text) {
                                insights.push({ topic, text, source: label });
                            }
                        }
                    }
                }
            }
            return insights;
        } finally {
            opencode.client.session.delete({ path: { id: tempId } }).catch(() => {});
        }
    } catch (e) {
        console.warn(`[flush] Failed to extract from ${label}: ${e.message}`);
        return [];
    }
}

async function scanOtherSessions(opencode, projectRoot, excludeSessionId) {
    try {
        const allSessions = await listOpenCodeSessions(opencode);

        const sameProjectSessions = allSessions.filter(s =>
            s.id !== excludeSessionId &&
            s.directory &&
            (s.directory === projectRoot || projectRoot.endsWith(s.directory))
        );

        if (sameProjectSessions.length === 0) {
            return [];
        }

        const allInsights = [];

        for (const s of sameProjectSessions.slice(0, 5)) {
            const insights = await extractInsightsFromSession(
                opencode,
                s.id,
                `会话 ${s.id.slice(0, 8)}... (${s.title || 'untitled'})`
            );
            allInsights.push(...insights);
        }

        return allInsights;
    } catch (e) {
        console.warn(`[flush] Failed to scan other sessions: ${e.message}`);
        return [];
    }
}

function deduplicateInsights(newInsights, memoryPath, memoryDir) {
    const existingTexts = new Set();

    try {
        const memoryContent = readFileSync(memoryPath, 'utf-8');
        const lines = memoryContent.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('- [')) {
                const textMatch = line.match(/\] (.+)/);
                if (textMatch) {
                    const text = textMatch[1].toLowerCase().trim();
                    existingTexts.add(text);
                }
            }
        }

        const topicFiles = ['weixin-bot.md', 'session-management.md', 'opencode-integration.md', 'debugging.md', 'architecture.md'];
        for (const f of topicFiles) {
            const path = join(memoryDir, f);
            if (existsSync(path)) {
                const content = readFileSync(path, 'utf-8');
                const lines = content.split('\n');
                for (const line of lines) {
                    if (line.trim().startsWith('- [')) {
                        const textMatch = line.match(/\] (.+)/);
                        if (textMatch) {
                            existingTexts.add(textMatch[1].toLowerCase().trim());
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[flush] Error during deduplication:', e.message);
    }

    return newInsights.filter(insight => {
        const normalized = insight.text.toLowerCase().trim();
        if (existingTexts.has(normalized)) {
            return false;
        }
        for (const existing of existingTexts) {
            if (normalized.includes(existing) || existing.includes(normalized)) {
                return false;
            }
        }
        existingTexts.add(normalized);
        return true;
    });
}

function findMemoryPath(projectRoot) {
    const paths = [
        join(projectRoot, 'MEMORY.md'),
        join(projectRoot, '..', 'MEMORY.md'),
        join(projectRoot, '..', '..', 'MEMORY.md'),
    ];

    for (const p of paths) {
        if (existsSync(p)) return p;
    }

    const projectRootMemoryPath = join(process.cwd(), 'MEMORY.md');
    if (existsSync(projectRootMemoryPath)) return projectRootMemoryPath;

    return null;
}

function buildConversationText(messages) {
    const lines = [];
    for (const msg of messages) {
        const role = msg.info?.role || '';
        let content = '';

        if (msg.parts && Array.isArray(msg.parts)) {
            content = msg.parts
                .filter(p => p.type === 'text' && p.text)
                .map(p => p.text)
                .join('\n');
        } else if (msg.info?.content) {
            content = msg.info.content;
        }

        if (content) {
            lines.push(`[${role}]: ${content.slice(0, 500)}`);
        }
    }
    return lines.join('\n\n');
}

function getTopicFile(topic, memoryDir) {
    const topicMap = {
        'weixin-bot': 'weixin-bot.md',
        'weixin': 'weixin-bot.md',
        '微信': 'weixin-bot.md',
        'bot': 'weixin-bot.md',
        'session-management': 'session-management.md',
        'session': 'session-management.md',
        '会话': 'session-management.md',
        'opencode-integration': 'opencode-integration.md',
        'opencode': 'opencode-integration.md',
        'client': 'opencode-integration.md',
        'debugging': 'debugging.md',
        'debug': 'debugging.md',
        '调试': 'debugging.md',
        'architecture': 'architecture.md',
        '架构': 'architecture.md',
    };

    const filename = topicMap[topic.toLowerCase()];
    if (!filename) return null;

    const path = join(memoryDir, filename);
    return existsSync(path) ? path : null;
}

function updateMemoryFile(filePath, newEntry) {
    try {
        let content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        const insightIndex = lines.findIndex(line => line.startsWith('## 经验教训'));
        if (insightIndex === -1) {
            content += `\n## 经验教训\n${newEntry}\n`;
        } else {
            const insertIndex = lines.findIndex((line, i) =>
                i > insightIndex && (line.startsWith('## ') || line.startsWith('# '))
            );
            if (insertIndex !== -1) {
                lines.splice(insertIndex, 0, newEntry);
            } else {
                lines.push(newEntry);
            }
            content = lines.join('\n');
        }

        writeFileSync(filePath, content, 'utf-8');
        return true;
    } catch (e) {
        console.warn(`[flush] Failed to update ${filePath}: ${e.message}`);
        return false;
    }
}
