// services/cacheService.js - 통합 캐시 서비스 (Redis/Memory 자동 선택)
const config = require('../config');
const logger = require('../utils/logger');

let cacheInstance = null;

// Redis 또는 메모리 캐시 선택
if (config.cache.useRedis) {
  try {
    cacheInstance = require('./redisService');
    logger.info('Using Redis for caching');
  } catch (error) {
    logger.warn('Redis initialization failed, falling back to memory cache:', error.message);
    cacheInstance = require('./memoryCache');
  }
} else {
  cacheInstance = require('./memoryCache');
  logger.info('Using memory cache (Redis disabled)');
}

// 정기적으로 메모리 캐시 정리 (메모리 캐시 사용 시)
if (!config.cache.useRedis && cacheInstance.cleanup) {
  setInterval(() => {
    cacheInstance.cleanup();
  }, 60000); // 1분마다 만료된 항목 정리
}

module.exports = cacheInstance;