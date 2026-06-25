// LRU + TTL Map for session storage
// - Caps total size to prevent memory leaks
// - Evicts least recently used when over capacity
// - Auto-expires entries that haven't been touched in TTL ms
export class LRUSessionMap {
    constructor({ maxSize = 100, ttlMs = 30 * 60 * 1000, name = 'sessions' } = {}) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.name = name;
        this._map = new Map();  // key -> { value, lastUsed }
    }

    _isExpired(entry) {
        return Date.now() - entry.lastUsed > this.ttlMs;
    }

    _evictExpired() {
        for (const [k, v] of this._map.entries()) {
            if (this._isExpired(v)) this._map.delete(k);
        }
    }

    get(key) {
        const entry = this._map.get(key);
        if (!entry) return undefined;
        if (this._isExpired(entry)) {
            this._map.delete(key);
            return undefined;
        }
        entry.lastUsed = Date.now();
        // 移到队尾 (LRU)
        this._map.delete(key);
        this._map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this._map.has(key)) this._map.delete(key);
        this._map.set(key, { value, lastUsed: Date.now() });
        // 超上限淘汰最旧
        while (this._map.size > this.maxSize) {
            const oldest = this._map.keys().next().value;
            this._map.delete(oldest);
            console.log(`[lru:${this.name}] evicted ${oldest} (size > ${this.maxSize})`);
        }
    }

    delete(key) {
        return this._map.delete(key);
    }

    has(key) {
        const entry = this._map.get(key);
        if (!entry) return false;
        if (this._isExpired(entry)) {
            this._map.delete(key);
            return false;
        }
        return true;
    }

    get size() {
        return this._map.size;
    }

    keys() {
        this._evictExpired();
        return this._map.keys();
    }

    values() {
        this._evictExpired();
        const out = [];
        for (const v of this._map.values()) out.push(v.value);
        return out;
    }

    entries() {
        this._evictExpired();
        const out = [];
        for (const [k, v] of this._map.entries()) out.push([k, v.value]);
        return out;
    }

    clear() {
        this._map.clear();
    }

    // 定期清理 (调用方负责 setInterval)
    cleanup() {
        const before = this._map.size;
        this._evictExpired();
        const after = this._map.size;
        if (before !== after) {
            console.log(`[lru:${this.name}] cleaned ${before - after} expired entries`);
        }
    }
}
