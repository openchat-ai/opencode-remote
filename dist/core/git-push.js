import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEFAULT_MIRRORS = [
    'gh-proxy.com',
    'ghfast.top',
    'mirror.ghproxy.com',
    'ghproxy.com',
    'github.akams.cn',
    'gh-proxy.ygxz.in',
    'codeload.github.com',
    'github.com',
];

function loadCustomMirrors() {
    const localMirrors = join(process.cwd(), '.gitmirrors');
    if (existsSync(localMirrors)) {
        return readFileSync(localMirrors, 'utf-8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    }
    const globalEnv = join(homedir(), '.opencode-remote', '.env');
    if (existsSync(globalEnv)) {
        const m = readFileSync(globalEnv, 'utf-8').match(/GIT_MIRRORS=(.+)/);
        if (m) return m[1].split(',').map(s => s.trim()).filter(Boolean);
    }
    if (process.env.GIT_MIRRORS) return process.env.GIT_MIRRORS.split(',').map(s => s.trim()).filter(Boolean);
    return DEFAULT_MIRRORS;
}

function parseOriginUrl(url) {
    // HTTPS:  https://TOKEN@github.com/user/repo.git
    //         https://github.com/user/repo.git
    // SSH:    git@github.com:user/repo.git
    let auth = '';
    let host = '';
    let userRepo = '';

    if (url.includes('://')) {
        const match = url.match(/^(https?:\/\/)([^@]*@)?([^\/]+)(\/.*)$/);
        if (!match) return null;
        const protocol = match[1];
        const token = match[2] || '';
        host = match[3];
        userRepo = match[4];
        auth = protocol + token;
    } else {
        const match = url.match(/^([^@]+@)?([^:]+):(.+)$/);
        if (!match) return null;
        auth = match[1] || '';
        host = match[2];
        userRepo = '/' + match[3];
    }

    return { auth, host, userRepo };
}

/**
 * @param {{ message?: string, branch?: string }} [opts]
 */
export function gitPush(opts) {
    const { message, branch } = opts || {};
    const cwd = process.cwd();

    let currentBranch;
    try {
        currentBranch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
    } catch (e) {
        return { ok: false, error: '不在 git 仓库中' };
    }
    const targetBranch = branch || currentBranch;

    const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
    if (status) {
        execSync('git add -A', { cwd });
        const msg = (message || `auto update ${new Date().toISOString().slice(0, 19)}`).replace(/"/g, '\\"');
        execSync(`git commit -m "${msg}"`, { cwd, stdio: 'pipe' });
    }

    let originUrl;
    try {
        originUrl = execSync('git remote get-url origin', { cwd, encoding: 'utf-8' }).trim();
    } catch (e) {
        return { ok: false, error: '没有找到 remote origin' };
    }

    const parsed = parseOriginUrl(originUrl);
    if (!parsed) {
        return { ok: false, error: `无法解析 remote URL: ${originUrl}` };
    }

    // 从 gh CLI 提取 token（如果 remote URL 里没有的话）
    let pushAuth = parsed.auth;
    if (originUrl.startsWith('https://') && !originUrl.includes('@')) {
        try {
            const ghToken = execSync('gh auth token', { encoding: 'utf-8' }).trim();
            if (ghToken) {
                pushAuth = `https://${ghToken}@`;
            }
        } catch (_) { /* gh not available */ }
    }

    const mirrors = loadCustomMirrors();
    const results = [];

    for (const host of mirrors) {
        const pushUrl = pushAuth + host + parsed.userRepo;
        const remoteName = `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        console.log(`[git-push] trying ${host}...`);
        try {
            execSync(`git remote add ${remoteName} "${pushUrl}"`, { cwd, stdio: 'pipe' });
            execSync(`git push ${remoteName} ${targetBranch} --follow-tags`, { cwd, stdio: 'pipe', timeout: 30000 });
            execSync(`git remote remove ${remoteName}`, { cwd, stdio: 'pipe' });
            results.push({ host, ok: true, url: pushUrl });
            return { ok: true, results, successUrl: pushUrl };
        } catch (e) {
            try { execSync(`git remote remove ${remoteName}`, { cwd, stdio: 'pipe' }); } catch (_) {}
            const msg = e.stderr?.toString()?.trim() || e.message || '';
            results.push({ host, ok: false, url: pushUrl, error: msg.slice(0, 150) });
        }
    }

    return { ok: false, results };
}
