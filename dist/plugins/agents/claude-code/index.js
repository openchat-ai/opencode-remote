// Claude Code CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

export class ClaudeCodeAgentAdapter {
    name = 'claude-code';
    aliases = ['cc', 'claude'];

    async isAvailable() {
        return new Promise((resolve) => {
            const command = platform() === 'win32' ? 'where' : 'which';
            const proc = spawn(command, ['claude'], { stdio: 'ignore', shell: true });
            proc.on('close', (code) => resolve(code === 0));
            proc.on('error', () => resolve(false));
        });
    }

    async sendPrompt(_sessionId, prompt, history, options = {}) {
        const projectDir = options.projectDir;
        const contextualPrompt = this.buildContextualPrompt(prompt, history);

        // 构建命令参数
        const args = ['--print', contextualPrompt];
        // `cwd` is set via spawn opts below, no need for --project flag

        return this.callClaude(args, projectDir);
    }

    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const historyText = history.map(msg => `[${msg.role}]: ${msg.content}`).join('\n\n');
        return `Previous:\n${historyText}\n\n${prompt}`;
    }

    callClaude(args, projectDir) {
        return new Promise((resolve) => {
            const opts = {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            };
            // 如果指定了项目目录，在该目录下执行
            if (projectDir) {
                opts.cwd = projectDir;
            }

            console.log(`[claude-code] Spawning: claude ${args.join(' ')} in ${opts.cwd || process.cwd()}`);
            const proc = spawn('claude', args, opts);
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });

            const timeout = setTimeout(() => {
                console.log(`[claude-code] Process still running after 30s, stderr so far: ${stderr.slice(-200)}`);
            }, 30000);

            proc.on('close', (code) => {
                clearTimeout(timeout);
                console.log(`[claude-code] Process exited with code ${code}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes`);
                resolve(code === 0 ? stdout.trim() : `❌ Claude Code 错误: ${stderr}`);
            });
            proc.on('error', (err) => {
                clearTimeout(timeout);
                console.log(`[claude-code] Spawn error: ${err.message}`);
                resolve(`❌ Claude Code 启动失败: ${err.message}`);
            });
        });
    }
}
