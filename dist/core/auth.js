import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const OWNER_KEY = { telegram: 'telegramOwner', feishu: 'feishuOwner', weixin: 'weixinOwner' };
const AUTH_FILE = join(homedir(), '.opencode-remote', 'auth.json');

const state = { telegramOwner: null, feishuOwner: null, weixinOwner: null };

function load() {
  try {
    if (existsSync(AUTH_FILE)) {
      const d = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
      for (const k of Object.keys(OWNER_KEY)) state[OWNER_KEY[k]] = d[OWNER_KEY[k]] || null;
    }
  } catch (e) { console.warn('[auth] load failed:', e.message); }
}
function save() {
  try {
    const dir = join(homedir(), '.opencode-remote');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2));
  } catch (e) { console.error('[auth] save failed:', e.message); }
}
load();

export function isAuthorized(platform, userId) {
  const key = OWNER_KEY[platform];
  return key ? state[key] === userId : false;
}
export function hasOwner(platform) {
  const key = OWNER_KEY[platform];
  return key ? state[key] !== null : false;
}
export function getOwner(platform) {
  const key = OWNER_KEY[platform];
  return key ? state[key] : null;
}
export function claimOwnership(platform, userId) {
  const key = OWNER_KEY[platform];
  if (!key) return { success: false, message: 'unknown_platform' };
  if (state[key]) {
    if (state[key] === userId) return { success: true, message: 'already_owner' };
    return { success: false, message: 'already_claimed' };
  }
  state[key] = userId;
  save();
  return { success: true, message: 'claimed' };
}
export function getAuthStatus() {
  return { telegram: !!state.telegramOwner, feishu: !!state.feishuOwner, weixin: !!state.weixinOwner };
}
