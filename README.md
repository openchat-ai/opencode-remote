# OpenCode Remote

通过微信、Telegram、飞书等平台随时随地控制 OpenCode。

## 功能特性

- **多平台支持** — 微信、飞书、Telegram
- **多 AI Agent** — OpenCode、Claude Code、Codex、GitHub Copilot
- **会话管理** — 多会话并行，自动保存与恢复
- **智能循环任务** — 长时间任务自动循环执行

## 安装

```bash
npm install -g opencode-remote
```

## 快速开始

```bash
# 微信
opencode-remote weixin

# 飞书
opencode-remote feishu

# Telegram
opencode-remote telegram
```

## 平台兼容性

| 指令 | 说明 | 微信 | 飞书 | Telegram |
|------|------|:----:|:----:|:--------:|
| `/start` | 认领所有权 | ✅ | ✅ | ✅ |
| `/help` | 显示帮助 | ✅ | ✅ | ✅ |
| `/status` | 查看状态 | ✅ | ✅ | ✅ |
| `/reset` | 重置会话 | ✅ | ✅ | ✅ |
| `/restart` | 重启 Bot | ✅ | ✅ | ✅ |
| `/stop` | 停止 Bot | ✅ | ✅ | ✅ |
| `/sessions` | 浏览会话 | ✅ | ✅ | ✅ |
| `/delsessions` | 删除会话 | ✅ | ✅ | ✅ |
| `/loop` | 循环任务 | ✅ | ✅ | ✅ |
| `/refresh` | 刷新上下文 | ✅ | ✅ | ✅ |
| `/copy` | 复制回复 | ✅ | ✅ | ✅ |
| `/revert` | 撤销消息 | ✅ | ✅ | ✅ |
| `/model` | 切换 AI 模型 | ✅ | ✅ | ✅ |
| `/agents` | 查看 Agent | ✅ | ✅ | ✅ |
| `/oc` | 使用 OpenCode | ✅ | ✅ | ✅ |
| `/cc` | 使用 Claude Code | ✅ | ✅ | ✅ |
| `/edit` | 编辑消息 | ✅ | ✅ | ✅ |
| `/upload` | 上传文件(需七牛云) | ✅ | ✅ | ✅ |
| `/delete` | 删除上传文件 | ✅ | ✅ | ✅ |
| `/diagnose` | 系统诊断 | ✅ | ✅ | ✅ |
| `/expert` `/z` | 专家评审模式 | ✅ | ✅ | ✅ |

> ✅ 可用 &nbsp; ❌ 未实现

> 💡 七牛云仅用于 `/upload` `/delete` 文件上传功能，**所有核心命令（对话、会话管理、AI 模型切换等）无需任何配置即可使用**。安装后直接 `opencode-remote telegram` 即可体验。

## 快速使用

```bash
# Telegram（最快，5分钟）
opencode-remote telegram

# 微信
opencode-remote weixin

# 飞书（需要企业版飞书账号）
opencode-remote feishu
```

## 手机开发工作流

1. 把 `weixin.bat` 复制到你的项目根目录
2. 双击运行（或在终端执行），扫码登录微信
3. 之后在手机上发消息给 bot，AI 会直接操作这个项目目录
4. 查看状态、修改代码、git 提交，全部在微信里完成

```bash
# 或者手动指定项目目录
cd 你的项目
opencode-remote
```

## 配置说明

首次运行会在 `~/.opencode-remote/` 目录生成配置。详见 `.env.example`。

**七牛云是可选的**，不配也能用全部核心功能。只有上传构建产物才需要配置。

## 系统要求

- Node.js >= 18.0.0

## 许可证

MIT License
