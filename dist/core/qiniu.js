// 七牛云上传工具 - 使用 AWS SigV4 签名 (S3 兼容接口)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const qiniu = require('qiniu');
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { createHmac, createHash } from 'crypto';
import { join, basename, extname } from 'path';

// 七牛云配置 - 从环境变量读取，禁止硬编码
function getQiniuConfig() {
    const accessKey = process.env.QINIU_ACCESS_KEY;
    const secretKey = process.env.QINIU_SECRET_KEY;
    const bucket = process.env.QINIU_BUCKET;
    const domain = process.env.QINIU_DOMAIN;
    const region = process.env.QINIU_REGION || 'cn-east-1';
    if (!accessKey || !secretKey || !bucket || !domain) {
        throw new Error('七牛云未配置：请设置 QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET, QINIU_DOMAIN 环境变量');
    }
    return { accessKey, secretKey, bucket, domain, region };
}

let _qiniuConfig = null;
function getConfig() {
    if (!_qiniuConfig) _qiniuConfig = getQiniuConfig();
    return _qiniuConfig;
}

function getMac() {
    const cfg = getConfig();
    return new qiniu.auth.digest.Mac(cfg.accessKey, cfg.secretKey);
}

const configQiniu = new qiniu.conf.Config();
const zoneKey = `Zone_z${process.env.QINIU_REGION === 'cn-east-1' ? '0' : '1'}`;
configQiniu.zone = qiniu.zone[zoneKey] || qiniu.zone.Zone_z0;

// AWS SigV4 签名 for S3 兼容 API
function getSignedUrl(key, expires = 3600) {
    const cfg = getConfig();
    const host = cfg.domain.replace(/^https?:\/\//, '');
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credential = `${cfg.accessKey}/${dateStamp}/${cfg.region}/s3/aws4_request`;

    const params = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': credential,
        'X-Amz-Date': amzDate,
        'X-Amz-Expires': expires.toString(),
        'X-Amz-SignedHeaders': 'host'
    };
    const sortedKeys = Object.keys(params).sort();
    const canonicalQueryString = sortedKeys
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
        .join('&');

    const canonicalUri = '/' + key;
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [
        'GET', canonicalUri, canonicalQueryString,
        canonicalHeaders, signedHeaders, payloadHash
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
    const hashedRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, amzDate, credentialScope, hashedRequest].join('\n');

    const kDate = createHmac('sha256', 'AWS4' + cfg.secretKey).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(cfg.region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${cfg.domain}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export function getSignedUrlExport(key, expires = 3600) {
    return getSignedUrl(key, expires);
}

// 从七牛云删除文件
export async function deleteFromQiniu(key) {
    const cfg = getConfig();
    const mac = getMac();
    const bucketManager = new qiniu.rs.BucketManager(mac, configQiniu);

    return new Promise((resolve, reject) => {
        bucketManager.delete(cfg.bucket, key, (err, ret) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(ret);
        });
    });
}

// 获取云端文件信息（包括 hash）
export async function getFileStat(key) {
    const cfg = getConfig();
    const mac = getMac();
    const bucketManager = new qiniu.rs.BucketManager(mac, configQiniu);

    return new Promise((resolve, reject) => {
        bucketManager.stat(cfg.bucket, key, (err, ret) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(ret);
        });
    });
}

// 上传文件到七牛云（从服务器获取MD5，相同则跳过，不同则删除旧文件后重新上传）
export async function uploadToQiniu(filePath, customKey = null) {
    if (!existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
    }

    const fileName = customKey || basename(filePath);
    const key = `uploads/${fileName}`;

    // 计算本地文件 MD5
    const fileBuffer = readFileSync(filePath);
    const localMd5 = createHash('md5').update(fileBuffer).digest('hex');

    // 从服务器获取文件 MD5
    let serverMd5 = null;
    try {
        const stat = await getFileStat(key);
        serverMd5 = stat.md5;
    } catch (e) {
        console.debug('[qiniu] File stat check (expected if not exists):', e.message);
    }

    // 如果 MD5 相同，跳过上传
    if (serverMd5 === localMd5) {
        const downloadUrl = getSignedUrl(key, 86400);
        return {
            key: key,
            hash: localMd5,
            url: downloadUrl,
            skipped: true
        };
    }

    // MD5 不同，先删除云端旧文件
    if (serverMd5) {
        try {
            await deleteFromQiniu(key);
        } catch (e) {
            console.debug('[qiniu] Delete old file (expected if missing):', e.message);
        }
    }

    // 上传新文件
    const cfg = getConfig();
    const mac = getMac();
    const putPolicy = new qiniu.rs.PutPolicy({ scope: cfg.bucket });
    putPolicy.fsizeMin = 1;
    putPolicy.fsizeLimit = 1024 * 1024 * 1024;

    const uploadToken = putPolicy.uploadToken(mac);
    const formUploader = new qiniu.form_up.FormUploader(configQiniu);
    const putExtra = new qiniu.form_up.PutExtra();

    return new Promise((resolve, reject) => {
        formUploader.put(uploadToken, key, fileBuffer, putExtra, (err, ret) => {
            if (err) {
                reject(err);
                return;
            }
            const downloadUrl = getSignedUrl(key, 86400);
            resolve({
                key: key,
                hash: ret.hash,
                url: downloadUrl,
                skipped: false
            });
        });
    });
}

// 扫描目录查找构建产物
export function findBuildOutputs(projectDir, maxDepth = 5) {
    if (!projectDir || !existsSync(projectDir)) {
        return [];
    }

    const extensions = [
        '.apk', '.aab', '.ipa', '.exe', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.AppImage',
    ];

    const searchDirPatterns = [
        '', 'build', 'build/outputs', 'build/outputs/apk', 'build/outputs/bundle',
        'dist', 'dist/install', 'dist/win-unpacked', 'dist/mac',
        'out', 'out/release', 'out/debug', 'target/release', 'target/debug',
        'release', 'android/app/build/outputs', 'android/app/build/outputs/apk',
        'android/build/outputs', 'android/build/outputs/apk', 'ios/build/Build/Products',
    ];

    const results = [];
    const searchedDirs = new Set();

    function searchDir(dir, depth) {
        if (depth > maxDepth || searchedDirs.has(dir)) return;
        searchedDirs.add(dir);

        if (!existsSync(dir) || !statSync(dir).isDirectory()) return;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = join(dir, entry.name);

                if (entry.isDirectory()) {
                    if (!['node_modules', '.git', '.svn', 'venv', 'env', '__pycache__', '.cache', 'coverage', '.next', '.nuxt'].includes(entry.name)) {
                        searchDir(fullPath, depth + 1);
                    }
                } else if (entry.isFile()) {
                    const ext = extname(entry.name).toLowerCase();
                    if (!extensions.includes(ext)) continue;

                    try {
                        const stat = statSync(fullPath);
                        if (stat.size < 1024) continue;

                        results.push({
                            path: fullPath,
                            name: entry.name,
                            size: stat.size,
                            time: stat.mtime.getTime(),
                            relativePath: fullPath.replace(projectDir, '').replace(/^[\\\/]/, '')
                        });
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }

    for (const pattern of searchDirPatterns) {
        const searchPath = pattern ? join(projectDir, pattern) : projectDir;
        if (existsSync(searchPath)) {
            searchDir(searchPath, 0);
        }
    }

    if (results.length === 0) {
        searchDir(projectDir, 0);
    }

    results.sort((a, b) => b.time - a.time);
    return results;
}

export function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}