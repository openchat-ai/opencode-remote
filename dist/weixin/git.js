// Git Operations Module - 执行 Git 命令

import { spawn } from 'child_process';

function execGit(args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { ...options, shell: false });
        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr || `Exit code ${code}`));
        });
        child.on('error', reject);
    });
}

export async function gitStatus() {
    try {
        const stdout = await execGit(['status', '--short']);
        if (!stdout.trim()) {
            return { success: true, output: '工作区干净，无变更' };
        }
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitDiff(files = '') {
    try {
        const args = files ? ['diff', ...files.split(' ').filter(Boolean)] : ['diff'];
        const stdout = await execGit(args);
        return { success: true, output: stdout || '无变更' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitLog(limit = 10) {
    try {
        const stdout = await execGit(['log', '--oneline', `-${limit}`]);
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitBranch() {
    try {
        const stdout = await execGit(['branch', '-a']);
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitCommit(message) {
    if (!message) {
        return { success: false, error: '请提供提交信息' };
    }
    try {
        const stdout = await execGit(['commit', '-m', message]);
        return { success: true, output: `提交成功: ${message}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitPush(branch = 'main') {
    try {
        const stdout = await execGit(['push', 'origin', branch]);
        return { success: true, output: `已推送到 ${branch}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitPull(branch = 'main') {
    try {
        const stdout = await execGit(['pull', 'origin', branch]);
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitFetch() {
    try {
        const stdout = await execGit(['fetch', '--all']);
        return { success: true, output: '获取远程更新成功' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitAdd(files = '.') {
    try {
        const stdout = await execGit(['add', ...files.split(' ').filter(Boolean)]);
        return { success: true, output: `已添加 ${files} 到暂存区` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitCheckout(branch) {
    if (!branch) {
        return { success: false, error: '请提供分支名' };
    }
    try {
        const stdout = await execGit(['checkout', branch]);
        return { success: true, output: `已切换到 ${branch}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function gitRemote() {
    try {
        const stdout = await execGit(['remote', '-v']);
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function runGitCommand(args) {
    const parts = args.split(' ').filter(Boolean);
    const [command, ...params] = parts;

    switch (command) {
        case 'status':
        case 's':
            return gitStatus();
        case 'diff':
        case 'd':
            return gitDiff(params.join(' '));
        case 'log':
        case 'l':
            return gitLog(parseInt(params[0], 10) || 10);
        case 'branch':
        case 'b':
            return gitBranch();
        case 'commit':
        case 'c':
            return gitCommit(params.join(' '));
        case 'push':
        case 'p':
            return gitPush(params[0] || 'main');
        case 'pull':
            return gitPull(params[0] || 'main');
        case 'fetch':
            return gitFetch();
        case 'add':
            return gitAdd(params.join(' ') || '.');
        case 'checkout':
        case 'co':
            return gitCheckout(params[0]);
        case 'remote':
            return gitRemote();
        default:
            return {
                success: false,
                error: `未知命令: ${command}\n\n可用命令:\nstatus (s) - 查看状态\ndiff (d) - 查看变更\nlog (l) - 查看历史\nbranch (b) - 查看分支\ncommit (c) <信息> - 提交\npush (p) - 推送\npull - 拉取\nfetch - 获取远程\nadd - 添加到暂存区\ncheckout (co) <分支> - 切换分支\nremote - 查看远程仓库`
            };
    }
}
