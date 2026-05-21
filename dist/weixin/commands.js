import { detectCommand, COMMAND_ALIASES } from '../core/router.js';
import { getOrCreateSession, saveSessionMapping, sessionManager } from '../core/session.js';
import { splitMessage } from '../core/notifications.js';
import { initOpenCode, checkConnection, abortSession, resumeSession, revertSessionMessage, unrevertSession, listProviders, updateGlobalModel } from '../opencode/client.js';
import { claimOwnership } from '../core/auth.js';
import { registry } from '../core/registry.js';
import { uploadToQiniu, findBuildOutputs, formatSize, deleteFromQiniu } from './qiniu-upload.js';
import { initMemorySystem } from './init-memory.js';
import { existsSync } from 'fs';
import { join, basename } from 'path';

export let _startLoopCycle = null;
export function _registerStartLoopCycle(fn) { _startLoopCycle = fn; }

async function handleAgentSwitch(adapter, ctx, agentName, prompt) {
    const agent = registry.findAgent(agentName);

    if (!agent) {
        await adapter.reply(ctx.threadId, `❌ Agent "${agentName}" 未找到`);
        return true;
    }

    const available = await agent.isAvailable().catch(() => false);
    if (!available) {
        await adapter.reply(ctx.threadId, `❌ ${agentName} 不可用`);
        return true;
    }

    const session = await getOrCreateSession(ctx.threadId, 'weixin');
    session.currentAgent = agentName;

    if (!prompt) {
        try {
            await adapter.reply(ctx.threadId, `✅ 已切换到 ${agentName}`);
        } catch (e) {
            console.error(`[handleAgentSwitch] reply failed: ${e.message}`);
        }
        saveSessionMapping();
        return true;
    }

    await adapter.sendTyping?.(ctx.threadId, true);

    try {
        const history = session.commandHistory || [];
        const response = await agent.sendPrompt(session.id, prompt, history, { projectDir: session.projectDir || globalThis.__autoProjectDir });

        await adapter.sendTyping?.(ctx.threadId, false);

        const chunks = splitMessage(response || '无响应');
        for (const chunk of chunks) {
            await adapter.reply(ctx.threadId, chunk);
        }

        session.commandHistory = session.commandHistory || [];
        session.commandHistory.push(prompt);
        saveSessionMapping();

    } catch (error) {
        await adapter.sendTyping?.(ctx.threadId, false);
        await adapter.reply(ctx.threadId, `❌ 错误: ${error.message}`);
    }
    
    return true;
}

function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}秒前`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
}

async function handleCommand(adapter, ctx, command, arg, openCodeSessions) {
    const session = await getOrCreateSession(ctx.threadId, 'weixin');
    switch (command) {
        case 'start': {
            const result = claimOwnership('weixin', ctx.userId);
            if (result.success) {
                if (result.message === 'claimed') {
                    await adapter.reply(ctx.threadId, `🔐 安全设置完成！你是此 bot 的唯一所有者。\n\n发送消息给 OpenCode 开始工作\n/help 查看指令\n/status 查看状态`);
                } else {
                    await adapter.reply(ctx.threadId, `🚀 准备就绪\n\n发送消息给 OpenCode 开始工作\n/help 查看指令`);
                }
            } else {
                await adapter.reply(ctx.threadId, '🚫 你无权使用此 bot');
            }
            return true;
        }
        case 'help':
            await adapter.reply(ctx.threadId, `📖 指令

/start — 首次认证
/help h ? — 帮助
/status — 查看状态
/reset — 重置会话
/restart — 重启 bot
/stop — 中断任务

🤖 AI Agent:
/oc — 使用 OpenCode
/cc — 使用 Claude Code
/cx — 使用 Codex
/copilot — 使用 Copilot
/agents — 查看可用 Agent

🧠 模型:
/model — 查看当前模型
/model <provider/model> — 切换模型

⬆️ 上传:
/upload — 上传安装包
/delete <key> — 删除文件

💬 直接发消息给 AI!`);
            return true;
                case 'status': {
                    const connected = await checkConnection();
                    const running = session.taskStartTime ? Math.round((Date.now() - session.taskStartTime) / 1000) : 0;

                    let msg = `${connected ? '✅' : '❌'} OpenCode ${connected ? '在线' : '离线'}\n\n`;

                    const actualSession = openCodeSessions?.get(ctx.threadId) ||
                                         (session.opencodeSessionId ? { sessionId: session.opencodeSessionId } : null);

                    msg += `会话: ${actualSession?.sessionId?.slice(0, 8) || '无'}\n`;

                    if (running > 0) {
                        const m = Math.floor(running / 60);
                        const s = running % 60;
                        msg += `运行中: ${m}分${s}秒\n`;
                    }
                    if (session.currentTool) {
                        msg += `当前: ${session.currentTool}\n`;
                    }
                    if (session.modifiedFiles?.length > 0 || session.modifiedFiles?.size > 0) {
                        msg += `已修改: ${(session.modifiedFiles?.length || session.modifiedFiles?.size || 0)} 个文件\n`;
                    }

                    const projectDir = session.projectDir || globalThis.__autoProjectDir;
                    if (projectDir) {
                        msg += `项目目录: ${projectDir}\n`;
                    } else {
                        msg += `项目目录: 未设置\n`;
                    }

                    const workDir = process.cwd();
                    msg += `工作目录: ${workDir}\n`;

                    if (session.originalProjectDir && session.originalProjectDir !== projectDir) {
                        msg += `原始目录: ${session.originalProjectDir}\n`;
                    }

                    await adapter.reply(ctx.threadId, msg);
                    return true;
                }

                case 'sessions': {
                    try {
                        const opencode = await initOpenCode();
                        if (!opencode) {
                            await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                            return true;
                        }
                        const result = await opencode.client.session.list();
                        if (result.error || !result.data || result.data.length === 0) {
                            await adapter.reply(ctx.threadId, '📭 暂无会话');
                            return true;
                        }
                        const sorted = result.data.sort((a, b) => (b.time.updated || 0) - (a.time.updated || 0));
                        session._switchSessionList = sorted;
                        session._showSessionState = true;
                        let msg = '📂 选择会话（回复编号）：\n\n';
                        sorted.slice(0, 10).forEach((s, i) => {
                            const n = i + 1;
                            const title = s.title || '无标题';
                            const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                            msg += `${n}. ${title} (${time})\n`;
                        });
                        if (sorted.length > 10) {
                            msg += `\n... 共 ${sorted.length} 个会话`;
                        }
                        msg += '\n\n回复编号切换会话';
                        await adapter.reply(ctx.threadId, msg);
                    } catch (e) {
                        await adapter.reply(ctx.threadId, `❌ 获取会话失败: ${e.message}`);
                    }
                    return true;
                }

                case 'delsessions': {
                    try {
                        const opencode = await initOpenCode();
                        if (!opencode) {
                            await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                            return true;
                        }
                        const result = await opencode.client.session.list();
                        if (result.error || !result.data || result.data.length === 0) {
                            await adapter.reply(ctx.threadId, '📭 暂无会话可删除');
                            return true;
                        }
                        const sorted = result.data.sort((a, b) => (b.time.updated || 0) - (a.time.updated || 0));
                        session._deleteSessionList = sorted;
                        let msg = '🗑️ 选择要删除的会话（回复编号）：\n\n';
                        sorted.slice(0, 10).forEach((s, i) => {
                            const n = i + 1;
                            const title = s.title || '无标题';
                            const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                            msg += `${n}. ${title} (${time})\n`;
                        });
                        if (sorted.length > 10) {
                            msg += `\n... 共 ${sorted.length} 个会话`;
                        }
                        msg += '\n\n回复编号删除';
                        await adapter.reply(ctx.threadId, msg);
                    } catch (e) {
                        await adapter.reply(ctx.threadId, `❌ 获取会话失败: ${e.message}`);
                    }
                    return true;
                }


                case 'copy': {
            const ocSession = openCodeSessions.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            
            const msgsResult = await ocSession.client.session.messages({ 
                path: { id: ocSession.sessionId },
                query: { limit: 1 }
            });
            
            if (msgsResult.error || !msgsResult.data || msgsResult.data.length === 0) {
                await adapter.reply(ctx.threadId, '❌ 无法获取最新消息');
                return true;
            }
            
            let latestMsg = msgsResult.data[0];
            if (latestMsg.info.role !== 'assistant') {
                await adapter.reply(ctx.threadId, 'ℹ️ 最新消息不是 AI 回复，正在获取上一条 AI 消息...');

                const allMsgsResult = await ocSession.client.session.messages({
                    path: { id: ocSession.sessionId },
                    query: { limit: 10 }
                });

                if (allMsgsResult.error || !allMsgsResult.data) {
                    await adapter.reply(ctx.threadId, '❌ 无法获取会话消息');
                    return true;
                }

                const aiMsg = allMsgsResult.data.find(m => m.info.role === 'assistant');
                if (!aiMsg) {
                    await adapter.reply(ctx.threadId, '❌ 未找到 AI 回复');
                    return true;
                }
                latestMsg = aiMsg;
            }
            
            let content = '';
            if (latestMsg.parts) {
                for (const part of latestMsg.parts) {
                    if (part.type === 'text') {
                        content += part.text + '\n';
                    }
                    if (part.type === 'code') {
                        content += `\`\`\`${part.language || ''}\n${part.code}\n\`\`\`\n`;
                    }
                    if (part.type === 'file' && part.content) {
                        content += `📁 ${part.filename}:\n${part.content}\n`;
                    }
                }
            }
            
            if (!content.trim()) {
                await adapter.reply(ctx.threadId, '❌ AI 回复中没有可复制的文本内容');
                return true;
            }
            
            await adapter.reply(ctx.threadId, `📋 已复制最新 AI 回复内容:\n\n${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}`);
            return true;
        }

        case 'resume': {
            try {
                const opencode = await initOpenCode();
                const result = await opencode.client.session.list();
                if (!result.data || result.data.length === 0) {
                    await adapter.reply(ctx.threadId, '❌ 没有找到会话');
                    return true;
                }

                const sorted = result.data.sort((a, b) => (b.time.updated || 0) - (a.time.updated || 0));
                const latest = sorted[0];

                const resumed = await resumeSession(latest.id);
                if (!resumed) {
                    await adapter.reply(ctx.threadId, '❌ 恢复会话失败');
                    return true;
                }

                openCodeSessions.set(ctx.threadId, resumed);
                session.opencodeSessionId = resumed.sessionId;
                const key = `weixin:${ctx.userId}:${ctx.threadId}`;
                sessionManager.saveSession(key, session).catch(() => {});
                saveSessionMapping();

                if (latest.directory) {
                    session.projectDir = latest.directory;
                    globalThis.__autoProjectDir = latest.directory;
                    
                    const { existsSync } = await import('fs');
                    const { join } = await import('path');
                    const memoryPath = join(latest.directory, 'MEMORY.md');
                    if (!existsSync(memoryPath)) {
                        const { initMemorySystem } = await import('./init-memory.js');
                        await initMemorySystem(latest.directory);
                        console.log('Memory system initialized.');
                    }
                }
                
                await adapter.reply(ctx.threadId, `✅ 已恢复最近会话\n\n会话: ${latest.title || 'Untitled'}\n📁 目录: ${latest.directory || 'N/A'}\n📝 更新: ${new Date(latest.time.updated).toLocaleString()}`);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 恢复失败: ${e.message}`);
            }
            return true;
        }
        case 'edit': {
            const ocSession = openCodeSessions.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            if (arg) {
                const num = parseInt(arg, 10);
                if (num >= 1) {
                    try {
                        const opencode = await initOpenCode();
                        const msgsResult = await opencode.client.session.messages({ path: { id: ocSession.sessionId } });
                        if (!msgsResult.error && msgsResult.data) {
                            const userMsgs = msgsResult.data.filter(m => m.info?.role === 'user');
                            if (num <= userMsgs.length) {
                                const targetMsg = userMsgs[num - 1];
                                const preview = targetMsg.info?.content?.slice(0, 80) || '(空)';
                                session._editTarget = { sessionId: ocSession.sessionId, messageID: targetMsg.id, num };
                                await adapter.reply(ctx.threadId, `✏️ 选择修改消息 #${num}：\n\n${preview}\n\n请发送修正后的内容，将从该消息之前创建新分支`);
                                return true;
                            }
                        }
                    } catch (e) {
                        await adapter.reply(ctx.threadId, `❌ 操作失败: ${e.message}`);
                        return true;
                    }
                }
                await adapter.reply(ctx.threadId, `❌ 无效编号`);
                return true;
            }
            const opencode = await initOpenCode();
            if (!opencode) {
                await adapter.reply(ctx.threadId, '❌ 无法获取消息');
                return true;
            }
            const msgsResult = await opencode.client.session.messages({ path: { id: ocSession.sessionId } });
            if (msgsResult.error || !msgsResult.data) {
                await adapter.reply(ctx.threadId, '❌ 无法获取消息');
                return true;
            }
            const userMsgs = msgsResult.data.filter(m => m.info?.role === 'user');
            if (userMsgs.length === 0) {
                await adapter.reply(ctx.threadId, '📭 没有用户消息可编辑');
                return true;
            }
            let msg = '✏️ 选择要修改的消息（回复编号）：\n\n';
            const showCount = Math.min(userMsgs.length, 15);
            const startIdx = userMsgs.length - showCount;
            for (let i = startIdx; i < userMsgs.length; i++) {
                const m = userMsgs[i];
                const num = i + 1;
                const preview = m.info?.content?.slice(0, 60) || '(空)';
                msg += `${num}. ${preview}\n`;
            }
            if (userMsgs.length > 15) {
                msg += `\n... 共 ${userMsgs.length} 条消息`;
            }
            session._editList = userMsgs;
            session._editSessionId = ocSession.sessionId;
            const msgs = splitMessage(msg);
            for (const m of msgs) {
                await adapter.reply(ctx.threadId, m);
            }
            return true;
        }
        case 'revert': {
            const ocS = openCodeSessions.get(ctx.threadId);
            if (!ocS) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            if (arg === 'undo') {
                const ok = await unrevertSession(ocS.sessionId);
                if (ok) {
                    await adapter.reply(ctx.threadId, '↩️ 已恢复撤销的内容');
                } else {
                    await adapter.reply(ctx.threadId, '❌ 恢复失败');
                }
                return true;
            }
            const opencode = await initOpenCode();
            if (!opencode) {
                await adapter.reply(ctx.threadId, '❌ 无法获取消息');
                return true;
            }
            const msgsResult = await opencode.client.session.messages({ path: { id: ocS.sessionId } });
            if (msgsResult.error || !msgsResult.data) {
                await adapter.reply(ctx.threadId, '❌ 无法获取消息');
                return true;
            }
            const assistantMsgs = msgsResult.data.filter(m => m.info?.role === 'assistant' && m.time?.created);
            if (assistantMsgs.length === 0) {
                await adapter.reply(ctx.threadId, '📭 没有可撤销的消息');
                return true;
            }
            const lastMsg = assistantMsgs[assistantMsgs.length - 1];
            const ok = await revertSessionMessage(ocS.sessionId, lastMsg.id);
            if (ok) {
                const preview = lastMsg.info?.content?.slice(0, 100) || '(无内容)';
                await adapter.reply(ctx.threadId, `↩️ 已撤销最近的消息\n\n${preview}\n\n发送 /revert undo 恢复`);
            } else {
                await adapter.reply(ctx.threadId, '❌ 撤销失败');
            }
            return true;
        }
        case 'loop': {
            const argText = arg || '';
            if (argText === 'off' || argText === 'stop') {
                session.loopMode = false;
                session.loopPrompt = null;
                session.loopIterationCount = 0;
                session.loopStartTime = null;
                saveSessionMapping();
                await adapter.reply(ctx.threadId, '⏹️ 循环任务已停止');
                return true;
            }
            if (argText === 'status') {
                if (session.loopMode) {
                    const elapsed = session.loopStartTime
                        ? `已运行: ${Math.floor((Date.now() - session.loopStartTime) / 60000)}分钟`
                        : '';
                    const count = session.loopIterationCount || 0;
                    const limit = session.loopMaxIterations || 10;
                    await adapter.reply(ctx.threadId, `🔄 循环任务运行中\n指令: ${session.loopPrompt || '智能模式'}\n迭代: ${count}/${limit} ${elapsed}`);
                } else {
                    await adapter.reply(ctx.threadId, '⏹️ 循环任务未运行\n发送 /loop 开始');
                }
                return true;
            }
            session.loopMode = true;
            session.loopPrompt = argText || null;
            session.lastLoopTime = Date.now();
            session.loopStartTime = Date.now();
            session.loopIterationCount = 0;
            session.loopMaxIterations = 10;
            session.loopMaxTimeMs = 30 * 60 * 1000;
            saveSessionMapping();
            const modeDesc = argText ? `指令: ${argText}` : '智能模式（根据上下文自动生成指令）';
            await adapter.reply(ctx.threadId, `🔄 循环任务已启动\n${modeDesc}\n限制: 最多10次迭代或30分钟\n\n发送 /loop off 停止`);
            if (_startLoopCycle) {
                _startLoopCycle(adapter, ctx, openCodeSessions, session);
            }
            return true;
        }

        case 'restart': {
            console.log('[bot] restart command received');
            await adapter.reply(ctx.threadId, '🔄 正在重启 bot...');
            const fs = await import('fs');
            const remoteDir = join(process.env.HOME || process.cwd(), '.opencode-remote');
            if (!fs.existsSync(remoteDir)) {
                fs.mkdirSync(remoteDir, { recursive: true });
            }
            const restartInfo = { threadId: ctx.threadId, time: Date.now() };
            fs.writeFileSync(join(remoteDir, '.restart_user.json'), JSON.stringify(restartInfo));
            console.log('[bot] reply sent, waiting...');
            await new Promise(r => setTimeout(r, 500));
            console.log('[bot] about to exit with code 200');
            process.exit(200);
            return true;
        }

        case 'stop': {
            await adapter.reply(ctx.threadId, '🛑 正在停止 bot...');
            setTimeout(() => {
                if (globalThis.__weixinBotShutdown) {
                    globalThis.__weixinBotShutdown(false);
                }
                setTimeout(() => process.exit(0), 1000);
            }, 500);
            return true;
        }

        case 'upload': {
            const projectDir = session.projectDir || globalThis.__autoProjectDir;

            if (arg && arg.trim()) {
                const filePath = arg.trim();

                let fullPath = filePath;
                if (!existsSync(fullPath) && projectDir) {
                    fullPath = join(projectDir, filePath);
                }

                if (!existsSync(fullPath)) {
                    await adapter.reply(ctx.threadId, `❌ 文件不存在: ${filePath}`);
                    return true;
                }

                await adapter.reply(ctx.threadId, `⬆️ 正在上传: ${basename(fullPath)}...`);

                try {
                    const result = await uploadToQiniu(fullPath);
                    if (result.skipped) {
                        await adapter.reply(ctx.threadId, `⏭️ 文件已存在，不需要重复上传，你是要删除吗?\n/delete ${result.key}`);
                    } else {
                        await adapter.reply(ctx.threadId, result.url);
                        await adapter.reply(ctx.threadId, `/delete ${result.key}`);
                    }
                } catch (e) {
                    await adapter.reply(ctx.threadId, `❌ 上传失败: ${e.message}`);
                }
                return true;
            }

            if (!projectDir) {
                await adapter.reply(ctx.threadId, '❌ 未设置项目目录，请先设置项目目录或指定完整文件路径\n\n用法:\n/upload <文件路径>');
                return true;
            }

            await adapter.reply(ctx.threadId, '🔍 正在搜索构建产物...');

            const files = findBuildOutputs(projectDir);

            if (files.length === 0) {
                await adapter.reply(ctx.threadId, '❌ 未找到任何构建产物\n\n请指定完整文件路径，例如: /upload build/app.apk');
                return true;
            }

            const displayFiles = files.slice(0, 10);
            let listMsg = `📦 找到 ${files.length} 个构建产物:\n\n`;
            for (let i = 0; i < displayFiles.length; i++) {
                const f = displayFiles[i];
                listMsg += `${i + 1}. ${f.name}\n`;
                listMsg += `   📍 ${f.relativePath}\n`;
                listMsg += `   📊 ${formatSize(f.size)}\n\n`;
            }
            if (files.length > 10) {
                listMsg += `...还有 ${files.length - 10} 个文件`;
            }
            listMsg += `\n正在上传最新的: ${files[0].name}`;
            await adapter.reply(ctx.threadId, listMsg);

            const targetFile = files[0];

            try {
                const result = await uploadToQiniu(targetFile.path);
                if (result.skipped) {
                    await adapter.reply(ctx.threadId, `⏭️ 文件已存在，不需要重复上传，你是要删除吗?\n/delete ${result.key}`);
                } else {
                    await adapter.reply(ctx.threadId, result.url);
                    await adapter.reply(ctx.threadId, `/delete ${result.key}`);
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 上传失败: ${e.message}`);
            }
            return true;
        }

        case 'reset': {
            const oldSession = openCodeSessions?.get(ctx.threadId);
            if (oldSession) {
                abortSession(oldSession).catch(() => {});
            }
            session.pendingApprovals = [];
            session.opencodeSessionId = null;
            session.loopMode = false;
            session.loopPrompt = null;
            session.projectDir = null;
            session.currentAgent = null;
            session.messages = [];
            session.commandHistory = [];
            session.taskStartTime = null;
            session.currentTool = null;
            session.modifiedFiles = null;
            session.lastUserMessage = null;
            session._lastPrompt = null;
            session._contextScope = null;
            session.originalProjectDir = null;
            session._switchSessionList = null;
            session._deleteSessionList = null;
            session._pendingSwitchSession = null;
            session._editTarget = null;
            session._editList = null;
            session._editSessionId = null;
            session._historyList = null;
            session._forkList = null;
            session._forkSessionId = null;
            session._analyzeMode = false;
            session._analyzeTask = null;
            session._showSessionState = null;
            session.id = `${Date.now()}-${ctx.threadId}-reset`;
            openCodeSessions?.delete(ctx.threadId);
            globalThis.__latestOpenCodeSession = null;
            saveSessionMapping();
            await adapter.reply(ctx.threadId, '🔄 会话已重置，下次发送消息将创建新会话');
            return true;
        }

        case 'refresh': {
            const ocSession = openCodeSessions.get(ctx.threadId);
            if (!ocSession) {
                await adapter.reply(ctx.threadId, '❌ 没有活跃的会话');
                return true;
            }
            await adapter.reply(ctx.threadId, '🔄 正在刷新会话...');
            try {
                await ocSession.client.session.compact({ path: { id: ocSession.sessionId } });
                await ocSession.client.session.summarize({ path: { id: ocSession.sessionId } });
                await adapter.reply(ctx.threadId, '✅ 会话已刷新');
            } catch (e) {
                await adapter.reply(ctx.threadId, '✅ 会话已刷新');
            }
            return true;
        }

        case 'delete': {
            const keyToDelete = arg ? arg.trim() : null;

            if (!keyToDelete) {
                await adapter.reply(ctx.threadId, '❌ 请指定要删除的文件key\n\n用法: /delete <file-key>\n\n文件key是上传后URL中的路径，如:\n/uploads/1234567890-app.apk');
                return true;
            }

            const cleanKey = keyToDelete.replace(/^\//, '');
            if (!cleanKey.startsWith('uploads/')) {
                await adapter.reply(ctx.threadId, '❌ 无效的文件key，应以 uploads/ 开头');
                return true;
            }

            await adapter.reply(ctx.threadId, `🗑️ 正在删除: ${cleanKey}...`);

            try {
                await deleteFromQiniu(cleanKey);
                await adapter.reply(ctx.threadId, `✅ 已删除: ${cleanKey}`);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 删除失败: ${e.message}`);
            }
            return true;
        }

        case 'oc':
        case 'cc':
        case 'cx':
        case 'copilot': {
            const agentName = command === 'cc' ? 'claude-code' :
                              command === 'cx' ? 'codex' :
                              command === 'copilot' ? 'copilot' : 'opencode';
            const result = await handleAgentSwitch(adapter, ctx, agentName, arg);
            return result;
        }

        case 'agents': {
            const agents = registry.listAgents();
            const lines = ['🤖 可用 AI Agent:'];
            for (const a of agents) {
                const agent = registry.findAgent(a);
                const available = await agent?.isAvailable().catch(() => false);
                lines.push(`${available ? '✅' : '❌'} ${a}`);
            }
            lines.push('', '切换: /oc /cc /cx /copilot');
            await adapter.reply(ctx.threadId, lines.join('\n'));
            return true;
        }

        case 'model': {
            try {
                const opencode = await initOpenCode();
                if (!opencode) {
                    await adapter.reply(ctx.threadId, '❌ 无法连接 OpenCode');
                    return true;
                }
                if (arg) {
                    const modelStr = arg.trim();
                    const ok = await updateGlobalModel(modelStr);
                    if (ok) {
                        const parts = modelStr.split('/');
                        if (parts.length === 2) {
                            session.modelOverride = { providerID: parts[0], modelID: parts[1] };
                        }
                        await adapter.reply(ctx.threadId, `✅ 已切换模型至: ${modelStr}`);
                    } else {
                        await adapter.reply(ctx.threadId, `❌ 切换模型失败，请检查模型名称是否正确`);
                    }
                    return true;
                }
                const providers = await listProviders();
                if (!providers || providers.length === 0) {
                    await adapter.reply(ctx.threadId, '❌ 无法获取模型列表');
                    return true;
                }
                let msg = '🧠 可用模型:\n\n';
                for (const p of providers) {
                    const modelIds = Object.keys(p.models || {});
                    if (modelIds.length === 0) continue;
                    msg += `${p.name} (${p.id}):\n`;
                    for (const mid of modelIds.slice(0, 8)) {
                        const m = p.models[mid];
                        const tags = [];
                        if (m.reasoning) tags.push('推理');
                        if (m.attachment) tags.push('附件');
                        msg += `  ${p.id}/${mid}${tags.length ? ` (${tags.join(', ')})` : ''}\n`;
                    }
                    if (modelIds.length > 8) msg += `  ...还有 ${modelIds.length - 8} 个\n`;
                    msg += '\n';
                }
                msg += '用法: /model <provider/model>';
                const msgs = splitMessage(msg);
                for (const m of msgs) {
                    await adapter.reply(ctx.threadId, m);
                }
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 模型操作失败: ${e.message}`);
            }
            return true;
        }



        default:
            return false;
    }
}

export { handleAgentSwitch, handleCommand, formatTimeAgo };
