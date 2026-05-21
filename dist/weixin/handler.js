import { getOrCreateSession, updateSession, loadSessionMapping, saveSessionMapping, getThreadsBySessionIdFromMapping, saveSessionCommandHistory, sessionManager } from '../core/session.js';
import { splitMessage } from '../core/notifications.js';
import { initOpenCode, createSession, sendMessage as sendToOpenCode, checkConnection, resumeSession, shareSession, forkSession } from '../opencode/client.js';
import { isAuthorized, hasOwner } from '../core/auth.js';
import { registry } from '../core/registry.js';
import { sendMessage as sendWeixinMessage } from './api.js';
import memoryManager from './memory-manager.js';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { autoFlush } from './adapter.js';
import { detectCommand, handleCommand, formatTimeAgo, _registerStartLoopCycle } from './commands.js';

async function startLoopCycle(adapter, ctx, openCodeSessions, session) {
    if (!session.loopMode) return;

    const now = Date.now();
    const iteration = (session.loopIterationCount || 0) + 1;
    const maxIterations = session.loopMaxIterations || 10;
    const maxTimeMs = session.loopMaxTimeMs || 30 * 60 * 1000;
    const startTime = session.loopStartTime || now;

    if (iteration > maxIterations) {
        session.loopMode = false;
        await adapter.reply(ctx.threadId, `⏹️ 循环任务已完成（达到最大迭代次数 ${maxIterations}）`);
        return;
    }

    if (now - startTime > maxTimeMs) {
        session.loopMode = false;
        await adapter.reply(ctx.threadId, `⏹️ 循环任务已停止（达到最大运行时长 ${Math.floor(maxTimeMs / 60000)}分钟）`);
        return;
    }

    if (session.lastUserMessage && now - session.lastUserMessage < 120000) {
        session.lastLoopTime = now;
        setTimeout(() => startLoopCycle(adapter, ctx, openCodeSessions, session), 30000);
        return;
    }

    session.loopIterationCount = iteration;
    const prompt = session.loopPrompt || '根据当前项目状态，继续推进未完成的工作';
    try {
        await adapter.reply(ctx.threadId, `🔄 循环执行 [${iteration}/${maxIterations}]: ${prompt}`);
        await forwardToOpenCode(adapter, ctx, prompt, openCodeSessions, session);
        session.lastLoopTime = now;
        setTimeout(() => startLoopCycle(adapter, ctx, openCodeSessions, session), 5 * 60 * 1000);
    } catch (e) {
        console.error('Loop cycle error:', e);
        session.loopMode = false;
        await adapter.reply(ctx.threadId, `❌ 循环任务因错误停止: ${e.message}`);
    }
}

_registerStartLoopCycle(startLoopCycle);

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
                console.warn(`[memory] Failed to load: ${e.message}`);
            }
            break;
        }
    }
    return null;
}

async function forwardToOpenCode(adapter, ctx, text, openCodeSessions, session) {
    adapter.sendTypingIndicator(ctx.threadId).catch(() => {});
    let openCodeSession = openCodeSessions.get(ctx.threadId);
    if (!openCodeSession) {
        if (session.opencodeSessionId) {
            openCodeSession = await resumeSession(session.opencodeSessionId);
        }
        if (!openCodeSession && globalThis.__latestOpenCodeSession?.id) {
            console.log('Connecting to latest OpenCode session...');
            openCodeSession = await resumeSession(globalThis.__latestOpenCodeSession.id);
        }
        if (!openCodeSession) {
            const mapping = loadSessionMapping();
            const saved = mapping[ctx.threadId];
            if (saved?.opencodeSessionId) {
                openCodeSession = await resumeSession(saved.opencodeSessionId);
            }
        }
        if (!openCodeSession) {
            console.log('Creating new WeChat session...');
            openCodeSession = await createSession(ctx.threadId, `Weixin ${ctx.threadId}`);
            if (!openCodeSession) {
                await adapter.reply(ctx.threadId, '❌ 无法创建 OpenCode 会话');
                return;
            }
            console.log(`✅ Created new WeChat session: ${openCodeSession.sessionId}`);
        }
        openCodeSessions.set(ctx.threadId, openCodeSession);
        session.opencodeSessionId = openCodeSession.sessionId;
        const key = `weixin:${ctx.threadId}:${ctx.threadId}`;
        sessionManager.saveSession(key, session).catch(() => {});
        saveSessionMapping();
    }

    if (session.modelOverride) {
        openCodeSession.model = session.modelOverride;
    }

    session.taskStartTime = Date.now();
    session.currentTool = null;
    
    let lastToolNotified = '';
    const stopHeartbeat = () => {
        session.taskStartTime = null;
        session.currentTool = null;
        if (session.modifiedFiles instanceof Set) {
            session.modifiedFiles = Array.from(session.modifiedFiles);
        }
    };
    
    console.log(`📤 Message sent: → ${text}`);

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
    }

    const autoMemory = memoryManager.getRelevantMemory(text);
    if (autoMemory) {
        scopedText = `【用户记忆/偏好】\n${autoMemory}\n\n${scopedText}`;
    }

    if (projectDir && !scopedText.includes('项目目录')) {
        scopedText = `[当前项目目录: ${projectDir}]\n\n${scopedText}`;
    }
    
    let response = '';
    let hasToolActivity = false;
    let idleTimer = null;
    let resolveIdle = null;
    const IDLE_TIMEOUT = 5000;

    const pokeIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (resolveIdle) resolveIdle();
        }, IDLE_TIMEOUT);
    };

    const idleDone = new Promise((resolve) => { resolveIdle = resolve; });
    pokeIdle();

    const taskDone = sendToOpenCode(openCodeSession, scopedText, {
        onEvent: (event) => {
            if (event.type === 'tool.call') {
                const props = event.properties || {};
                const toolName = props.name || props.tool_name || 'unknown';
                const input = props.input || {};

                hasToolActivity = true;

                let toolDesc = `🔧 执行工具: ${toolName}`;
                if (input.path) toolDesc += `\n📁 ${input.path}`;
                if (input.command) toolDesc += `\n💻 ${input.command}`;

                adapter.reply(ctx.threadId, toolDesc).catch(() => {});

                if (input.path) {
                    if (!session.modifiedFiles) session.modifiedFiles = new Set();
                    session.modifiedFiles.add(input.path);
                }
            }
            pokeIdle();
        },
        onTextDelta: (delta) => {
            response += delta;
            pokeIdle();
        },
        onStatusChange: (status) => {
            if (status.hasToolActivity) hasToolActivity = true;
            if (status.type === 'busy' || status.type === 'retry') pokeIdle();
        },
    }).catch((e) => {
        console.error('[forwardToOpenCode] Task error:', e.message);
    });

    await Promise.race([taskDone, idleDone]);
    clearTimeout(idleTimer);
    stopHeartbeat();

    const trimmedResponse = response.trim();
    if (!trimmedResponse) {
        await adapter.reply(ctx.threadId, 'AI 返回空响应，请重试');
        return;
    }

    if (trimmedResponse.startsWith('⏰') || trimmedResponse.startsWith('❌')) {
        console.error('[forwardToOpenCode] Error response:', trimmedResponse);
        await adapter.reply(ctx.threadId, trimmedResponse);
        return;
    }

    const responseMsgs = splitMessage(trimmedResponse);
    for (const m of responseMsgs) {
        const trimmed = m.trim();
        if (!trimmed) continue;
        try {
            await adapter.reply(ctx.threadId, m);
        } catch (replyErr) {
            console.error('[forwardToOpenCode] reply failed:', replyErr.message);
        }
    }

    if (hasToolActivity && projectDir) {
        setTimeout(() => {
            autoFlush(adapter, ctx.threadId, session, openCodeSessions).catch(() => {});
        }, 2000);
    }

    const allThreads = getThreadsBySessionIdFromMapping(openCodeSession.sessionId);
    for (const otherThreadId of allThreads) {
        if (otherThreadId === ctx.threadId) continue;
        const otherContextToken = adapter.contextTokens.get(otherThreadId);
        if (!otherContextToken) continue;
        try {
            await sendWeixinMessage({
                baseUrl: adapter._baseUrl,
                token: adapter._token,
                body: { msg: { from_user_id: adapter._botId, to_user_id: otherThreadId, client_id: `${Date.now()}-${randomBytes(8).toString('hex')}`, message_type: 2, message_state: 2, context_token: otherContextToken, item_list: [{ type: 1, text_item: { text: `[来自 ${ctx.threadId} 的会话]\n\n${response}` } }] } }
            });
        } catch (e) {
            console.error(`Failed to broadcast to ${otherThreadId}:`, e.message);
        }
    }

    const shareUrl = await shareSession(openCodeSession);
    const filesCount = (session.modifiedFiles?.length || session.modifiedFiles?.size || 0);
    if (filesCount > 0 && shareUrl) {
        try {
            await adapter.reply(ctx.threadId, `🔗 ${shareUrl}`);
        } catch (e) {
            console.error('[forwardToOpenCode] share URL reply failed:', e.message);
        }
    }

    saveSessionMapping();
}

async function handleMessage(adapter, ctx, text, openCodeSessions) {
    const session = await getOrCreateSession(ctx.threadId, 'weixin');
    const detected = detectCommand(text);
    if (detected) {
        const handled = await handleCommand(adapter, ctx, detected.name, detected.arg, openCodeSessions);
        if (handled) return;
    }

    if (!isAuthorized('weixin', ctx.userId)) {
        if (!hasOwner('weixin')) {
            await adapter.reply(ctx.threadId, '🔐 请先发送 /start 进行安全认证');
        } else {
            await adapter.reply(ctx.threadId, '🚫 你无权使用此 bot');
        }
        return;
    }

    if (session._deleteSessionList) {
        const trimmed = text.trim();
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= session._deleteSessionList.length) {
                const target = session._deleteSessionList[num - 1];
                try {
                    const opencode = await initOpenCode();
                    if (!opencode) {
                        await adapter.reply(ctx.threadId, '❌ 无法删除会话');
                        return;
                    }
                    await opencode.client.session.delete({ path: { id: target.id } });
                    if (session.opencodeSessionId === target.id) {
                        openCodeSessions.delete(ctx.threadId);
                        session.opencodeSessionId = undefined;
                        saveSessionMapping();
                    }
                    const result = await opencode.client.session.list();
                    if (!result.error && result.data) {
                        session._deleteSessionList = result.data;
                        if (result.data.length === 0) {
                            session._deleteSessionList = null;
                            await adapter.reply(ctx.threadId, `🗑️ 已删除: ${target.title || '无标题'}\n📭 没有更多会话了`);
                        } else {
                            let msg = `🗑️ 已删除: ${target.title || '无标题'}\n\n📂 选择要删除的会话（回复编号）：\n\n`;
                            result.data.forEach((s, i) => {
                                const n = i + 1;
                                const title = s.title || '无标题';
                                let status = '';
                                if (typeof s.status === 'string') status = s.status;
                                else if (s.status?.type) status = s.status.type;
                                const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                                msg += `${n}. ${title} (${status || '空闲'} ${time})\n`;
                            });
                            msg += '\n回复编号删除';
                            const msgs = splitMessage(msg);
                            for (const m of msgs) {
                                await adapter.reply(ctx.threadId, m);
                            }
                        }
                    } else {
                        session._deleteSessionList = null;
                        await adapter.reply(ctx.threadId, `🗑️ 已删除: ${target.title || '无标题'}`);
                    }
                } catch (e) {
                    await adapter.reply(ctx.threadId, `❌ 删除失败: ${e.message}`);
                }
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._deleteSessionList.length}`);
            }
            return;
        }
    }
    
    if (session._switchSessionList) {
        const trimmed = text.trim();
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= session._switchSessionList.length) {
                const target = session._switchSessionList[num - 1];
                if (session._showSessionState) {
                    session._showSessionState = null;
                    session._pendingSwitchSession = target;
                    const targetDir = target.directory || process.cwd();
                    let stateMsg = `📋 会话: ${target.title || '无标题'}\n`;
                    stateMsg += `ID: ${target.id.slice(0, 8)}...\n`;
                    if (target.directory) stateMsg += `📁 目录: ${target.directory}\n`;
                    stateMsg += '\n';
                    try {
                        const { readFileSync, existsSync } = await import('fs');
                        const { join } = await import('path');
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
                            const threadsMatch = content.match(/## 开放线程\n([\s\S]*?)(?=##|$)/);
                            if (threadsMatch && threadsMatch[1].trim()) {
                                stateMsg += `🔓 开放线程:\n${threadsMatch[1].trim().slice(0, 300)}\n\n`;
                            }
                        }
                        const today = new Date().toISOString().slice(0, 10);
                        const dailyLogPath = join(targetDir, 'daily-logs', `${today}.md`);
                        if (existsSync(dailyLogPath)) {
                            const logContent = readFileSync(dailyLogPath, 'utf-8');
                            const lastEntry = logContent.split('## ').pop();
                            if (lastEntry && lastEntry.trim()) {
                                stateMsg += `📅 今日日志:\n${lastEntry.trim().slice(0, 300)}`;
                            }
                        }
                    } catch { console.debug('[session-switch] Failed to read daily log'); }
                    stateMsg += `\n💡 回复 "确认" 切换到此会话，或回复其他内容取消`;
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
                        const key = `weixin:${ctx.userId}:${ctx.threadId}`;
                        sessionManager.saveSession(key, session).catch(() => {});
                        saveSessionMapping();
                        if (target.directory) {
                            session.projectDir = target.directory;
                            globalThis.__autoProjectDir = target.directory;
                            const { existsSync } = await import('fs');
                            const { join } = await import('path');
                            const memoryPath = join(target.directory, 'MEMORY.md');
                            if (!existsSync(memoryPath)) {
                                const { initMemorySystem } = await import('./init-memory.js');
                                await initMemorySystem(target.directory);
                                console.log(`Auto-initialized memory for: ${target.directory}`);
                            }
                        }
                        await adapter.reply(ctx.threadId, `✅ 已切换到: ${target.title || '无标题'}\nID: ${resumed.sessionId.slice(0, 8)}...`);
                    } else {
                        await adapter.reply(ctx.threadId, `❌ 切换失败`);
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
        const trimmed = text.trim().toLowerCase();
        const target = session._pendingSwitchSession;
        session._pendingSwitchSession = null;
        if (trimmed === '确认' || trimmed === 'confirm' || trimmed === 'y' || trimmed === '1') {
            try {
                const resumed = await resumeSession(target.id);
                if (resumed) {
                    openCodeSessions.set(ctx.threadId, resumed);
                    session.opencodeSessionId = resumed.sessionId;
                    session.taskStartTime = null;
                    session.currentTool = null;
                    session.modifiedFiles = null;
                    saveSessionMapping();
                    if (target.directory) {
                        session.projectDir = target.directory;
                        globalThis.__autoProjectDir = target.directory;
                        const { existsSync } = await import('fs');
                        const { join } = await import('path');
                        const memoryPath = join(target.directory, 'MEMORY.md');
                        if (!existsSync(memoryPath)) {
                            const { initMemorySystem } = await import('./init-memory.js');
                            await initMemorySystem(target.directory);
                            console.log(`Auto-initialized memory for: ${target.directory}`);
                        }
                    }
                    await adapter.reply(ctx.threadId, `✅ 已切换到: ${target.title || '无标题'}\nID: ${resumed.sessionId.slice(0, 8)}...`);
                } else {
                    await adapter.reply(ctx.threadId, `❌ 切换失败`);
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 切换失败: ${e.message}`);
            }
            return;
        }
        await adapter.reply(ctx.threadId, '已取消切换');
        return;
    }
    
    if (session._historyList) {
        const trimmed = text.trim();
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= session._historyList.length) {
                const cmd = session._historyList[session._historyList.length - num];
                session._historyList = null;
                session._lastPrompt = cmd;
                await forwardToOpenCode(adapter, ctx, cmd, openCodeSessions, session);
                return;
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._historyList.length}`);
                return;
            }
        }
        session._historyList = null;
    }
    
    if (session._forkList) {
        const trimmed = text.trim();
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= session._forkList.length) {
                const targetMsg = session._forkList[num - 1];
                const forked = await forkSession(session._forkSessionId, targetMsg.id, session.projectDir);
                session._forkList = null;
                session._forkSessionId = null;
                if (forked) {
                    openCodeSessions.set(ctx.threadId, forked);
                    session.opencodeSessionId = forked.sessionId;
                    session.taskStartTime = null;
                    session.currentTool = null;
                    session.modifiedFiles = null;
                    saveSessionMapping();
                    await adapter.reply(ctx.threadId, `🔀 已从消息 #${num} 创建分支\n\n新会话: ${forked.sessionId.slice(0, 8)}...\n之前的上下文已保留`);
                } else {
                    await adapter.reply(ctx.threadId, '❌ 分支失败');
                }
                return;
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._forkList.length}`);
                return;
            }
        }
        session._forkList = null;
        session._forkSessionId = null;
    }
    
    if (session._editList) {
        const trimmed = text.trim();
        if (/^\d+$/.test(trimmed)) {
            const num = parseInt(trimmed, 10);
            if (num >= 1 && num <= session._editList.length) {
                const targetMsg = session._editList[num - 1];
                const preview = targetMsg.info?.content?.slice(0, 80) || '(空)';
                session._editTarget = { sessionId: session._editSessionId, messageID: targetMsg.id, num };
                session._editList = null;
                session._editSessionId = null;
                await adapter.reply(ctx.threadId, `✏️ 选择修改消息 #${num}：\n\n${preview}\n\n请发送修正后的内容，将从该消息之前创建新分支`);
                return;
            } else {
                await adapter.reply(ctx.threadId, `❌ 无效编号，请输入 1-${session._editList.length}`);
                return;
            }
        }
        session._editList = null;
        session._editSessionId = null;
    }
    
    if (session._editTarget) {
        const target = session._editTarget;
        session._editTarget = null;
        const forked = await forkSession(target.sessionId, target.messageID, session.projectDir);
        if (forked) {
            openCodeSessions.set(ctx.threadId, forked);
            session.opencodeSessionId = forked.sessionId;
            session.taskStartTime = null;
            session.currentTool = null;
            session.modifiedFiles = null;
            saveSessionMapping();
            await adapter.reply(ctx.threadId, `✅ 已创建新分支并发送修正内容\n\n从消息 #${target.num} 之前分支，发送了新提示`);
            await forwardToOpenCode(adapter, ctx, text, openCodeSessions, session);
        } else {
            await adapter.reply(ctx.threadId, '❌ 分支失败');
        }
        return;
    }
    
    if (session._analyzeMode) {
        const trimmed = text.trim().toLowerCase();
        if (trimmed === '执行' || trimmed === 'execute' || trimmed === '开始' || trimmed === 'go') {
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
    }
    
    const connected = await checkConnection();
    if (!connected) {
        await adapter.reply(ctx.threadId, '❌ OpenCode 离线，请检查服务是否运行');
        return;
    }
    
    const rememberKeywords = ['记住', '记录', '记下', '以后', '偏好', '习惯'];
    const deleteKeywords = ['删除', '忘记', '取消', '抹掉', '清除'];
    
    const hasRememberKeyword = rememberKeywords.some(kw => text.includes(kw));
    const hasDeleteKeyword = deleteKeywords.some(kw => text.includes(kw));
    
    if (hasDeleteKeyword && hasRememberKeyword) {
        let query = text.replace(/删除|忘记|取消|抹掉|清除|记忆|记录|关于|那个/g, '').trim();
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
            await adapter.reply(ctx.threadId, `🗑️ 已清空所有用户偏好记忆`);
            return;
        }
    } else if (hasRememberKeyword) {
        if (text.length > 2 && text.length < 500) {
            memoryManager.saveMemory('prefs', { content: text });
            console.log(`[memory] Saved user preference: ${text}`);
        }
    }
    
    if (!session.commandHistory) {
        session.commandHistory = [];
    }
    session.commandHistory.push(text);
    if (session.commandHistory.length > 50) {
        session.commandHistory = session.commandHistory.slice(-50);
    }
    
    await saveSessionCommandHistory(ctx.threadId, session.commandHistory);

    session.lastUserMessage = Date.now();
    session._lastPrompt = text;

    if (session.currentAgent && session.currentAgent !== 'opencode') {
        const agent = registry.findAgent(session.currentAgent);
        if (agent) {
            const available = await agent.isAvailable().catch(() => false);
            if (available) {
                await adapter.sendTyping?.(ctx.threadId, true);
                try {
                    const response = await agent.sendPrompt(session.id, text, session.commandHistory || [], { projectDir: session.projectDir || globalThis.__autoProjectDir });
                    await adapter.sendTyping?.(ctx.threadId, false);
                    const chunks = splitMessage(response || '无响应');
                    for (const chunk of chunks) {
                        await adapter.reply(ctx.threadId, chunk);
                    }
                } catch (error) {
                    await adapter.reply(ctx.threadId, `❌ ${session.currentAgent} 错误: ${error.message}`);
                }
                return;
            }
        }
    }

    await forwardToOpenCode(adapter, ctx, text, openCodeSessions, session);
}

export { handleMessage, forwardToOpenCode, startLoopCycle };
