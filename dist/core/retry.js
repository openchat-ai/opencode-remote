// Retry helper — exponential backoff for transient errors
const TRANSIENT_PATTERNS = [
    'AbortError', 'aborted',
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
    'fetch failed', 'socket hang up',
    'rate limit', '429', '502', '503', '504',
    'Free usage exceeded', 'quota exceeded',
    'retry attempt', 'retrying in',
    'insufficient_quota', 'Payment Required',
    'timeout', 'Timeout',
];

export function isTransientError(err) {
    if (!err) return false;
    const msg = (err.message || String(err)).toLowerCase();
    return TRANSIENT_PATTERNS.some(p => msg.includes(p.toLowerCase()));
}

/**
 * Retry an async function with exponential backoff.
 * Only retries on transient errors. Resolves on first success.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {number} [opts.maxDelayMs=8000]
 * @param {(err: any, attempt: number, nextDelay: number) => void} [opts.onRetry]
 * @returns {Promise<T>}
 */
export async function retryTransient(fn, opts = {}) {
    const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 8000, onRetry } = opts;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt >= maxAttempts || !isTransientError(err)) throw err;
            const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
            if (onRetry) onRetry(err, attempt, delay);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}
