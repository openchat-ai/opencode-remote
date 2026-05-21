import { getOrCreateSession } from '../core/session.js';
import { splitMessage } from '../core/notifications.js';
import { initOpenCode, createSession, sendMessage, checkConnection, resumeSession, shareSession } from '../opencode/client.js';
import { isAuthorized, hasOwner } from '../core/auth.js';
import { detectCommand } from '../core/router.js';
import { handleCommand, formatTimeAgo } from './commands.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const lastFlushTime = new Map();
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

async function autoFlush(adapter, threadId, session, openCodeSessions) {
    const lastFlush = lastFlushTime.get(threadId) || 0;
    const now = Date.now();
    if (now - lastFlush < FLUSH_INTERVAL_MS) return;
    if (!session.opencodeSessionId) return;
    const ocSession = openCodeSessions?.get(threadId);
    if (!ocSession) return;
    const projectDir = session.projectDir || globalThis.__autoProjectDir;
    if (!projectDir) return;
    try {
        const { flushMemory } = await import('../weixin/flush.js');
        lastFlushTime.set(threadId, now);
        const result = await flushMemory(projectDir, session, ocSession);
        if (result.learned) {
            console.log(`[auto-flush] ${result.learned}`);
        } else {
            console.log(`[auto-flush] ${result.summary.split('\n')[0]}`);
        }
    } catch (e) {
        console.warn(`[auto-flush] 失败: ${e.message}`);
    }
}

function loadMemoryContext(projectRoot) {
    const paths = [
        join(projectRoot, 'MEMORY.md'),
        join(projectRoot, '..', 'MEMORY.md'),
        join(projectRoot, '..', '..', 'MEMORY.md'),
    ];
    for (const memoryPath of paths) {
        if (existsSync(memoryPath)) {
            try {
                const content = readFileSync(memoryPath, 'utf-8');
                const lines = content.split('\n');
                const insights = [];
                let inInsights = false;
                for (const line of lines) {
                    if (line.startsWith('## 经验教训')) {
                        inInsights = true;
                        continue;
                    }
                    if (inInsights) {
                        if (line.startsWith('## ') || line.startsWith('# ')) {
                            break;
                        }
                        if (line.trim().startsWith('- [')) {
                            insights.push(line.trim());
                        }
                    }
                }
                if (insights.length > 0) {
                    return `【项目记忆 - 经验教训】\n${insights.slice(-10).join('\n')}`;
                }
            } catch (e) {
                console.warn(`[memory] 加载失败: ${e.message}`);
            }
            break;
        }
    }
    return null;
}

async function handleMessage(adapter, ctx, text, openCodeSessions) {
    const session = await getOrCreateSession(ctx.threadId, 'feishu');
    const parsed = detectCommand(text);
    if (parsed) {
        await handleCommand(adapter, ctx, parsed.name, parsed.arg, openCodeSessions);
        return;
    }
    const trimmed = text.trim();
    if (session._deleteSessionList) {
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            const list = session._deleteSessionList;
            if (num >= 1 && num <= list.length) {
                const target = list[num - 1];
                try {
                    const opencode = await initOpenCode();
                    if (!opencode) { await adapter.reply(ctx.threadId, '❌ 无法删除会话'); return; }
                    await opencode.client.session.delete({ path: { id: target.id } });
                    if (session.opencodeSessionId === target.id) {
                        openCodeSessions.delete(ctx.threadId);
                        session.opencodeSessionId = undefined;
                    }
                    const result = await opencode.client.session.list();
                    if (!result.error && result.data && result.data.length > 0) {
                        const sorted = result.data.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));
                        session._deleteSessionList = sorted;
                        let msg = `🗑️ 已删除: ${target.title || '无标题'}\n\n📂 选择要删除的会话（回复编号）：\n\n`;
                        sorted.slice(0, 10).forEach((s, i) => {
                            const n = i + 1;
                            msg += `${n}. ${s.title || '无标题'} (${s.updated_at ? formatTimeAgo(s.updated_at * 1000) : ''})\n`;
                        });
                        if (sorted.length > 10) msg += `\n... 共 ${sorted.length} 个会话`;
                        msg += '\n\n回复编号删除';
                        for (const m of splitMessage(msg)) await adapter.reply(ctx.threadId, m);
                    } else {
                        session._deleteSessionList = null;
                        await adapter.reply(ctx.threadId, `🗑️ 已删除: ${target.title || '无标题'}\n📭 没有更多会话了`);
                    }
                } catch (e) {
                    await adapter.reply(ctx.threadId, `❌ 删除失败: ${e.message}`);
                }
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._deleteSessionList.length}`);
            }
            return;
        }
        session._deleteSessionList = null;
    }
    if (session._switchSessionList) {
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            const list = session._switchSessionList;
            if (num >= 1 && num <= list.length) {
                const target = list[num - 1];
                if (session._showSessionState) {
                    session._showSessionState = null;
                    session._pendingSwitchSession = target;
                    const targetDir = target.directory || process.cwd();
                    let stateMsg = `📋 会话: ${target.title || '无标题'}\n`;
                    stateMsg += `ID: ${target.id.slice(0, 8)}...\n`;
                    if (target.directory) stateMsg += `📁 目录: ${target.directory}\n`;
                    stateMsg += '\n';
                    try {
                        const memoryPath = join(targetDir, 'MEMORY.md');
                        if (existsSync(memoryPath)) {
                            const content = readFileSync(memoryPath, 'utf-8');
                            const summaryMatch = content.match(/## 最近会话摘要\n([\s\S]*?)(?=##|$)/);
                            if (summaryMatch) {
                                const lines = summaryMatch[1].trim().split('\n').filter(l => l.trim());
                                const recent = lines.slice(-3);
                                if (recent.length > 0) {
                                    stateMsg += `📝 最近会话:\n${recent.map(l => `  ${l.trim()}`).join('\n')}\n\n`;
                                }
                            }
                        }
                    } catch { console.debug('[session-switch] 无法读取MEMORY.md'); }
                    stateMsg += `💡 回复 "确认" 切换到此会话，或回复其他内容取消`;
                    await adapter.reply(ctx.threadId, stateMsg);
                    return;
                }
                try {
                    const resumed = await resumeSession(target.id);
                    if (resumed) {
                        openCodeSessions.set(ctx.threadId, resumed);
                        session.opencodeSessionId = resumed.sessionId;
                        session.taskStartTime = null;
                        session.currentTool = null;
                        session.modifiedFiles = null;
                        if (target.directory) {
                            session.projectDir = target.directory;
                            globalThis.__autoProjectDir = target.directory;
                            const memoryPath = join(target.directory, 'MEMORY.md');
                            if (!existsSync(memoryPath)) {
                                try {
                                    const { initMemorySystem } = await import('../weixin/init-memory.js');
                                    await initMemorySystem(target.directory);
                                } catch { console.debug('[session-switch] 自动初始化记忆失败'); }
                            }
                        }
                        await adapter.reply(ctx.threadId, `✅ 已切换至: ${target.title || '无标题'}\nID: ${resumed.sessionId.slice(0, 8)}...`);
                    } else {
                        await adapter.reply(ctx.threadId, '❌ 切换失败');
                    }
                } catch (e) {
                    await adapter.reply(ctx.threadId, `❌ 切换失败: ${e.message}`);
                }
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._switchSessionList.length}`);
            }
            session._switchSessionList = null;
            session._showSessionState = null;
            session._pendingSwitchSession = null;
            return;
        }
        session._switchSessionList = null;
        session._showSessionState = null;
        session._pendingSwitchSession = null;
    }
    if (session._pendingSwitchSession) {
        const confirm = trimmed.toLowerCase();
        const target = session._pendingSwitchSession;
        session._pendingSwitchSession = null;
        if (confirm === '确认' || confirm === 'confirm' || confirm === 'y' || confirm === '1') {
            try {
                const resumed = await resumeSession(target.id);
                if (resumed) {
                    openCodeSessions.set(ctx.threadId, resumed);
                    session.opencodeSessionId = resumed.sessionId;
                    session.taskStartTime = null;
                    session.currentTool = null;
                    session.modifiedFiles = null;
                    if (target.directory) {
                        session.projectDir = target.directory;
                        globalThis.__autoProjectDir = target.directory;
                        const memoryPath = join(target.directory, 'MEMORY.md');
                        if (!existsSync(memoryPath)) {
                            try {
                                const { initMemorySystem } = await import('../weixin/init-memory.js');
                                await initMemorySystem(target.directory);
                            } catch { console.debug('[session-switch] 自动初始化记忆失败'); }
                        }
                    }
                    await adapter.reply(ctx.threadId, `✅ 已切换至: ${target.title || '无标题'}\nID: ${resumed.sessionId.slice(0, 8)}...`);
                } else {
                    await adapter.reply(ctx.threadId, '❌ 切换失败');
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 切换失败: ${e.message}`);
            }
            return;
        }
        await adapter.reply(ctx.threadId, '已取消切换');
        return;
    }
    if (session._analyzeMode) {
        const confirm = trimmed.toLowerCase();
        if (confirm === '执行' || confirm === 'execute' || confirm === '开始' || confirm === 'go') {
            session._analyzeMode = false;
            const task = session._analyzeTask || text;
            session._analyzeTask = null;
            await adapter.reply(ctx.threadId, `🔧 开始执行: ${task}\n\nAI 将实施最小改动，完成后列出变更点和验证步骤。`);
            const execPrompt = `现在开始施工队模式。任务：${task}\n\n请严格执行以下步骤：\n\n1. 实施最小改动：只修改必要的代码，不要重构其他地方\n2. 保持风格一致：遵循项目现有的代码风格\n3. 列出变更点：修改完成后，列出所有改动的文件和代码\n4. 验证步骤：说明需要运行哪些测试或检查来验证修改\n5. 列出未验证的部分：说明还有哪些边界情况需要人工检查\n\n注意：\n- 只做最小改动\n- 不要顺手重构\n- 不要修改不相关的文件`;
            await forwardToOpenCode(adapter, ctx, execPrompt, openCodeSessions, session);
            return;
        }
        session._analyzeMode = false;
        session._analyzeTask = null;
        await adapter.reply(ctx.threadId, '已取消分析模式');
        return;
    }
    if (!isAuthorized('feishu', ctx.userId)) {
        if (!hasOwner('feishu')) {
            await adapter.reply(ctx.threadId, `🔐 **需要认证**

此 bot 尚未绑定。

请发送 /start 进行首次认证。`);
        } else {
            await adapter.reply(ctx.threadId, `🚫 **拒绝访问**

你无权使用此 bot。`);
        }
        return;
    }
    const connected = await checkConnection();
    if (!connected) {
        await adapter.reply(ctx.threadId, `❌ OpenCode 离线

无法连接 OpenCode 服务。

🔄 /retry — 重试连接`);
        return;
    }
    const rememberKeywords = ['记住', '记录', '记下', '以后', '偏好', '习惯'];
    const deleteKeywords = ['删除', '忘记', '取消', '抹掉', '清除'];
    const hasRememberKeyword = rememberKeywords.some(kw => text.includes(kw));
    const hasDeleteKeyword = deleteKeywords.some(kw => text.includes(kw));
    if (hasDeleteKeyword && hasRememberKeyword) {
        let query = text.replace(/删除|忘记|取消|抹掉|清除|记忆|记录|关于|那个/g, '').trim();
        try {
            const memoryManager = (await import('../weixin/memory-manager.js')).default;
            if (query.length > 0) {
                const deleted = memoryManager.deleteMemory('prefs', query);
                if (deleted) {
                    await adapter.reply(ctx.threadId, `🗑️ 已删除包含 "${query}" 的记忆条目`);
                    return;
                } else {
                    await adapter.reply(ctx.threadId, `🤷 未找到包含 "${query}" 的记忆条目`);
                    return;
                }
            } else {
                memoryManager.deleteMemory('prefs', '');
                await adapter.reply(ctx.threadId, '🗑️ 已清空所有用户偏好记忆');
                return;
            }
        } catch { console.debug('[feishu-memory] memory-manager unavailable'); }
    } else if (hasRememberKeyword) {
        if (text.length > 2 && text.length < 500) {
            try {
                const memoryManager = (await import('../weixin/memory-manager.js')).default;
                memoryManager.saveMemory('prefs', { content: text });
                console.log(`[feishu-memory] Saved user preference: ${text}`);
            } catch { console.debug('[feishu-memory] memory-manager unavailable'); }
        }
    }
    await forwardToOpenCode(adapter, ctx, text, openCodeSessions, session);
}

async function forwardToOpenCode(adapter, ctx, text, openCodeSessions, session) {
    await adapter.sendTypingIndicator(ctx.threadId);
    let openCodeSession = openCodeSessions.get(ctx.threadId);
    if (!openCodeSession) {
        if (session.opencodeSessionId) {
            openCodeSession = await resumeSession(session.opencodeSessionId);
        }
        if (!openCodeSession && globalThis.__latestOpenCodeSession?.id) {
            openCodeSession = await resumeSession(globalThis.__latestOpenCodeSession.id);
        }
        if (!openCodeSession) {
            openCodeSession = await createSession(ctx.threadId, `Feishu ${ctx.threadId}`);
            if (!openCodeSession) {
                await adapter.reply(ctx.threadId, '❌ 无法创建 OpenCode 会话');
                return;
            }
        }
        openCodeSessions.set(ctx.threadId, openCodeSession);
        session.opencodeSessionId = openCodeSession.sessionId;
    }
    if (session.modelOverride) {
        openCodeSession.model = session.modelOverride;
    }
    session.taskStartTime = Date.now();
    session.currentTool = null;
    const projectDir = session.projectDir || globalThis.__autoProjectDir;
    let scopedText = text;
    if (session._contextScope) {
        scopedText = `[上下文范围: ${session._contextScope}]\n\n${text}`;
    }
    if (projectDir) {
        const memoryContext = loadMemoryContext(projectDir);
        if (memoryContext) {
            scopedText = `${memoryContext}\n\n${scopedText}`;
        }
        if (!scopedText.includes('项目目录')) {
            scopedText = `[当前项目目录: ${projectDir}]\n\n${scopedText}`;
        }
    }
    try {
        const memoryManager = (await import('../weixin/memory-manager.js')).default;
        const autoMemory = memoryManager.getRelevantMemory(text);
        if (autoMemory) {
            scopedText = `【用户记忆/偏好】\n${autoMemory}\n\n${scopedText}`;
        }
    } catch { console.debug('[feishu-memory] memory-manager not available'); }
    console.log(`📤 Forwarding to OpenCode: ${text.substring(0, 80)}...`);
    try {
        let lastToolNotified = '';
        let hasToolActivity = false;
        let toolCallCount = 0;
        let response = await sendMessage(openCodeSession, scopedText, {
            onEvent: (event) => {
                if (event.type === 'tool.call') {
                    const props = event.properties || {};
                    const toolName = props.name || props.tool_name || 'unknown';
                    const input = props.input || {};
                    toolCallCount++;
                    let toolDesc = `🔧 执行工具: ${toolName}`;
                    if (input.path) {
                        toolDesc += `\n📁 ${input.path}`;
                    }
                    if (input.command) {
                        toolDesc += `\n💻 ${input.command}`;
                    }
                    adapter.reply(ctx.threadId, toolDesc).catch(() => {});
                    if (input.path) {
                        if (!session.modifiedFiles) session.modifiedFiles = new Set();
                        session.modifiedFiles.add(input.path);
                    }
                    console.log(`[feishu-tool] Executing: ${toolName}`);
                }
                if (event.type && !event.type.includes('delta')) {
                    console.log(`📡 Feishu Event: ${event.type}`);
                }
            },
            onTextDelta: () => {},
            onStatusChange: (status) => {
                if (status.hasToolActivity) {
                    hasToolActivity = true;
                }
                if (status.type === 'retry') {
                    adapter.updateMessage(ctx.threadId, '', `⏳ 重试中 (${status.attempt})...`).catch(() => {});
                }
            },
        });
        session.taskStartTime = null;
        session.currentTool = null;
        if (session.modifiedFiles instanceof Set) {
            session.modifiedFiles = Array.from(session.modifiedFiles);
        }
        if (!response || typeof response !== 'string') {
            await adapter.reply(ctx.threadId, '...');
            return;
        }
        const trimmedResponse = response.trim();
        if (!trimmedResponse) {
            await adapter.reply(ctx.threadId, '...');
            return;
        }
        if (trimmedResponse.startsWith('⏰') || trimmedResponse.startsWith('❌')) {
            console.error('[feishu-forward] Error response:', trimmedResponse);
            await adapter.reply(ctx.threadId, trimmedResponse);
            return;
        }
        if (trimmedResponse.endsWith(':') || trimmedResponse.endsWith('...')) {
            console.log('[feishu-forward] 检测到不完整响应，等待补充...');
            await new Promise(r => setTimeout(r, 5000));
            try {
                const msgsResult = await openCodeSession.client.session.messages({
                    path: { id: openCodeSession.sessionId },
                    query: { limit: 5 }
                });
                if (!msgsResult.error && msgsResult.data && msgsResult.data.length > 0) {
                    for (let i = msgsResult.data.length - 1; i >= 0; i--) {
                        const msg = msgsResult.data[i];
                        if (msg.info?.role === 'assistant' && msg.parts) {
                            const textParts = msg.parts.filter(p => p.type === 'text' && p.text).map(p => p.text);
                            if (textParts.length > 0) {
                                const newResponse = textParts.join('\n').trim();
                                if (newResponse && newResponse !== trimmedResponse) {
                                    response = newResponse;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log('[feishu-forward] 无法检查额外响应');
            }
        }
        const responseMsgs = splitMessage(response);
        for (const m of responseMsgs) {
            const trimmed = m.trim();
            if (!trimmed) continue;
            try {
                await adapter.reply(ctx.threadId, m);
            } catch (replyErr) {
                console.error('[feishu-forward] 回复失败:', replyErr.message);
            }
        }
        const filesCount = (session.modifiedFiles?.length || session.modifiedFiles?.size || 0);
        if (filesCount > 0) {
            try {
                const shareUrl = await shareSession(openCodeSession);
                if (shareUrl) {
                    await adapter.reply(ctx.threadId, `🔗 ${shareUrl}`);
                }
            } catch (e) {
                console.error('[feishu-forward] 分享会话失败:', e.message);
            }
        }
        if (hasToolActivity && projectDir) {
            const threadId = ctx.threadId;
            setTimeout(() => {
                autoFlush(adapter, threadId, session, openCodeSessions).catch(() => {});
            }, 2000);
        }
    } catch (error) {
        session.taskStartTime = null;
        session.currentTool = null;
        console.error('❌ Feishu 错误:', error);
        await adapter.reply(ctx.threadId, `❌ 错误: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}

export { handleMessage, forwardToOpenCode };
