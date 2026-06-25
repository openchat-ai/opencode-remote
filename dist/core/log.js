// File-based logger with daily rotation
// Writes to ~/.opencode-remote/logs/bot-YYYY-MM-DD.log
import { existsSync, mkdirSync, statSync, createWriteStream, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.opencode-remote', 'logs');
const MAX_LOG_SIZE = 5 * 1024 * 1024;  // 5MB per file, rotate
const KEEP_FILES = 7;                    // 保留最近 7 天

let currentDate = '';
let currentStream = null;
let currentSize = 0;

function getDate() {
    return new Date().toISOString().slice(0, 10);
}

function ensureLogFile() {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const today = getDate();
    if (currentDate === today && currentStream) return;
    if (currentStream) {
        try { currentStream.end(); } catch {}
    }
    currentDate = today;
    const logPath = join(LOG_DIR, `bot-${today}.log`);
    if (existsSync(logPath)) {
        currentSize = statSync(logPath).size;
    } else {
        currentSize = 0;
    }
    currentStream = createWriteStream(logPath, { flags: 'a' });
}

function rotate() {
    if (currentStream) {
        try { currentStream.end(); } catch {}
        currentStream = null;
    }
    ensureLogFile();
}

function format(level, msg, meta) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${msg}${metaStr}\n`;
}

function write(level, msg, meta) {
    try {
        ensureLogFile();
        const line = format(level, msg, meta);
        if (currentSize + line.length > MAX_LOG_SIZE) {
            rotate();
            ensureLogFile();
        }
        currentStream.write(line);
        currentSize += line.length;
    } catch (e) {
        // 写日志失败不能崩主进程
        console.error('[log] Write failed:', e.message);
    }
}

export const logger = {
    info(msg, meta) { write('INFO', msg, meta); },
    warn(msg, meta) { write('WARN', msg, meta); },
    error(msg, meta) { write('ERROR', msg, meta); },
    debug(msg, meta) { write('DEBUG', msg, meta); },
};

export function initLogger() {
    ensureLogFile();
    console.log(`[log] Writing to ${LOG_DIR}/bot-${getDate()}.log`);
}

// 清理旧日志
export function cleanOldLogs() {
    if (!existsSync(LOG_DIR)) return;
    const files = readdirSync(LOG_DIR);
    const today = new Date();
    for (const f of files) {
        const m = f.match(/^bot-(\d{4}-\d{2}-\d{2})\.log$/);
        if (!m) continue;
        const fileDate = new Date(m[1]);
        const daysAgo = Math.floor((today.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysAgo > KEEP_FILES) {
            try { unlinkSync(join(LOG_DIR, f)); } catch {}
        }
    }
}
