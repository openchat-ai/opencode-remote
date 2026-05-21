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
| `/stop` | 停止 Bot | ✅ | ✅ | ❌ |
| `/sessions` | 浏览会话 | ✅ | ✅ | ❌ |
| `/delsessions` | 删除会话 | ✅ | ✅ | ❌ |
| `/loop` | 循环任务 | ✅ | ✅ | ❌ |
| `/edit` | 编辑消息 | ✅ | ❌ | ❌ |
| `/upload` | 上传构建产物 | ✅ | ❌ | ❌ |
| `/compact` | 压缩上下文 | ✅ | ✅ | ❌ |
| `/summary` | 会话摘要 | ✅ | ✅ | ❌ |
| `/commit` | 生成提交信息 | ✅ | ✅ | ❌ |
| `/review` | 代码审查 | ✅ | ✅ | ❌ |
| `/copy` | 复制回复 | ✅ | ✅ | ❌ |
| `/revert` | 撤销消息 | ✅ | ✅ | ❌ |
| `/flush` | 刷新记忆 | ✅ | ✅ | ❌ |
| `/scope` | 限定范围 | ✅ | ❌ | ❌ |
| `/analyze` | 先分析后执行 | ✅ | ❌ | ❌ |
| `/model` | 切换 AI 模型 | ✅ | ✅ | ✅ |
| `/agents` | 查看 Agent | ✅ | ✅ | ✅ |
| `/oc` | 使用 OpenCode | ✅ | ✅ | ✅ |
| `/cc` | 使用 Claude Code | ✅ | ✅ | ✅ |
| `/cx` | 使用 Codex | ✅ | ✅ | ✅ |
| `/copilot` | 使用 Copilot | ✅ | ✅ | ✅ |

> ✅ 可用 &nbsp; ❌ 未实现

## 配置说明

首次运行会在 `~/.opencode-remote/` 目录生成配置。详见 `.env.example`。

## 系统要求

- Node.js >= 18.0.0

## 许可证

MIT License
