// AES-256-GCM credential encryption
// Key derived from machine fingerprint + user-level salt
// Format: {iv, tag, data} all base64
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto';
import { hostname, userInfo, homedir, platform } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SALT_FILE = join(homedir(), '.opencode-remote', '.cred_salt');

function getMachineFingerprint() {
    const parts = [
        hostname(),
        userInfo().username,
        platform(),
        homedir(),
        process.env.COMPUTERNAME || '',
    ].join('|');
    return createHash('sha256').update(parts).digest('hex');
}

function getOrCreateSalt() {
    const dir = join(homedir(), '.opencode-remote');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(SALT_FILE)) {
        return readFileSync(SALT_FILE);
    }
    const salt = randomBytes(32);
    writeFileSync(SALT_FILE, salt, { mode: 0o600 });
    return salt;
}

function deriveKey() {
    const fp = getMachineFingerprint();
    const salt = getOrCreateSalt();
    return scryptSync(fp, salt, 32, { N: 16384, r: 8, p: 1 });
}

/**
 * Encrypt a plain string with AES-256-GCM
 * @param {string} plaintext
 * @returns {string} JSON envelope {iv, tag, data} all base64
 */
export function encryptCredential(plaintext) {
    if (plaintext == null) return null;
    const key = deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: enc.toString('base64'),
    });
}

export function decryptCredential(envelope) {
    if (envelope == null) return null;
    // 兼容旧明文 (不是 JSON envelope)
    if (typeof envelope === 'string' && !envelope.startsWith('{')) {
        return envelope;
    }
    try {
        const obj = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
        if (obj.v !== 1) return null;
        const key = deriveKey();
        const iv = Buffer.from(obj.iv, 'base64');
        const tag = Buffer.from(obj.tag, 'base64');
        const data = Buffer.from(obj.data, 'base64');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const dec = Buffer.concat([decipher.update(data), decipher.final()]);
        return dec.toString('utf8');
    } catch (e) {
        console.error('[crypto] decrypt failed:', e.message);
        return null;
    }
}
