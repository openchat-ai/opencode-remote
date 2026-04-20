# OpenChat

通过微信、Telegram、飞书等平台随时随地控制 OpenCode，目标是有一天取代微信和飞书。

## 功能特性

- **多平台支持** - 微信、Telegram、飞书
- **多 AI Agent** - 支持 OpenCode、Claude Code、Codex、GitHub Copilot
- **会话管理** - 多会话并行，自动保存与恢复
- **智能循环任务** - 长时间任务自动循环执行
- **Git 操作** - 内置 Git 命令支持
- **API Key 管理** - 统一管理多个平台的 API Keys

## 安装

```bash
# 克隆项目
git clone <仓库地址>
cd openchat

# 安装依赖
npm install

# 链接为全局命令（可选）
npm link

# 启动微信 Bot
openchat weixin
```

## 快速开始

### 1. 启动 Bot

```bash
# 微信
openchat weixin

# Telegram
openchat telegram

# 飞书
openchat feishu
```

### 2. 基础指令

| 指令 | 说明 |
|------|------|
| `/start` | 认领所有权 |
| `/help` | 显示帮助 |
| `/status` | 查看状态 |
| `/reset` | 重置会话 |
| `/restart` | 重启 Bot |

### 3. AI Agent 切换

| 指令 | 说明 |
|------|------|
| `/oc 你好` | 使用 OpenCode |
| `/cc 你好` | 使用 Claude Code |
| `/cx 你好` | 使用 Codex |
| `/copilot 你好` | 使用 GitHub Copilot |
| `/agents` | 查看所有 Agent |

### 4. Git 操作

```bash
/git status      # 查看状态
/git commit 修复  # 提交代码
/git push        # 推送
/git pull        # 拉取
/git log         # 查看历史
/git diff        # 查看变更
```

### 5. API Key 管理

```bash
/searchkey openai      # 搜索 API Key
/verifykey <KEY>       # 验证 Key
/mykeys                # 查看已保存的 Key
/clearkeys             # 清空 Key 缓存
```

### 6. 高级功能

| 指令 | 说明 |
|------|------|
| `/loop` | 开启智能循环任务 |
| `/stop` | 中断当前任务 |
| `/share` | 分享会话链接 |
| `/analyze` | 先分析后执行 |
| `/compact` | 压缩上下文 |
| `/cost` | 查看费用统计 |

## 配置说明

首次运行会在 `~/.openchat/` 目录生成配置。

## 项目结构

```
openchat/
├── dist/
│   ├── cli.js           # 命令行入口
│   ├── index.js         # 主入口
│   ├── core/            # 核心模块
│   ├── weixin/          # 微信 Bot
│   ├── telegram/        # Telegram Bot
│   ├── feishu/          # 飞书 Bot
│   └── plugins/agents/   # AI Agent 适配器
└── package.json
```

## 系统要求

- Node.js >= 18.0.0

## 致谢

本项目基于 [opencode-remote-control](https://github.com/ceociocto/opencode-remote-control) 开发。

## 许可证

MIT License
