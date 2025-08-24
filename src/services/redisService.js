// services/redisService.js - Redis 캐싱 서비스
const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        keyPrefix: config.redis.keyPrefix,
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        }
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connected successfully');
      });

      this.client.on('error', (error) => {
        logger.error('Redis error:', error);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        this.isConnected = false;
        logger.warn('Redis connection closed');
      });

      await this.client.ping();
      return true;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      // Redis 연결 실패해도 서버는 계속 동작 (메모리 캐시 사용)
      this.isConnected = false;
      return false;
    }
  }

  async get(key) {
    if (!this.isConnected) return null;
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis get error:', error);
      return null;
    }
  }

  async set(key, value, ttl = null) {
    if (!this.isConnected) return false;
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.client.set(key, serialized, 'EX', ttl);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      logger.error('Redis set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error('Redis del error:', error);
      return false;
    }
  }

  async hget(hash, field) {
    if (!this.isConnected) return null;
    try {
      const value = await this.client.hget(hash, field);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error('Redis hget error:', error);
      return null;
    }
  }

  async hset(hash, field, value) {
    if (!this.isConnected) return false;
    try {
      await this.client.hset(hash, field, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error('Redis hset error:', error);
      return false;
    }
  }

  async publish(channel, message) {
    if (!this.isConnected) return false;
    try {
      await this.client.publish(channel, JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error('Redis publish error:', error);
      return false;
    }
  }

  async subscribe(channel, callback) {
    if (!this.isConnected) return false;
    try {
      const subscriber = this.client.duplicate();
      await subscriber.subscribe(channel);
      subscriber.on('message', (ch, message) => {
        if (ch === channel) {
          callback(JSON.parse(message));
        }
      });
      return true;
    } catch (error) {
      logger.error('Redis subscribe error:', error);
      return false;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.isConnected = false;
      logger.info('Redis disconnected');
    }
  }
}

module.exports = new RedisService();
