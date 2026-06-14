// Message router - full command definitions shared across all platforms
import { registry } from './registry.js';
import { initOpenCode, checkConnection, setThreadModel, getThreadModel, getRecentModels, setRawDebug, isRawDebug } from '../opencode/client.js';
import { formatTaskCompletion } from './notifications.js';

export const COMMAND_ALIASES = {
    start: ['start'],
    help: ['help', 'h', '?'],
    reset: ['reset'],
    restart: ['restart'],
    diagnose: ['diagnose'],
    oc: ['oc'],
    cc: ['cc'],
    cx: ['cx'],
    copilot: ['copilot'],
    model: ['model'],
    expert: ['expert', 'z', 'Z', 'review'],
    raw: ['raw'],
    think: ['think'],
    share: ['share'],
    invite: ['invite'],
    push: ['push'],
    who: ['who'],
    deploy: ['deploy', 'gitpush'],
    auto: ['auto'],
};

export const EXPERT_SYSTEM_PROMPT = `你是一个专家评审系统。用户消息含触发词（z/c/叫全部专家/专家点评）时启动评审，前后可带具体问题则聚焦该问题。

## 角色（14 位）
1. 架构师 — 代码架构、模块划分、依赖管理
2. 后端工程师 — 稳定性、错误处理、性能
3. 测试工程师 — 测试覆盖、可测性
4. VC / 投资人 — 值不值得投
5. 开源社区经理 — 新人能不能上车
6. Flutter 开发者 — 移动端好不好用
7. SRE / 运维 — 能不能上线
8. 安全研究员 — 有没有洞
9. AI 研究员 — agent loop 质量
10. 用户支持 — 用户卡在哪
11. 技术写作者 — 文档好不好写
12. 竞品分析师 — 市场定位
13. Git 专家 — commit 质量、分支管理、历史整洁度、回滚安全
14. **技术经理（最后出场）** — 汇总以上 13 位意见，给出 P0-P2 分级的可执行任务清单

## 执行流程

### 第 1 步：1-13 号专家点评
每人最多 200 字。**言辞必须苛刻、犀利、严谨。不讨好，不委婉。不投票。**
- 如果某条意见在上轮已提过但未修复，必须指出"上轮已提过，未落实"
- 格式: \`[意见] 内容 / [上轮已提: N]\`

### 第 2 步：技术经理提出 15 条问题
基于以上 13 位意见，输出 1) 2) ... 15) 清单。
- **1-5 为 P0（红色🔴）**，6-10 为 P1（黄色🟡），11-15 为 P2（蓝色🔵）
- 每条包含一句话描述（做什么），不展开
- 小 bug 合并同类项，一条 = 一个可执行动作
- **每条必须标注对应的专家意见编号**（格式: \`1) xxx [来源: 3,7,11]\`）
- **不含投票结果。不含投票结果。不含投票结果。**

### 第 3 步：1-13 号专家投票
每人从 15 条中选 3 条最关键的。格式：\`-> 三票：1, 7, 12\`
- **投票时必须检查自己上轮的意见是否已落实，如未落实则优先投票给相关条目**

### 第 4 步：技术经理公布结果
得票统计，汇入 P0-P2，标记得票数。
- **P0 🔴 1) xxx ( 票）[来源: 3,7] — 说明**
- **P1 🟡 7) xxx ( 票）[来源: 1,5] — 说明**

### 第 5 步：自动执行
对 P0（票数 ≥ 3）按得票从高到低逐个自动执行修复。

## 三级质量保障（嵌入评审全程）

### 1. 脑内执行路径追踪
在评审和修复代码时，**在脑中逐条执行关键路径**：变量怎么赋值、条件怎么分支、循环怎么迭代、异常怎么传播。不只看代码静态结构，要模拟运行时行为。发现逻辑断点、边界遗漏、状态覆盖不全立即提出。

### 2. 服务端模拟验证
对评审中发现的 P0/P1 问题，在修复后**自动执行模拟验证**：
- 跑 \`npm run lint\` 检查语法和模块图
- 跑 \`node --test\` 验证单元测试
- 对修改的文件做 \`node --check\` 语法校验
- 如果项目有 CI 脚本，触发本地等效检查
- 验证结果写入执行总结

### 3. LLM 对抗评审
修复完成后，**以对抗视角重新审视自己的修改**："这段修改有没有引入新 bug？有没有遗漏边界情况？变更是否最小？会不会破坏现有功能？"
- 如果发现自己的修改有问题→回退重做
- 如果确认无误→在总结中标注"已通过对抗评审"

## 核心三要素
1. **吃透代码再动手** — 不靠猜测修复 bug
2. **追到根因** — 用户反馈的现象要追到代码根因
3. **改完必须验证** — 先跑测试跑 lint 再交付

## 四项基本原则（硬约束）

1. **一次性做好，不重复返工** — 同一个模块的同类问题最多修两轮。第三轮还提同类问题说明方案不对，技术经理必须输出"换方案"而非"继续修"。

2. **以用户价值为导向** — P0 排序：用户能不能跑起来 > 会不会崩 > 好不好用。内部代码质量默认不进 P0。

3. **对用户友好** — 每次评审必须包含"首次使用视角"。P0 必须至少有一条直接回应首次使用视角。**若没有，整轮评审无效。**

4. **快速迭代，先上线** — R4 开始技术经理必须回答"是否可以发布？最短路径是什么？" 是则只保留阻塞发布的问题。

## 规则
- 言辞苛刻犀利，不讨好，不委婉
- 节约 token：摘要不超过 400 字，不贴源码
- 上轮已提过且已修的问题本轮不得再提（除非验收不合格）
- 技术经理的 15 条必须标注来源，**没有对应来源的问题不得出现**`;

const COMMAND_HELP = {
    start: '认领所有权',
    help: '显示帮助',
    reset: '重置会话',
    restart: '重启 Bot',
    diagnose: '系统诊断',
    oc: '使用 OpenCode',
    cc: '使用 Claude Code',
    cx: '使用 Codex',
    copilot: '使用 Copilot',
    model: '切换模型',
    expert: '专家评审(z/叫全部专家)',
    raw: '开启/关闭 RAW 调试输出',
    think: '开启/关闭思考过程显示',
    share: '共享会话管理',
    bind: '绑定新 Bot 用户',
    push: '推送消息给其他 Bot 用户',
    who: '查看在线用户',
    deploy: '推送代码到所有 Git 镜像',
    auto: '自主开发模式',
};

const COMMAND_MAP = {};
for (const [cmd, aliases] of Object.entries(COMMAND_ALIASES)) {
    for (const alias of aliases) {
        COMMAND_MAP[alias] = cmd;
    }
}

/**
 * 保持 typing 指示器常亮。每 8 秒刷新一次，30 秒无活动自熄。
 * 调用 poke 刷新计时，done 手动关闭。
 * 放在 core 层避免被各平台 handler 误删。
 */
export function startTypingPing(adapter, threadId) {
    let lastActivity = Date.now();
    const timer = setInterval(() => {
        adapter.sendTypingIndicator(threadId).catch(() => {});
        if (Date.now() - lastActivity > 30000) clearInterval(timer);
    }, 3000);
    return {
        poke: () => { lastActivity = Date.now(); },
        done: () => { clearInterval(timer); },
    };
}

export function getHelpText() {
    const lines = ['📖 指令\n'];
    const groups = [
        ['start', 'help'],                    // 系统
        ['reset', 'restart', 'diagnose'],     // 会话
        ['oc', 'cc', 'cx', 'copilot'],        // Agent
        ['model', 'raw', 'think'],            // 配置
        ['share', 'bind', 'push', 'who'],  // 协作
        ['expert', 'deploy', 'auto'],       // 专家+部署+自主
    ];
    let first = true;
    for (const group of groups) {
        if (!first) lines.push('');
        first = false;
        for (const cmd of group) {
            if (!COMMAND_ALIASES[cmd]) continue;
            const aliases = COMMAND_ALIASES[cmd];
            const shortAlias = aliases.slice(1).find(a => a.length <= 2);
            const aliasStr = shortAlias ? ` (${shortAlias})` : '';
            lines.push(`  /${cmd}${aliasStr} — ${COMMAND_HELP[cmd] || cmd}`);
        }
    }
    lines.push('');
    lines.push('💬 直接发消息给 AI!');
    return lines.join('\n');
}

export function detectCommand(text) {
    const trimmed = text.trim();
    if (trimmed === 'h' || trimmed === '?') {
        return { name: 'help', arg: '' };
    }
    if (/^[.。\/]/.test(trimmed)) {
        const cmd = trimmed.slice(1).trim();
        const parts = cmd.split(/\s+/);
        const name = COMMAND_MAP[parts[0].toLowerCase()];
        if (name) {
            return { name, arg: parts.slice(1).join(' ') };
        }
    }
    return null;
}

function resolveAgentFromCommand(commandName) {
    const agent = registry.findAgent(commandName);
    if (agent) return agent.name;
    const fallback = { oc: 'opencode', cc: 'claude-code', cx: 'codex', copilot: 'copilot' };
    return fallback[commandName] || null;
}

export function parseMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return { type: 'default', prompt: '' };

    const detected = detectCommand(text);
    if (detected) {
        const agentName = resolveAgentFromCommand(detected.name);
        if (agentName) {
            return { type: 'agent', agent: agentName, prompt: detected.arg };
        }
        return { type: 'command', command: detected.name, arg: detected.arg };
    }

    return { type: 'default', prompt: trimmed };
}

export async function routeMessage(parsed, ctx) {
    const threadId = ctx.threadId;
    switch (parsed.type) {
        case 'command': {
            switch (parsed.command) {
                case 'help':
                    return getHelpText();

                case 'start':
                    return '🚀 准备就绪，发送消息给 OpenCode 开始工作';

                case 'reset':
                case 'new':
                    return '🔄 会话已重置';

                case 'restart':
                    return '🔄 重启信号已发送，bot 即将重启...';

                case 'model': {
                    try {
                        const opencode = await initOpenCode();
                        if (!opencode) return '❌ OpenCode 不可用';

                        if (parsed.arg) {
                            const arg = parsed.arg.trim();

                            // Search mode: /model <keyword>
                            if (!arg.includes('/')) {
                                const result = await opencode.client.config.providers();
                                if (result.error || !result.data?.providers) return '❌ 无法获取模型列表';
                                const q = arg.toLowerCase();
                                const matches = [];
                                for (const p of result.data.providers) {
                                    for (const mid of Object.keys(p.models || {})) {
                                        const label = `${p.id}/${mid}`;
                                        if (label.toLowerCase().includes(q)) {
                                            matches.push(label);
                                        }
                                    }
                                }
                                if (matches.length === 0) return `🔍 未找到包含 "${arg}" 的模型`;
                                matches.sort().splice(30);
                                let msg = `🔍 搜索 "${arg}" (${matches.length > 30 ? '30+' : matches.length} 个):\n`;
                                for (const m of matches.slice(0, 30)) {
                                    msg += `  ${m}\n`;
                                }
                                msg += '\n切换: /model <provider>/<modelID>';
                                return msg;
                            }

                            // Switch mode: /model <provider>/<modelID>
                            const entry = setThreadModel(ctx.threadId, arg);
                            if (entry) {
                                return `✅ 已切换模型至: ${entry.providerID}/${entry.modelID}`;
                            }
                            return '❌ 格式错误，请使用: /model <provider>/<modelID>';
                        }

                        // No arg: show current + recent
                        const current = getThreadModel(ctx.threadId);
                        let msg = current
                            ? `🧠 当前模型: ${current.providerID}/${current.modelID}\n━━━━━━━━━━━━━━━━\n\n`
                            : '━━━━━━━━━━━━━━━━\n\n';
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
                            msg += '用法:\n  /model <关键词> — 搜索\n  /model <provider>/<modelID> — 切换';
                        }
                        return msg;
                    } catch (e) {
                        return `❌ 模型操作失败: ${e.message}`;
                    }
                }
                case 'diagnose': {
                    const diag = ['🔍 诊断报告\n'];
                    const qiniuOk = !!process.env.QINIU_ACCESS_KEY;
                    const teleOk = !!process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_bot_token_here';
                    const feiOk = !!process.env.FEISHU_APP_ID && !!process.env.FEISHU_APP_SECRET;
                    diag.push(`OpenCode: ${await checkConnection().then(() => '✅').catch(() => '❌')}`);
                    diag.push(`七牛云: ${qiniuOk ? '✅' : '❌'}`);
                    diag.push(`Telegram: ${teleOk ? '✅' : '❌'}`);
                    diag.push(`飞书: ${feiOk ? '✅' : '❌'}`);
                    diag.push(`会话: ${ctx.opencodeSessionId ? '✅' : '❌'}`);
                    return diag.join('\n');
                }
                case 'upload':
                    return process.env.QINIU_ACCESS_KEY ? '⬆️ 发送文件路径: /upload <path>' : '⬆️ 上传需要配置 QINIU_ACCESS_KEY 等环境变量';
                case 'delete':
                    return '🗑️ 用法: /delete <key>';
                case 'edit':
                    return ctx.opencodeSessionId ? '✏️ 用法: /edit <消息编号>' : '❌ 没有活跃的会话';

                case 'expert': {
                    const agent = registry.findAgent('opencode');
                    if (!agent) return '❌ OpenCode agent not found';
                    const available = await agent.isAvailable().catch(() => false);
                    if (!available) return '❌ OpenCode 不可用';
                    const taskStart = Date.now();
                    const response = await agent.sendPrompt(ctx.threadId || 'expert-review', EXPERT_SYSTEM_PROMPT + '\n\n用户问题：' + (parsed.arg || '请评审当前项目'), []);
                    const notification = response ? '' : `\n\n${formatTaskCompletion('专家评审', taskStart)}`;
                    return (response || '无响应') + notification;
                }

                case 'raw': {
                    const val = parsed.arg?.trim().toLowerCase();
                    if (val === 'on' || val === '1' || val === 'true') {
                        setRawDebug(true);
                        return '📄 RAW 输出已开启';
                    } else if (val === 'off' || val === '0' || val === 'false') {
                        setRawDebug(false);
                        return '📄 RAW 输出已关闭';
                    }
                    return `📄 RAW 输出当前: ${isRawDebug() ? '🟢 ON' : '🔴 OFF'}\n用法: /raw on 或 /raw off`;
                }

                default:
                    return '❓ 未知指令';
            }
        }
        case 'agent': {
            const agent = registry.findAgent(parsed.agent);
            if (!agent) return `❌ Agent "${parsed.agent}" 未找到`;
            const available = await agent.isAvailable().catch(() => false);
            if (!available) return `❌ ${parsed.agent} 不可用`;
            if (parsed.prompt) {
                const response = await agent.sendPrompt(ctx.threadId, parsed.prompt, []);
                return response || '无响应';
            }
            return `✅ 已切换到 ${parsed.agent}`;
        }
        default:
            return null;
    }
}
