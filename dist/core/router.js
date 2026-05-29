// Message router - full command definitions shared across all platforms
import { registry } from './registry.js';
import { initOpenCode, listProviders, updateGlobalModel, checkConnection, resumeSession, shareSession } from '../opencode/client.js';
import { formatTaskCompletion } from './notifications.js';

const demoModeMap = new Map();

export function setDemoMode(threadId, enabled) {
    if (enabled) demoModeMap.set(threadId, true);
    else demoModeMap.delete(threadId);
}

export function isDemoMode(threadId) {
    return demoModeMap.has(threadId);
}

export const COMMAND_ALIASES = {
    start: ['start'],
    help: ['help', 'h', '?'],
    status: ['status'],
    reset: ['reset'],
    restart: ['restart'],
    sessions: ['sessions', 'sw'],
    delsessions: ['delsessions', 'del'],
    loop: ['loop'],
    edit: ['edit'],
    diagnose: ['diagnose'],
    refresh: ['refresh'],
    copy: ['copy'],
    revert: ['revert'],
    upload: ['upload'],
    delete: ['delete'],
    oc: ['oc'],
    cc: ['cc'],
    cx: ['cx'],
    copilot: ['copilot'],
    agents: ['agents'],
    model: ['model'],
    expert: ['expert', 'z', 'Z', 'review'],
    tutorial: ['tutorial', 'guide', 'walkthrough'],
    demo: ['demo', 'sandbox', 'preview'],
};

export const DEMO_RESPONSES = {
    start: '🚀 准备就绪，发送消息给 OpenCode 开始工作\n\n💡 这是演示模式，所有命令显示模拟输出',
    get help() { return getHelpText(); },
    status: '✅ OpenCode 在线\n✅ 七牛云 已配置\n✅ 会话: abc12345\n📁 项目目录: /home/user/my-project',
    reset: '🔄 会话已重置，下次发送消息将创建新会话',
    restart: '🔄 重启信号已发送，bot 即将重启...',
    sessions: '📂 最近会话:\n\n1. Telegram 会话 (2分钟前)\n2. 微信开发会话 (15分钟前)\n3. 专家评审 (1小时前)',
    delsessions: '🗑️ 选择要删除的会话（回复编号）：\n\n1. Telegram 会话\n2. 微信开发会话\n\n回复编号删除',
    loop: '🔄 循环任务已启动\n指令: 智能模式\n限制: 最多10次迭代或30分钟\n\n发送 /loop off 停止',
    diagnose: '🔍 诊断报告\n\nOpenCode: ✅\n七牛云: ✅\nTelegram: ✅\n飞书: ❌ 未配置\n会话: ✅',
    refresh: '✅ 会话已刷新',
    copy: '📋 最新回复:\n\n这是 AI 的示例回复内容，演示 /copy 命令的功能。',
    revert: '↩️ 已撤销最近的消息\n\n发送 /revert undo 恢复',
    upload: '⬆️ 用法: /upload <文件路径>\n\n当前项目构建产物:\n📦 build/app.apk (12.5 MB)',
    delete: '🗑️ 用法: /delete <key>\n\n示例: /delete uploads/1234567890-app.apk',
    model: '🧠 可用模型:\n\nOpenAI (openai):\n  gpt-4o\n  gpt-4o-mini\n  o3-mini\n\nAnthropic (anthropic):\n  claude-sonnet-4-20250514\n\n用法: /model <provider/model>',
    agents: '🤖 可用 AI Agent:\n\n✅ opencode\n✅ claude-code\n✅ codex\n❌ copilot\n\n切换: /oc /cc /cx /copilot',
    oc: '✅ 已切换到 OpenCode\n\n💬 发送消息给 OpenCode 开始工作',
    cc: '✅ 已切换到 Claude Code',
    cx: '✅ 已切换到 Codex',
    copilot: '✅ 已切换到 GitHub Copilot',
    edit: '✏️ 用法: /edit <消息编号>\n\n选择要修改的消息，然后发送修正后的内容。',
    expert: '🧠 专家评审模式已启动\n\n14 位 AI 专家正在分析您的项目...\n\n架构师、安全研究员、测试工程师、VC/投资人等角色将依次给出评审意见。',
    tutorial: '📚 教程已启动\n发送 /tutorial 1 开始第1步',
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
    status: '连接状态',
    reset: '重置会话',
    restart: '重启 Bot',
    sessions: '浏览会话',
    delsessions: '删除会话',
    loop: '循环任务',
    edit: '编辑消息',
    diagnose: '系统诊断',
    refresh: '刷新上下文',
    copy: '复制回复',
    revert: '撤销消息',
    upload: '上传文件',
    delete: '删除上传文件',
    oc: '使用 OpenCode',
    cc: '使用 Claude Code',
    cx: '使用 Codex',
    copilot: '使用 Copilot',
    agents: '查看 Agent',
    model: '切换模型',
    expert: '专家评审(z/叫全部专家)',
    tutorial: '交互式教程(step-by-step 上手)',
    demo: '沙箱模式(无需配置体验全部命令)',
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
        ['🟢 常用', ['start', 'help', 'status', 'reset', 'copy', 'revert', 'diagnose']],
        ['🔄 任务', ['loop', 'refresh', 'restart']],
        ['📂 会话', ['sessions', 'delsessions']],
        ['🤖 AI', ['model', 'agents', 'oc', 'cc']],
        ['⬆️ 文件', ['upload', 'delete']],
        ['🧠 专家', ['expert']],
    ];
    for (const [title, cmds] of groups) {
        lines.push(title);
        for (const cmd of cmds) {
            const aliases = COMMAND_ALIASES[cmd];
            const aliasStr = aliases.length > 1 ? ` (${aliases.slice(1).join(', ')})` : '';
            lines.push(`  /${cmd}${aliasStr} — ${COMMAND_HELP[cmd] || cmd}`);
        }
        lines.push('');
    }
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

async function getSessionsList() {
    const opencode = await initOpenCode();
    if (!opencode) return null;
    const result = await opencode.client.session.list();
    if (result.error || !result.data) return [];
    return result.data.sort((a, b) => (b.time?.updated || b.updated_at || 0) - (a.time?.updated || a.updated_at || 0));
}

async function getSessionMessages(sessionId) {
    const opencode = await initOpenCode();
    if (!opencode) return null;
    const result = await opencode.client.session.messages({ path: { id: sessionId } });
    if (result.error) return null;
    return result.data || [];
}

export const TUTORIAL_STEPS = [
    {
        step: 1,
        title: '💬 发送第一条消息',
        desc: '直接发一条消息给 bot，比如："帮我写一个 Hello World 程序"\nAI 会自动接收并在你的电脑上执行。',
        action: '现在试试：输入 "你好" 或 "帮我写一个 Python 程序"',
    },
    {
        step: 2,
        title: '📊 查看状态',
        desc: '发送 /status 查看 OpenCode 是否在线、当前会话信息、运行中的任务。',
        action: '试试：发送 /status',
    },
    {
        step: 3,
        title: '📋 复制 AI 回复',
        desc: 'AI 回复了长篇代码？用 /copy 一键复制最新 AI 回复的内容。',
        action: '试试：发送 /copy',
    },
    {
        step: 4,
        title: '🤖 切换 AI 模型',
        desc: '不同模型擅长不同任务。用 /model 查看可用模型，/model provider/model 切换。',
        action: '试试：发送 /model 查看列表',
    },
    {
        step: 5,
        title: '🧠 召唤专家评审',
        desc: '发送 /z 启动专家评审模式，14 位 AI 专家分析你的项目，自动出修复方案并执行。',
        action: '试试：发送 /z，然后发送 z',
    },
    {
        step: 6,
        title: '🔄 循环任务',
        desc: '让 AI 持续工作。发送 /loop 启动循环任务，AI 会反复推进项目。\n停止：/loop off',
        action: '试试：发送 /loop 检查测试覆盖率',
    },
    {
        step: 7,
        title: '🔍 系统诊断',
        desc: '出问题了？/diagnose 一键检查 OpenCode、七牛云、各平台连接状态。',
        action: '试试：发送 /diagnose',
    },
    {
        step: 8,
        title: '🎉 全部搞定',
        desc: '你已经掌握了所有核心功能！\n下一步建议：\n• /help 查看全部 22 条命令\n• 设置你的项目目录并开始真正的开发\n• 尝试多 Agent 切换：/cc 用 Claude Code，/cx 用 Codex',
        action: '',
    },
];

function getTutorialText(step) {
    const s = TUTORIAL_STEPS[step - 1];
    if (!s) return getTutorialText(1);
    let msg = `📚 教程 · 第 ${s.step}/${TUTORIAL_STEPS.length} 步\n━━━━━━━━━━━━━━━━\n\n${s.title}\n\n${s.desc}\n\n`;
    if (s.action) msg += `👉 ${s.action}`;
    msg += `\n\n回复 /tutorial${step < TUTORIAL_STEPS.length ? ` 继续第${step + 1}步\n发送 /tutorial ${step + 1}` : ''} 进入下一步`;
    return msg;
}

export async function routeMessage(parsed, ctx) {
    const threadId = ctx.threadId;
    if (demoModeMap.has(threadId) && parsed.type === 'command' && DEMO_RESPONSES[parsed.command]) {
        return DEMO_RESPONSES[parsed.command];
    }
    switch (parsed.type) {
        case 'command': {
            switch (parsed.command) {
                case 'help':
                    return getHelpText();

                case 'tutorial': {
                    const stepNum = parseInt(parsed.arg, 10);
                    const step = !isNaN(stepNum) && stepNum >= 1 && stepNum <= TUTORIAL_STEPS.length ? stepNum : 1;
                    return getTutorialText(step);
                }

                case 'demo': {
                    const arg = (parsed.arg || '').trim().toLowerCase();
                    if (arg === 'off' || arg === 'exit' || arg === 'stop') {
                        setDemoMode(threadId, false);
                        return '⏹️ 已退出沙箱模式\n\n现在所有命令将正常连接 OpenCode 执行。';
                    }
                    setDemoMode(threadId, true);
                    let msg = '🎮 **沙箱模式已启动**\n\n';
                    msg += '在此模式下，所有命令返回模拟输出，无需连接 OpenCode。\n\n';
                    msg += '可用命令:\n';
                    const groups = [
                        ['🟢 常用', ['/help', '/start', '/status', '/reset']],
                        ['🔄 任务', ['/loop', '/refresh', '/diagnose']],
                        ['🤖 AI', ['/model', '/agents', '/oc', '/cc']],
                        ['📂 会话', ['/sessions', '/delsessions', '/copy', '/revert']],
                        ['⬆️ 文件', ['/upload', '/delete']],
                    ];
                    for (const [title, cmds] of groups) {
                        msg += `\n${title}\n  ${cmds.join('  ')}\n`;
                    }
                    msg += '\n试试发送上面的命令体验效果！\n发送 /demo off 退出沙箱模式';
                    return msg;
                }

                case 'agents': {
                    const agents = registry.listAgents();
                    const lines = ['🤖 可用 AI Agent:'];
                    for (const name of agents) {
                        const agent = registry.findAgent(name);
                        const aliases = agent?.aliases || [];
                        const available = await agent?.isAvailable().catch(() => false);
                        const status = available ? '✅' : '❌';
                        const aliasStr = aliases.length > 0 ? ` (${aliases.join(', ')})` : '';
                        lines.push(`${status} ${name}${aliasStr}`);
                    }
                    lines.push('');
                    lines.push('切换: /oc /cc /cx /copilot');
                    return lines.join('\n');
                }

                case 'status': {
                    const connected = await checkConnection();
                    return `${connected ? '✅' : '❌'} OpenCode ${connected ? '在线' : '离线'}`;
                }

                case 'start':
                    return '🚀 准备就绪，发送消息给 OpenCode 开始工作';

                case 'reset':
                case 'new':
                    return '🔄 会话已重置';

                case 'restart':
                    return '🔄 重启信号已发送，bot 即将重启...';

                case 'sessions': {
                    const sessions = await getSessionsList();
                    if (!sessions || sessions.length === 0) return '📭 暂无会话';
                    let msg = '📂 最近会话:\n\n';
                    sessions.slice(0, 10).forEach((s, i) => {
                        const title = s.title || '无标题';
                        const time = s.updated_at ? formatTimeAgo(s.updated_at * 1000) : '';
                        msg += `${i + 1}. ${title} (${time})\n`;
                    });
                    return msg;
                }

                case 'delsessions': {
                    const sessions = await getSessionsList();
                    if (!sessions || sessions.length === 0) return '📭 暂无会话可删除';
                    let msg = '🗑️ 选择要删除的会话:\n\n';
                    sessions.slice(0, 10).forEach((s, i) => {
                        msg += `${i + 1}. ${s.title || '无标题'}\n`;
                    });
                    msg += '\n（在当前平台无法交互式选择，请使用 WeChat）';
                    return msg;
                }

                case 'loop':
                    if (parsed.arg === 'off' || parsed.arg === 'stop') return '⏹️ 循环任务已停止';
                    if (parsed.arg === 'status') return '🔄 循环任务状态（在微信中查看详情）';
                    return '🔄 循环任务已启动（完整控制请使用 WeChat）';

                case 'refresh': {
                    if (!ctx.opencodeSessionId) return '❌ 没有活跃的会话';
                    const opencode = await initOpenCode();
                    if (!opencode) return '❌ 无法连接 OpenCode';
                    try {
                        await opencode.client.session.compact({ path: { id: ctx.opencodeSessionId } });
                        const result = await opencode.client.session.summarize({ path: { id: ctx.opencodeSessionId } });
                        return result.error ? '⚠️ 压缩完成，但摘要生成失败' : '✅ 会话已刷新';
                    } catch (e) {
                        console.error('[refresh] Error:', e.message);
                        return `❌ 刷新失败: ${e.message}`;
                    }
                }

                case 'copy': {
                    if (!ctx.opencodeSessionId) return '❌ 没有活跃的会话';
                    const msgs = await getSessionMessages(ctx.opencodeSessionId);
                    if (!msgs || msgs.length === 0) return '❌ 无法获取消息';
                    const aiMsg = msgs.filter(m => m.info?.role === 'assistant').slice(-1)[0];
                    if (!aiMsg) return '❌ 未找到 AI 回复';
                    let content = '';
                    if (aiMsg.parts) {
                        for (const part of aiMsg.parts) {
                            if (part.type === 'text') content += part.text + '\n';
                            if (part.type === 'code') content += '```' + (part.language || '') + '\n' + part.code + '\n```\n';
                        }
                    }
                    return content ? `📋 最新回复:\n\n${content.substring(0, 2000)}` : '❌ 没有可复制的内容';
                }

                case 'revert': {
                    if (!ctx.opencodeSessionId) return '❌ 没有活跃的会话';
                    const opencode = await initOpenCode();
                    if (!opencode) return '❌ 无法连接 OpenCode';
                    if (parsed.arg === 'undo') {
                        const ok = await opencode.client.session.unrevert?.({ path: { id: ctx.opencodeSessionId } });
                        return ok ? '↩️ 已恢复撤销的内容' : '❌ 恢复失败';
                    }
                    const msgs = await getSessionMessages(ctx.opencodeSessionId);
                    if (!msgs) return '❌ 无法获取消息';
                    const lastAssistant = msgs.filter(m => m.info?.role === 'assistant' && m.time?.created).slice(-1)[0];
                    if (!lastAssistant) return '📭 没有可撤销的消息';
                    const ok = await opencode.client.session.revert({ path: { id: ctx.opencodeSessionId }, body: { messageID: lastAssistant.id } });
                    return ok ? '↩️ 已撤销最近的消息' : '❌ 撤销失败';
                }

                case 'model': {
                    try {
                        if (parsed.arg) {
                            const modelStr = parsed.arg.trim();
                            const ok = await updateGlobalModel(modelStr);
                            return ok ? `✅ 已切换模型至: ${modelStr}` : '❌ 切换失败';
                        }
                        const providers = await listProviders();
                        if (!providers || providers.length === 0) return '❌ 无法获取模型列表';
                        let msg = '🧠 可用模型:\n\n';
                        for (const p of providers) {
                            const modelIds = Object.keys(p.models || {});
                            if (modelIds.length === 0) continue;
                            msg += `${p.name} (${p.id}):\n`;
                            for (const mid of modelIds.slice(0, 5)) {
                                msg += `  ${p.id}/${mid}\n`;
                            }
                            if (modelIds.length > 5) msg += `  ...还有 ${modelIds.length - 5} 个\n`;
                        }
                        msg += '\n用法: /model <provider/model>';
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
