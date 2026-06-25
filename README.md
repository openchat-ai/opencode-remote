# OpenCode Remote

通过微信、Telegram、飞书等平台随时随地控制 OpenCode。

## 为什么这么爽？

**输入一个字母 `z`，14 位 AI 专家帮你审项目。** 架构师、安全研究员、测试工程师、运维……每人给出犀利点评，技术经理汇总 P0-P2 任务清单。你在手机上躺着看就行。

```bash
# 安装
npm install -g @yvhitxcel/opencode-remote

# 开干
opencode-remote telegram
# → 输入 /z 叫专家团队
# → 输入 z 让专家分析项目
# → AI 自动干活，你喝茶
```

## 功能特性

- **🤖 专家评审系统** — `/z` 一键召唤 14 位 AI 专家，自动分析、投票、出方案
- **📱 多平台支持** — 微信、飞书、Telegram
- **🧠 多 AI Agent** — OpenCode、Claude Code、Codex、GitHub Copilot
- **🔄 循环任务** — `/loop` 让 AI 持续干活
- **🔍 一键诊断** — `/diagnose` 检查各组件状态

## 安装

```bash
npm install -g opencode-remote
```

## 快速开始

推荐路径：**Telegram（5分钟）→ 微信（10分钟）→ 飞书（30分钟）**

```bash
# 1. 安装
npm install -g @yvhitxcel/opencode-remote

# 2. 启动 Telegram（最快上手，无需配置）
opencode-remote telegram
# 在 Telegram 里搜索你的 bot，发送 /start

# 3. 微信（需要 iLink 平台账号）
opencode-remote weixin
# 扫码登录后即可使用

# 4. 飞书（需要企业版账号）
opencode-remote feishu
```

## 首次使用

1. 安装后运行 `opencode-remote telegram`
2. 在 Telegram 里找到你的 bot，发送 `/start`
3. 发送 `/help` 查看所有命令
4. 发送一条消息给 AI，比如"你好"
5. **发送 `/z` 启动专家模式，然后发送 `z` —— 14 位 AI 专家开始分析你的项目**

> 💡 所有核心功能（对话、会话管理、AI 模型切换、专家评审）无需任何配置。只有 `/upload` 上传才需要七牛云。

## 手机开发工作流

把 `weixin.bat` 复制到项目根目录，双击运行，扫码登录后即可在手机上通过微信开发该项目。

```bash
# 或者手动指定目录
cd 你的项目
opencode-remote
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

## 常见问题

**Q: 为什么有些命令不能用？**
A: 先运行 `/diagnose` 检查各组件状态。Telegram 功能最全，微信和飞书部分命令需要额外配置。

**Q: 微信怎么登录？**
A: 运行 `opencode-remote weixin`，终端会显示二维码，用微信扫码即可。

**Q: 专家评审怎么用？**
A: 发 `z` 或 `叫全部专家`，AI 自动扫项目、组队评审、出 P0/P1 修复方案，**然后自动修代码**。评审过程包括三级质量保障：脑内路径追踪、服务端模拟验证、对抗评审。

**Q: `/z` 什么时候用？**
A: 任何时候。发一个 `z` 让 AI 评审当前项目，发 `z 帮我看看这个bug` 聚焦具体问题。先 `/z` 设置自定义 prompt 再发问题也行。

**Q: `/z` 自动修代码会改坏吗？**
A: **强烈建议在 git 仓库中使用。** 如果改坏了可以 `git checkout .` 回滚。没有 git 的项目，AI 改完不可逆。不确定的话先发 `/z off` 关闭自动执行，只看报告不改代码。

**Q: 需要自己的服务器吗？**
A: 需要一台电脑运行 bot，手机上通过 IM 控制。OpenCode 也运行在这台电脑上。

**Q: 如何更新？**
A: `npm update -g @yvhitxcel/opencode-remote`

## 全局命令

安装后使用 `opencode-remote` 命令（不是 `remote-control`）。

### 命令原理

`package.json` 的 `bin` 字段声明了全局命令：

```json
"bin": {
    "opencode-remote": "bin/opencode-remote.js",
    "opencode-weixin": "bin/opencode-weixin.js"
}
```

`npm install -g` 时，npm 在全局目录（Windows: `%APPDATA%\npm\`）创建三个包装脚本：

| 文件 | 作用 |
|------|------|
| `opencode-remote.cmd` | CMD 入口 |
| `opencode-remote.ps1` | PowerShell 入口 |
| `opencode-remote` | Unix Shell 入口 |

包装脚本调用 `node <pkg>/dist/cli.js <args>`。`cli.js` 内置了自动重启机制：
- 首次启动以父进程模式运行，`spawn` 子进程执行实际逻辑
- 子进程退出码 `200` 时父进程自动重启

### 多 Bot 实例

```bash
opencode-remote weixin                   # 启动微信
opencode-remote weixin --id bot1         # 多账号：第一个
opencode-remote weixin --id bot2         # 多账号：第二个
opencode-remote telegram                 # 启动 Telegram
opencode-remote feishu                   # 启动飞书
opencode-remote                          # 启动所有已配置的 Bot
```

### 别名

如果习惯 `remote-control` 这个命令名，创建别名文件：

**PowerShell** (`$PROFILE`):
```powershell
Set-Alias -Name remote-control -Value opencode-remote
```

**CMD** (`remote-control.cmd`):
```bat
@echo off
opencode-remote %*
```

## 系统要求

- Node.js >= 18.0.0

## 致谢

本项目基于 [opencode-remote-control](https://github.com/ceociocto/opencode-remote-control) 开发。

## 文档

- [架构总览](docs/ARCHITECTURE.md) — 进程模型、模块图、消息流、错误传播理念
- [故障排查](docs/TROUBLESHOOTING.md) — 常见问题诊断与解决
- [配置说明](docs/CONFIG.md) — 环境变量、路径、超时矩阵
- [错误处理规范](docs/ERROR_HANDLING.md) — 错误处理契约，新代码必须遵循
- [快速开始](QUICKSTART.md) — 入门指南

## 质量保障

- ✅ TypeScript 类型检查 (`npm run typecheck`)
- ✅ 32 项自动化测试 (`npm test`)
- ✅ 多平台 CI（GitHub Actions: Ubuntu + Windows × Node 20/22）
- ✅ 容器化部署 (`docker compose up`)
- ✅ MIT 许可证

## 许可证

MIT License — 详见 [LICENSE](LICENSE) 文件
