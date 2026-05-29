// Claude Code CLI agent adapter
import { spawn } from 'child_process';
import { platform } from 'os';

const LIUV_CRASH_PATTERNS = [
    'Assertion failed',
    'UV_HANDLE_CLOSING',
    'src\\win\\async.c',
    'libuv',
];

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

        const args = ['--print', contextualPrompt];

        return this.callClaude(args, projectDir);
    }

    buildContextualPrompt(prompt, history) {
        if (!history || history.length === 0) return prompt;
        const historyText = history.map(msg => `[${msg.role}]: ${msg.content}`).join('\n\n');
        return `Previous:\n${historyText}\n\n${prompt}`;
    }

    isCrashNoise(line) {
        return LIUV_CRASH_PATTERNS.some(p => line.includes(p));
    }

    extractErrorMessage(stdout, stderr, code) {
        // 先检查 stdout：--print 模式把错误也输出到 stdout
        const stdoutLines = stdout.trim().split('\n').map(l => l.trim()).filter(Boolean);
        const stdoutErrors = stdoutLines.filter(l => !this.isCrashNoise(l));
        if (stdoutErrors.length > 0) {
            return stdoutErrors.join('\n');
        }

        // 再检查 stderr
        const stderrLines = stderr.trim().split('\n').map(l => l.trim()).filter(Boolean);
        const stderrReal = stderrLines.filter(l => !this.isCrashNoise(l));
        if (stderrReal.length > 0) {
            return stderrReal.join('\n');
        }

        // 如果全是崩溃噪音，尝试从任一流中找 Error 关键词
        const all = [...stdoutLines, ...stderrLines];
        const firstRelevant = all.find(l => /Error|error|ERROR|^\d{3}/.test(l));
        if (firstRelevant) return firstRelevant;

        // 兜底
        return `进程异常退出 (code: ${code})`;
    }

    callClaude(args, projectDir) {
        return new Promise((resolve) => {
            const opts = {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            };
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

                if (code === 0) {
                    resolve(stdout.trim());
                    return;
                }

                const errorMsg = this.extractErrorMessage(stdout, stderr, code);
                console.log(`[claude-code] Process failed, raw stderr:\n${stderr.trim().slice(-1000)}`);
                console.log(`[claude-code] Error detail:\n${errorMsg}`);

                resolve(`❌ Claude Code 错误 (exit code ${code}): ${errorMsg}`);
            });
            proc.on('error', (err) => {
                clearTimeout(timeout);
                console.log(`[claude-code] Spawn error: ${err.message}`);
                resolve(`❌ Claude Code 启动失败: ${err.message}`);
            });
        });
    }
}
