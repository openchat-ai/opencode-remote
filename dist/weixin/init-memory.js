// Memory system initialization module
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

export async function initMemorySystem(projectRoot) {
    const agentsPath = join(projectRoot, 'AGENTS.md');
    const memoryPath = join(projectRoot, 'MEMORY.md');
    const memoryDir = join(projectRoot, 'memory');
    const dailyLogsDir = join(projectRoot, 'daily-logs');

    const created = [];
    const skipped = [];

    if (!existsSync(agentsPath)) {
        const agentsContent = `# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

## 技术栈
<!-- 填写项目技术栈 -->

## 关键命令
<!-- 填写构建/测试/运行命令 -->

## 代码规范
<!-- 填写代码规范 -->
`;
        writeFileSync(agentsPath, agentsContent, 'utf-8');
        created.push('AGENTS.md');
    } else {
        const existing = readFileSync(agentsPath, 'utf-8');
        if (!existing.includes('MEMORY.md')) {
            const updated = `# 项目开发指南

> **记忆系统**: 每次会话请加载 @MEMORY.md 获取项目记忆和经验教训。
> 涉及特定领域时，根据 MEMORY.md 中的路由表读取对应的 memory/ 主题文件。

---

` + existing;
            writeFileSync(agentsPath, updated, 'utf-8');
            created.push('AGENTS.md (已更新)');
        } else {
            skipped.push('AGENTS.md');
        }
    }

    if (!existsSync(memoryPath)) {
        const memoryContent = `# MEMORY.md — 项目记忆

## 经验教训

<!-- 格式：- [YYYY-MM-DD] 教训内容 -->

## 最近会话摘要

<!-- 格式：- [YYYY-MM-DD] 简要总结 -->

## 主题文件路由表

> 涉及以下领域时读取对应文件

| 触发词 | 文件 | 说明 |
|--------|------|------|
| 核心逻辑 | memory/core-logic.md | 核心业务逻辑 |
| 调试经验 | memory/debugging.md | 调试经验、常见 bug |

## 开放线程

<!-- 格式：- [YYYY-MM-DD] 未完成的工作项 -->
`;
        writeFileSync(memoryPath, memoryContent, 'utf-8');
        created.push('MEMORY.md');
    } else {
        skipped.push('MEMORY.md');
    }

    if (!existsSync(memoryDir)) {
        mkdirSync(memoryDir, { recursive: true });
        const defaultTopics = {
            'core-logic.md': `# 核心逻辑记忆

> 触发词：核心、core、业务逻辑

## 经验教训
<!-- 格式：- [YYYY-MM-DD] 教训内容 -->
`,
            'debugging.md': `# 调试经验记忆

> 触发词：调试、debug、bug、错误、error

## 常见问题
<!-- 格式：- [YYYY-MM-DD] 问题和解决方案 -->

## 经验教训
<!-- 格式：- [YYYY-MM-DD] 教训内容 -->
`
        };
        for (const [filename, content] of Object.entries(defaultTopics)) {
            writeFileSync(join(memoryDir, filename), content, 'utf-8');
        }
        created.push('memory/ (2个主题文件)');
    } else {
        skipped.push('memory/');
    }

    if (!existsSync(dailyLogsDir)) {
        mkdirSync(dailyLogsDir, { recursive: true });
        created.push('daily-logs/');
    } else {
        skipped.push('daily-logs/');
    }

    let result = '🧠 记忆系统初始化完成\n\n';
    result += `📁 项目: ${projectRoot}\n\n`;

    if (created.length > 0) {
        result += `✅ 已创建:\n${created.map(f => `  • ${f}`).join('\n')}\n\n`;
    }
    if (skipped.length > 0) {
        result += `⏭️ 已存在:\n${skipped.map(f => `  • ${f}`).join('\n')}\n\n`;
    }

    result += '📖 使用方法:\n';
    result += '• 在 opencode TUI 中打开此项目\n';
    result += '• AI 会自动通过 AGENTS.md 加载 MEMORY.md\n';
    result += '• 工作中：将教训追加到对应主题文件\n';
    result += '• 会话结束 (/flush)：更新摘要\n';

    return result;
}
