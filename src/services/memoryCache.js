// services/memoryCache.js - Redis 대체용 메모리 캐시
const logger = require('../utils/logger');

class MemoryCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0
    };
  }

  async get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // TTL 체크
    if (item.expireAt && Date.now() > item.expireAt) {
      this.cache.delete(key);
      this.timers.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return item.value;
  }

  async set(key, value, ttlSeconds = null) {
    // 기존 타이머 제거
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }

    // 데이터 저장
    const item = {
      value,
      createdAt: Date.now(),
      expireAt: ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null
    };

    this.cache.set(key, item);
    this.stats.sets++;

    // TTL 설정
    if (ttlSeconds) {
      const timer = setTimeout(() => {
        this.cache.delete(key);
        this.timers.delete(key);
      }, ttlSeconds * 1000);
      this.timers.set(key, timer);
    }

    return true;
  }

  async del(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    return this.cache.delete(key);
  }

  async hget(hash, field) {
    const hashData = this.cache.get(hash);
    if (!hashData || !hashData.value) return null;
    return hashData.value[field] || null;
  }

  async hset(hash, field, value) {
    let hashData = this.cache.get(hash);
    
    if (!hashData) {
      hashData = { value: {}, createdAt: Date.now() };
      this.cache.set(hash, hashData);
    }
    
    hashData.value[field] = value;
    return true;
  }

  // Pub/Sub 대체 (이벤트 에미터 사용)
  async publish(channel, message) {
    // WebSocket Manager에서 직접 처리
    return true;
  }

  async subscribe(channel, callback) {
    // WebSocket Manager에서 직접 처리
    return true;
  }

  // 통계 조회
  getStats() {
    return {
      ...this.stats,
      size: this.cache.size,
      memoryUsage: this.getMemoryUsage()
    };
  }

  // 대략적인 메모리 사용량 계산
  getMemoryUsage() {
    let bytes = 0;
    for (const [key, item] of this.cache) {
      bytes += key.length * 2; // key 문자열
      bytes += JSON.stringify(item.value).length * 2; // value
    }
    return `${(bytes / 1024).toFixed(2)} KB`;
  }

  // 캐시 정리
  clear() {
    // 모든 타이머 제거
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    
    this.cache.clear();
    this.timers.clear();
    this.stats = { hits: 0, misses: 0, sets: 0 };
  }

  // 만료된 항목 정리
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, item] of this.cache) {
      if (item.expireAt && now > item.expireAt) {
        this.cache.delete(key);
        this.timers.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired cache entries`);
    }
  }
}

module.exports = new MemoryCache();