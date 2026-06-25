import { getHelpText } from '../core/router.js';
import { splitMessage } from '../core/notifications.js';
import { abortSession, initOpenCode, listProviders, getThreadModel, setThreadModel, getRecentModels, setRawDebug, isRawDebug, createSession } from '../opencode/client.js';
import { claimOwnership, hasOwner } from '../core/auth.js';
import { registry } from '../core/registry.js';
import { deleteFromQiniu } from '../core/qiniu.js';
import { formatInfo, incr, incrKey } from '../core/stats.js';
import { listAgentProcesses } from '../core/agent-registry.js';
import { threadHistory } from '../core/state.js';
import { join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { DEFAULT_BASE_URL } from './types.js';
import { threadAgent } from '../core/state.js';
import { userAdapterMap } from './user-adapter-map.js';

// 共享会话
export const sharedRoom = {
    session: null,
    members: new Set(),
    busy: false,
};
export function isSharedMember(threadId) {
    return sharedRoom.members.has(threadId);
}
export function addSharedMember(threadId) {
    sharedRoom.members.add(threadId);
}
export function removeSharedMember(threadId) {
    sharedRoom.members.delete(threadId);
}

// 线程级活跃 agent 追踪
export { threadAgent };

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

    if (!prompt) {
        try {
            if (agentName === 'opencode') {
                threadAgent.delete(ctx.threadId);
                await adapter.reply(ctx.threadId, `✅ 已切换回 OpenCode`);
            } else {
                threadAgent.set(ctx.threadId, agentName);
                await adapter.reply(ctx.threadId, `✅ 已切换到 ${agentName}，后续消息将路由至 ${agentName}`);
            }
        } catch (e) {
            console.error(`[handleAgentSwitch] reply failed: ${e.message}`);
        }
        return true;
    }

    // 有 prompt 时也设置活跃 agent
    if (agentName === 'opencode') {
        threadAgent.delete(ctx.threadId);
    } else {
        threadAgent.set(ctx.threadId, agentName);
    }

    // 兼容旧版 -c 前缀（清理历史中残留的 -c）
    const cleanPrompt = prompt.replace(/^-c\s+/, '').trim();

    adapter.sendTypingIndicator(ctx.threadId).catch(() => {});

    // 传入 threadHistory 让对话有上下文
    const history = threadHistory.get(ctx.threadId) || [];
    const recentHistory = history.slice(-20);

    try {
        const response = await agent.sendPrompt(agentName, cleanPrompt, recentHistory, { projectDir: globalThis.__autoProjectDir, threadId: ctx.threadId });

        // 更新历史（用清理后的 prompt）
        history.push({ role: 'user', content: cleanPrompt }, { role: 'assistant', content: response || '' });
        threadHistory.set(ctx.threadId, history);

        const chunks = splitMessage(response || '无响应');
        for (const chunk of chunks) {
            await adapter.reply(ctx.threadId, chunk);
        }

    } catch (error) {
        await adapter.sendTyping?.(ctx.threadId, false);
        await adapter.reply(ctx.threadId, `❌ 错误: ${error.message}`);
    }
    
    return true;
}

async function handleCommand(adapter, ctx, platform, command, arg, openCodeSessions) {
    // Count this command invocation
    incr('messagesSent');
    incrKey('commandsByType', command);

    const session = {};
    switch (command) {
        case 'start': {
            const result = claimOwnership(platform, ctx.userId);
            if (result.success) {
                if (result.message === 'claimed') {
                    await adapter.reply(ctx.threadId, `🔐 安全设置完成！你是此 bot 的唯一所有者。\n\n发送消息给 OpenCode 开始工作\n/help 查看指令`);
                } else {
                    await adapter.reply(ctx.threadId, `🚀 准备就绪\n\n发送消息给 OpenCode 开始工作\n/help 查看指令`);
                }
            } else {
                await adapter.reply(ctx.threadId, '🚫 你无权使用此 bot');
            }
            return true;
        }
        case 'help':
            await adapter.reply(ctx.threadId, getHelpText());
            return true;
        case 'restart': {
            console.log('[bot] restart command received');
            await adapter.reply(ctx.threadId, '🔄 正在重启 bot...');
            // 关掉 opencode server，防新子进程端口冲突
            try { globalThis.__opencodeServer?.kill?.(); } catch {}
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

        case 'reset': {
            const oldSession = openCodeSessions?.get(ctx.threadId);
            if (oldSession) {
                abortSession(oldSession).catch(() => {});
            }
            openCodeSessions?.delete(ctx.threadId);
            await adapter.reply(ctx.threadId, '🔄 会话已重置，下次发送消息将创建新会话');
            return true;
        }

        case 'esc': {
            const session = openCodeSessions?.get(ctx.threadId);
            const parts = [];
            // 1. 杀 CLI 进程 (cc/cx/copilot 模式)
            const { killAgentProcess, getAgentProcess } = await import('../core/agent-registry.js');
            const ap = getAgentProcess(ctx.threadId);
            if (ap) {
                const r = killAgentProcess(ctx.threadId);
                parts.push(`🛑 ${r.agentName} 子进程已终止 (pid ${ap.process.pid})`);
            }
            // 2. 中断 OpenCode SDK session
            if (session) {
                const ok = await abortSession(session);
                parts.push(ok ? '🛑 OpenCode session 已中断' : '⚠️ OpenCode session 中断失败');
            }
            if (parts.length === 0) {
                await adapter.reply(ctx.threadId, '⚠️ 没有活跃任务');
                return true;
            }
            await adapter.reply(ctx.threadId, parts.join('\n'));
            return true;
        }

        case 'status': {
            const session = openCodeSessions?.get(ctx.threadId);
            if (!session) {
                await adapter.reply(ctx.threadId, '⚠️ 当前线程无 session\n发送任意消息创建 session');
                return true;
            }
            try {
                const r = await session.client.session.status();
                const all = r.data || {};
                const s = all[session.sessionId];
                if (!s) {
                    await adapter.reply(ctx.threadId, `📊 Session: ${session.sessionId.slice(0, 8)}\n状态: unknown (server 未返回)`);
                    return true;
                }
                const icon = s.type === 'idle' ? '🟢' : s.type === 'busy' ? '🔴' : '🟡';
                const label = s.type === 'idle' ? '待命' : s.type === 'busy' ? '活跃' : `重试中 (attempt ${s.attempt})`;
                let msg = `${icon} ${label}\nSession: ${session.sessionId.slice(0, 8)}`;
                if (s.type === 'retry' && s.next) {
                    const wait = Math.max(0, Math.round((s.next - Date.now()) / 1000));
                    msg += `\n下次重试: ${wait}s 后`;
                }
                await adapter.reply(ctx.threadId, msg);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 状态查询失败: ${e.message}`);
            }
            return true;
        }

        case 'info': {
            try {
                const agentChildren = listAgentProcesses().length;
                const activeThreads = threadHistory.size;
                const msg = formatInfo({
                    version: process.env.npm_package_version || 'dev',
                    activeThreads,
                    agentChildren,
                });
                await adapter.reply(ctx.threadId, msg);
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ /info 失败: ${e.message}`);
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

        case 'model': {
            try {
                const current = getThreadModel(ctx.threadId);
                const recent = getRecentModels();

                if (!arg) {
                    let msg = current
                        ? `🧠 当前: ${current.providerID}/${current.modelID}\n\n`
                        : '';
                    if (recent.length > 0) {
                        msg += '最近使用:\n';
                        for (const r of recent) {
                            const mark = (current && r.providerID === current.providerID && r.modelID === current.modelID) ? ' ←' : '';
                            msg += `  ${r.providerID}/${r.modelID}${mark}\n`;
                        }
                        msg += '\n';
                    }
                    msg += '用法:\n  /model list — 显示全部模型\n  /model 关键词 — 搜索\n  /model <provider>/<id> — 切换';
                    const msgs = splitMessage(msg);
                    for (const m of msgs) await adapter.reply(ctx.threadId, m);
                    return true;
                }

                // Numbered selection: /model 3
                if (/^\d+$/.test(arg.trim())) {
                    const idx = parseInt(arg.trim(), 10);
                    const providers = await listProviders();
                    if (!providers) {
                        await adapter.reply(ctx.threadId, '❌ 无法获取模型列表');
                        return true;
                    }
                    const allModels = [];
                    for (const p of providers) {
                        for (const mid of Object.keys(p.models || {})) {
                            allModels.push(`${p.id}/${mid}`);
                        }
                    }
                    if (idx < 1 || idx > allModels.length) {
                        await adapter.reply(ctx.threadId, `❌ 序号 ${idx} 超出范围 (1-${allModels.length})`);
                        return true;
                    }
                    const selected = allModels[idx - 1];
                    const entry = setThreadModel(ctx.threadId, selected);
                    if (entry) {
                        await adapter.reply(ctx.threadId, `✅ 已切换至 #${idx}: ${entry.providerID}/${entry.modelID}`);
                    }
                    return true;
                }

                // /model list — show all models with numbers
                if (arg.trim().toLowerCase() === 'list') {
                    const providers = await listProviders();
                    if (!providers) {
                        await adapter.reply(ctx.threadId, '❌ 无法获取模型列表');
                        return true;
                    }
                    const lines = [];
                    let n = 0;
                    for (const p of providers) {
                        const mids = Object.keys(p.models || {});
                        if (mids.length === 0) continue;
                        lines.push(`\n【${p.id}】`);
                        for (const mid of mids) {
                            n++;
                            const mark = (current && current.providerID === p.id && current.modelID === mid) ? ' ←' : '';
                            lines.push(`  ${n}. ${p.id}/${mid}${mark}`);
                        }
                    }
                    if (n === 0) {
                        await adapter.reply(ctx.threadId, '❌ 没有可用模型');
                        return true;
                    }
                    lines.push(`\n切换: /model <序号>`);
                    const msgs = splitMessage(lines.join('\n'));
                    for (const m of msgs) await adapter.reply(ctx.threadId, m);
                    return true;
                }

                // Search: /model <keyword>
                if (!arg.includes('/')) {
                    const providers = await listProviders();
                    if (!providers) {
                        await adapter.reply(ctx.threadId, '❌ 无法获取模型列表');
                        return true;
                    }
                    const q = arg.trim().toLowerCase();
                    const matches = [];
                    for (const p of providers) {
                        for (const mid of Object.keys(p.models || {})) {
                            const name = `${p.id}/${mid}`;
                            if (name.toLowerCase().includes(q)) {
                                matches.push(name);
                            }
                        }
                    }
                    if (matches.length === 0) {
                        await adapter.reply(ctx.threadId, `🔍 未找到包含 "${arg.trim()}" 的模型`);
                        return true;
                    }
                    matches.sort();
                    let msg = `🔍 "${arg.trim()}" (${matches.length}):\n`;
                    for (const m of matches.slice(0, 30)) {
                        msg += `  ${m}\n`;
                    }
                    msg += '\n切换: /model <provider>/<modelID>';
                    const msgs = splitMessage(msg);
                    for (const m of msgs) await adapter.reply(ctx.threadId, m);
                    return true;
                }

                // Direct switch: /model <provider>/<modelID>
                const entry = setThreadModel(ctx.threadId, arg.trim());
                if (entry) {
                    await adapter.reply(ctx.threadId, `✅ 已切换至: ${entry.providerID}/${entry.modelID}`);
                } else {
                    await adapter.reply(ctx.threadId, '❌ 格式错误，使用: /model <provider>/<modelID>');
                }
                return true;
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 模型操作失败: ${e.message}`);
                return true;
            }
        }


        case 'diagnose': {
            const { checkConnection } = await import('../opencode/client.js');
            const diag = ['🔍 诊断报告\n'];
            diag.push(`OpenCode: ${await checkConnection().then(() => '✅').catch(() => '❌')}`);
            diag.push(`七牛云: ${process.env.QINIU_ACCESS_KEY ? '✅' : '❌'}`);
            diag.push(`项目目录: ${globalThis.__autoProjectDir || '❌ 未设置'}`);
            diag.push(`会话: ${openCodeSessions?.get(ctx.threadId) ? '✅' : '❌'}`);
            const msgs = splitMessage(diag.join('\n'));
            for (const m of msgs) await adapter.reply(ctx.threadId, m);
            return true;
        }

        case 'raw': {
            const val = arg?.trim().toLowerCase();
            if (val === 'on' || val === '1' || val === 'true') {
                setRawDebug(true);
                await adapter.reply(ctx.threadId, '📄 RAW 输出已开启');
            } else if (val === 'off' || val === '0' || val === 'false') {
                setRawDebug(false);
                await adapter.reply(ctx.threadId, '📄 RAW 输出已关闭');
            } else {
                await adapter.reply(ctx.threadId, `📄 RAW 输出当前: ${isRawDebug() ? '🟢 ON' : '🔴 OFF'}\n用法: /raw on 或 /raw off`);
            }
            return true;
        }

        case 'think': {
            const { setThinkVisible, isThinkVisible } = await import('../opencode/client.js');
            const val = arg?.trim().toLowerCase();
            if (val === 'on' || val === '1' || val === 'true') {
                setThinkVisible(true);
                await adapter.reply(ctx.threadId, '🤔 思考过程已开启');
            } else if (val === 'off' || val === '0' || val === 'false') {
                setThinkVisible(false);
                await adapter.reply(ctx.threadId, '🤔 思考过程已关闭');
            } else {
                await adapter.reply(ctx.threadId, `🤔 思考过程当前: ${isThinkVisible() ? '🟢 ON' : '🔴 OFF'}\n用法: /think on 或 /think off`);
            }
            return true;
        }

        case 'share': {
            const val = arg?.trim().toLowerCase();
            const isOwner = hasOwner(platform) && claimOwnership(platform, ctx.userId);

            if (!val || val === 'status') {
                const members = [...sharedRoom.members].join(', ') || '无';
                await adapter.reply(ctx.threadId, `👥 共享会话\n成员: ${members}\n${sharedRoom.busy ? '⏳ 处理中' : '✅ 空闲'}\n\n/share join — 加入共享\n/share leave — 离开`);
                return true;
            }
            if (val === 'join') {
                if (sharedRoom.members.size === 0) {
                    await adapter.reply(ctx.threadId, '👥 暂无共享会话，你就是第一个!');
                }
                addSharedMember(ctx.threadId);
                await adapter.reply(ctx.threadId, '✅ 你已加入共享会话，所有消息将共享给其他成员');
                return true;
            }
            if (val === 'leave') {
                removeSharedMember(ctx.threadId);
                await adapter.reply(ctx.threadId, '✅ 你已离开共享会话');
                return true;
            }
            await adapter.reply(ctx.threadId, '❌ 用法: /share — 查看状态\n/share join — 加入\n/share leave — 离开');
            return true;
        }

        case 'bind': {
            const { fetchQRCode, pollQRStatus } = await import('./api.js');
            const { addBotInstance, saveCredential } = await import('./bot.js');

            const baseUrl = DEFAULT_BASE_URL;
            await adapter.reply(ctx.threadId, '📱 正在获取二维码...');
            const qrResp = await fetchQRCode(baseUrl);
            if (!qrResp.qrcode_img_content) {
                await adapter.reply(ctx.threadId, '❌ 获取二维码失败');
                return true;
            }
            await adapter.reply(ctx.threadId, `📱 扫码绑定新 Bot:\n${qrResp.qrcode_img_content}`);

            (async () => {
                const startTime = Date.now();
                const timeout = 8 * 60 * 1000;
                let notifiedScanned = false;
                while (Date.now() - startTime < timeout) {
                    try {
                        const status = await pollQRStatus(baseUrl, qrResp.qrcode);
                        switch (status.status) {
                            case 'wait':
                                break;
                            case 'scaned':
                                if (!notifiedScanned) {
                                    await adapter.reply(ctx.threadId, '📱 已扫码，请在手机上确认...');
                                    notifiedScanned = true;
                                }
                                break;
                            case 'expired':
                                await adapter.reply(ctx.threadId, '⌛ 二维码已过期，请重新 /bind');
                                return;
                            case 'confirmed':
                                if (!status.bot_token || !status.ilink_bot_id) {
                                    await adapter.reply(ctx.threadId, '❌ 绑定失败：未收到 Bot Token');
                                    return;
                                }
                                const creds = {
                                    token: status.bot_token,
                                    baseUrl: status.baseurl || baseUrl,
                                    accountId: status.ilink_bot_id,
                                    userId: status.ilink_user_id,
                                };
                                saveCredential(creds);
                                addBotInstance(creds, openCodeSessions);
                                await adapter.reply(ctx.threadId, `✅ 新 Bot 绑定成功！账号: ${creds.accountId}`);
                                return;
                        }
                    } catch (e) {
                        console.error('[bind] poll error:', e);
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
                await adapter.reply(ctx.threadId, '⌛ 绑定超时，请重新 /bind');
            })();

            return true;
        }

        case 'who': {
            const others = [];
            for (const [uid] of userAdapterMap) {
                if (uid !== ctx.threadId) {
                    others.push(uid);
                }
            }
            if (others.length === 0) {
                await adapter.reply(ctx.threadId, '👤 只有你一个人在线');
                return true;
            }
            let msg = '👥 在线用户:\n';
            others.forEach((uid, i) => { msg += `  ${i + 1}. ${uid}\n`; });
            await adapter.reply(ctx.threadId, msg);
            return true;
        }

        case 'push': {
            const others = [];
            for (const [uid] of userAdapterMap) {
                if (uid !== ctx.threadId) {
                    others.push(uid);
                }
            }
            if (others.length === 0) {
                await adapter.reply(ctx.threadId, '❌ 没有其他 Bot 用户可推送');
                return true;
            }
            const targetMatch = ctx.arg?.match(/^@(\d+)\s+(.+)/);
            let msg;
            let targets;
            if (targetMatch) {
                const idx = parseInt(targetMatch[1], 10) - 1;
                const target = others[idx];
                if (!target) {
                    await adapter.reply(ctx.threadId, `❌ 没有序号 ${targetMatch[1]} 的用户，先用 /who 查看`);
                    return true;
                }
                targets = [target];
                msg = targetMatch[2];
            } else {
                targets = others;
                msg = ctx.arg || '📢 请到项目上处理一下';
            }
            let sent = 0;
            for (const uid of targets) {
                const targetAdapter = userAdapterMap.get(uid);
                if (targetAdapter) {
                    try {
                        await targetAdapter.reply(uid, msg);
                        sent++;
                    } catch (e) {
                        console.error('[push] send failed:', e.message);
                    }
                }
            }
            await adapter.reply(ctx.threadId, `✅ 已推送给 ${sent}/${targets.length} 个用户`);
            return true;
        }

        case 'auto': {
            const { startAutoLoop, stopAutoLoop, isAutoRunning } = await import('../autonomous/index.js');
            const arg = (ctx.arg || '').trim().toLowerCase();
            if (arg === 'off' || arg === 'stop') {
                stopAutoLoop();
                await adapter.reply(ctx.threadId, '⏹ 自主开发已停止');
                return true;
            }
            if (arg === 'status' || arg === '') {
                const running = isAutoRunning();
                await adapter.reply(ctx.threadId, running ? '🤖 自主开发运行中' : '⏸ 自主开发未启动');
                return true;
            }
            if (isAutoRunning()) {
                await adapter.reply(ctx.threadId, '⏳ 已有自主开发任务运行中，先 /auto off 再启动新的');
                return true;
            }
            const goal = ctx.arg || '审查项目代码，找出最需要改进的地方并实施';
            const autoBroadcast = isSharedMember(ctx.threadId) ? [...sharedRoom.members].filter(tid => tid !== ctx.threadId) : [];
            startAutoLoop({ adapter, threadId: ctx.threadId, goal, openCodeSessions, broadcastTo: autoBroadcast });
            return true;
        }

        case 'lab': {
            const { execSync } = await import('child_process');
            const { existsSync } = await import('fs');
            const projectDir = globalThis.__autoProjectDir || process.cwd();
            if (!existsSync(`${projectDir}/bridge/bin/lab.mjs`)) {
                await adapter.reply(ctx.threadId, '❌ 此指令仅在 openchat 项目下可用');
                return true;
            }
            const subCmd = ctx.arg || 'status';
            try {
                const out = execSync(`node bridge/bin/lab.mjs ${subCmd}`, { cwd: projectDir, encoding: 'utf8', timeout: 15000, maxBuffer: 2048 * 1024 });
                // 格式化输出
                const formatted = formatLabOutput(out, subCmd);
                await adapter.reply(ctx.threadId, `📋 Lab ${subCmd}\n${formatted}`);
            } catch (e) {
                const errMsg = e.stderr || e.message || String(e);
                await adapter.reply(ctx.threadId, `❌ Lab 错误: ${errMsg.slice(0, 500)}`);
            }
            return true;
        }

        case 'deploy': {
            const { gitPush } = await import('../core/git-push.js');
            await adapter.reply(ctx.threadId, '📤 正在推送代码...');
            const result = gitPush({ message: ctx.arg || undefined, branch: undefined });
            if (result.ok) {
                await adapter.reply(ctx.threadId, `✅ 推送成功: ${result.successUrl}`);
            } else {
                const details = result.results.map(r => `${r.ok ? '✅' : '❌'} ${r.url}${r.error ? ': ' + r.error : ''}`).join('\n');
                await adapter.reply(ctx.threadId, `❌ 推送失败:\n${details}`);
            }
            return true;
        }

        default:
            return false;
    }
}

import { formatLabOutput } from '../core/handler.js';

export { handleAgentSwitch, handleCommand };
