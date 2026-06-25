import { splitMessage } from '../core/notifications.js';
import { EMOJI } from '../core/types.js';
import { initOpenCode, checkConnection, abortSession, setThreadModel, getThreadModel, getRecentModels, setRawDebug, isRawDebug } from '../opencode/client.js';
import { claimOwnership } from '../core/auth.js';
import { getHelpText } from '../core/router.js';
import { registry } from '../core/registry.js';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function handleCommand(adapter, ctx, platform, command, arg, openCodeSessions) {
    switch (command) {
        case 'start': {
            const result = claimOwnership(platform, ctx.userId);
            if (result.success) {
                if (result.message === 'claimed') {
                    await adapter.reply(ctx.threadId, `🔐 **安全设置完成！**

✅ 你是此 bot 的唯一所有者。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  **重要安全通知**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

只有你可以通过此 bot 控制 OpenCode。
其他用户将被自动屏蔽。

你的飞书 ID: \`${ctx.userId}\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 **准备就绪！**
💬 发送提示词开始编程
/help — 查看所有指令`);
                }
                else {
                    await adapter.reply(ctx.threadId, `🚀 OpenCode 远程控制就绪

💬 发送消息给 OpenCode 开始工作
/help — 查看所有指令

指令:
/start — 首次认证
/reset — 重置会话
/approve — 同意变更
/reject — 拒绝变更
/diff — 查看变更
/files — 查看文件
/retry — 重试连接

💬 其他消息直接发送给 OpenCode！`);
                }
            }
            else {
                await adapter.reply(ctx.threadId, `🚫 **拒绝访问**

此 bot 已被其他用户绑定。

如果你是所有者，请检查配置文件。`);
            }
            return true;
        }
        case 'help':
            await adapter.reply(ctx.threadId, getHelpText());
            return true;
        case 'model': {
            try {
                if (arg) {
                    const modelStr = arg.trim();

                    // Search mode: /model <keyword>
                    if (!modelStr.includes('/')) {
                        const opencode = await initOpenCode();
                        if (!opencode) {
                            await adapter.reply(ctx.threadId, '❌ OpenCode 不可用');
                            return true;
                        }
                        const result = await opencode.client.config.providers();
                        if (result.error || !result.data?.providers) {
                            await adapter.reply(ctx.threadId, '❌ 无法获取模型列表');
                            return true;
                        }
                        const q = modelStr.toLowerCase();
                        const matches = [];
                        for (const p of result.data.providers) {
                            for (const mid of Object.keys(p.models || {})) {
                                if (`${p.id}/${mid}`.toLowerCase().includes(q)) {
                                    matches.push(`${p.id}/${mid}`);
                                }
                            }
                        }
                        if (matches.length === 0) {
                            await adapter.reply(ctx.threadId, `🔍 未找到包含 "${modelStr}" 的模型`);
                            return true;
                        }
                        matches.sort();
                        let msg = `🔍 搜索 "${modelStr}" (${matches.length} 个):\n`;
                        for (const m of matches.slice(0, 30)) {
                            msg += `  ${m}\n`;
                        }
                        msg += '\n切换: /model <provider>/<modelID>';
                        const msgs = splitMessage(msg);
                        for (const m of msgs) await adapter.reply(ctx.threadId, m);
                        return true;
                    }

                    const entry = setThreadModel(ctx.threadId, modelStr);
                    if (entry) {
                        await adapter.reply(ctx.threadId, `✅ 已切换模型至: ${entry.providerID}/${entry.modelID}`);
                    } else {
                        await adapter.reply(ctx.threadId, '❌ 格式错误，请使用: /model <provider>/<modelID>');
                    }
                    return true;
                }
                const current = getThreadModel(ctx.threadId);
                let msg = current
                    ? `🧠 当前模型: ${current.providerID}/${current.modelID}\n\n`
                    : '';

                const recent = getRecentModels();
                if (recent.length > 0) {
                    msg += '最近使用:\n';
                    for (const r of recent) {
                        const mark = (current && r.providerID === current.providerID && r.modelID === current.modelID) ? ' ←' : '';
                        msg += `  ${r.providerID}/${r.modelID}${mark}\n`;
                    }
                    msg += '\n';
                }
                if (!current) {
                    msg += '提示: 用 /model <关键词> 搜索模型，/model <provider>/<modelID> 切换\n';
                } else {
                    msg += '用法: /model <关键词> — 搜索\n  /model <provider>/<modelID> — 切换';
                }
                const msgs = splitMessage(msg);
                for (const m of msgs) await adapter.reply(ctx.threadId, m);
                return true;
            } catch (e) {
                await adapter.reply(ctx.threadId, `❌ 模型操作失败: ${e.message}`);
                return true;
            }
        }
        case 'oc':
        case 'cc':
        case 'cx':
        case 'copilot': {
            const agentName = command === 'cc' ? 'claude-code' : command === 'cx' ? 'codex' : command === 'copilot' ? 'copilot' : 'opencode';
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
            if (!arg) {
                await adapter.reply(ctx.threadId, `✅ 已切换到 ${agentName}`);
                return true;
            }
            await adapter.sendTypingIndicator(ctx.threadId);
            try {
                const response = await agent.sendPrompt(agentName, arg, [], { projectDir: globalThis.__autoProjectDir });
                await adapter.sendTypingIndicator(ctx.threadId);
                const chunks = splitMessage(response || '无响应');
                for (const chunk of chunks) {
                    await adapter.reply(ctx.threadId, chunk);
                }
            } catch (error) {
                await adapter.sendTypingIndicator(ctx.threadId);
                await adapter.reply(ctx.threadId, `❌ 错误: ${error.message}`);
            }
            return true;
        }
        case 'approve': {
            await adapter.reply(ctx.threadId, '🤷 没有待审批的变更');
            return true;
        }
        case 'reject': {
            await adapter.reply(ctx.threadId, '🤷 没有待拒绝的变更');
            return true;
        }

        case 'files': {
            await adapter.reply(ctx.threadId, '📄 此会话没有文件变更');
            return true;
        }
        case 'reset': {
            const oldSession = openCodeSessions?.get(ctx.threadId);
            if (oldSession) {
                abortSession(oldSession).catch(() => {});
            }
            openCodeSessions?.delete(ctx.threadId);
            globalThis.__latestOpenCodeSession = null;
            await adapter.reply(ctx.threadId, '🔄 会话已重置，下次发送消息将创建新会话');
            return true;
        }
        case 'retry': {
            const connected = await checkConnection();
            if (connected) {
                await adapter.reply(ctx.threadId, '✅ OpenCode 已在线！');
            } else {
                await adapter.reply(ctx.threadId, '❌ 仍离线，请检查 OpenCode 是否运行中');
            }
            return true;
        }
        case 'restart': {
            console.log('[feishu-bot] restart command received');
            await adapter.reply(ctx.threadId, '🔄 正在重启 bot...');
            const remoteDir = join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.opencode-remote');
            if (!existsSync(remoteDir)) {
                mkdirSync(remoteDir, { recursive: true });
            }
            const restartInfo = { threadId: ctx.threadId, time: Date.now() };
            writeFileSync(join(remoteDir, '.restart_user.json'), JSON.stringify(restartInfo));
            await new Promise(r => setTimeout(r, 500));
            console.log('[feishu-bot] about to exit with code 200');
            process.exit(200);
            return true;
        }
        case 'stop': {
            await adapter.reply(ctx.threadId, '🛑 正在停止 bot...');
            setTimeout(() => {
                if (globalThis.__feishuBotShutdown) {
                    globalThis.__feishuBotShutdown(false);
                }
                setTimeout(() => process.exit(0), 1000);
            }, 500);
            return true;
        }

        case 'diagnose': {
            const { checkConnection } = await import('../opencode/client.js');
            const diag = ['🔍 诊断报告\n'];
            diag.push(`OpenCode: ${await checkConnection().then(() => '✅').catch(() => '❌')}`);
            diag.push(`七牛云: ${process.env.QINIU_ACCESS_KEY ? '✅' : '❌'}`);
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
        default:
            await adapter.reply(ctx.threadId, `${EMOJI.WARNING} 未知指令: ${command}\n\n请发送 /help 查看可用指令`);
            return true;
    }
}

export { handleCommand };
