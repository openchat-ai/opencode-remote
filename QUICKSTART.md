# OpenCode Remote — 快速上手

> 用微信/飞书/Telegram 远程控制 OpenCode CLI 的多平台 Bot。

## 5 分钟跑起来

### 1. 安装

```powershell
npm install -g @yvhitxcel/opencode-remote
```

安装后会自动生成 `opencode-remote` 全局命令。

### 2. 启动微信 Bot

```powershell
opencode-remote weixin
```

首次启动会打印二维码，用**手机微信**扫码绑定。绑定成功后凭证加密保存到 `~/.opencode-remote/weixin/credentials/`。

### 3. 发送消息

在微信给 Bot 发消息即可。直接发普通消息 = 走 OpenCode 模式。

## 常用指令

| 指令 | 作用 |
|------|------|
| `/start` | 认领所有权（仅首次需要） |
| `/help` | 完整指令列表 |
| `/oc <msg>` | 切换到 OpenCode |
| `/cc <msg>` | 切换到 Claude Code |
| `/cx <msg>` | 切换到 Codex |
| `/copilot <msg>` | 切换到 GitHub Copilot |
| `/model` | 切换模型 |
| `/status` | 查看当前 session 状态 |
| `/esc` | 中断当前活跃任务 |
| `/reset` | 重置当前 session |
| `/restart` | 重启 bot |
| `/raw on/off` | 切换 RAW 调试输出 |
| `/think on/off` | 切换思考过程显示 |
| `/lab <sub>` | 实验室（仅 openchat 项目下可见） |
| `/expert <msg>` | 触发专家评审（z/叫全部专家） |

## 多账号 / 多项目

```powershell
opencode-remote weixin --id bot1   # 第一个微信账号
opencode-remote weixin --id bot2   # 第二个微信账号
```

每个实例独立凭证和 session。

## 配置文件位置

- `~/.opencode-remote/weixin/credentials/` — 加密的 Bot 凭证
- `~/.opencode-remote/state/state.json` — 持久化会话状态（重启不丢）
- `~/.opencode-remote/logs/bot-YYYY-MM-DD.log` — 日志（保留 7 天）

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `OPENCODE_TIMEOUT` | 600 (秒) | AI 任务超时上限 |
| `OPENCODE_INSTANCE_ID` | (无) | 多实例 ID |
| `HTTP_PROXY` / `HTTPS_PROXY` | (无) | HTTP 代理 |

要 20 分钟超时：`$env:OPENCODE_TIMEOUT=1200; opencode-remote weixin`

## 故障排查

| 症状 | 解决 |
|------|------|
| 进程死了不自动恢复 | 已修复 — 父进程 1s/2s/4s/8s 退避重启，60 秒内 5 次崩溃放弃 |
| AI 超时但有重试 | 已修复 — transient error 自动重试 1 次 |
| `/esc` 不能杀 CLI 进程 | 已修复 — 注册到 agent-registry，/esc 双重杀 |
| 内存随天数涨 | 已修复 — LRU 100 个 session 上限，30 分钟 TTL |
| 重启后上下文丢失 | 已修复 — state.json 持久化 threadHistory/threadAgent |
| 日志找不到 | `~/.opencode-remote/logs/bot-YYYY-MM-DD.log` |
| 微信 45009/45047 限流 | 已修复 — 自动退避重试 3 次 |
| OpenCode server 抽风 | 已修复 — 连接错误时自动 reinit 客户端 |

## 安全

- 凭证 AES-256-GCM 加密，密钥派生自机器指纹 + 用户盐
- 密钥材料在 `~/.opencode-remote/.cred_salt`，权限 600
- 换机器 = 旧凭证失效（需重新扫码）

## 技术栈

- Node.js 24 ESM
- OpenCode SDK V2（@opencode-ai/sdk/v2）
- 微信 iLink 协议（@tencent-weixin/openclaw-weixin）
- 飞书 SDK（@larksuiteoapi/node-sdk）
- Telegram grammy
- 内部 CLI adapter: Claude Code / OpenCode CLI / Codex / Copilot

## 开发

```powershell
npm run lint       # 两阶段检查：语法 + 模块解析
npm test           # 同 lint
```

修改 import/export 后必须跑 lint。两阶段会捕获语法错误 + 缺失导出 + 路径错误。
