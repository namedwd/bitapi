// controllers/marketController.js - 시장 데이터 API 컨트롤러
const bybitService = require('../services/bybitService');
const redisService = require('../services/redisService');
const logger = require('../utils/logger');
const config = require('../config');

class MarketController {
  // 티커 정보 조회
  async getTicker(req, res) {
    try {
      const { symbol = 'BTCUSDT' } = req.query;
      
      // Redis 캐시 확인
      const cacheKey = `ticker:${symbol}`;
      const cached = await redisService.get(cacheKey);
      
      if (cached) {
        return res.json({
          success: true,
          data: cached,
          cached: true
        });
      }

      // Bybit API 호출
      const ticker = await bybitService.getTicker(symbol);
      
      // 캐싱
      await redisService.set(cacheKey, ticker, config.redis.ttl.price);
      
      res.json({
        success: true,
        data: ticker,
        cached: false
      });
    } catch (error) {
      logger.error('Error fetching ticker:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // K선 데이터 조회
  async getKline(req, res) {
    try {
      const { 
        symbol = 'BTCUSDT',
        interval = '1',
        limit = 200 
      } = req.query;
      
      // Redis 캐시 확인
      const cacheKey = `kline:${symbol}:${interval}`;
      const cached = await redisService.get(cacheKey);
      
      if (cached) {
        return res.json({
          success: true,
          data: cached,
          cached: true
        });
      }

      // Bybit API 호출
      const kline = await bybitService.getKline(symbol, interval, limit);
      
      // 캐싱
      await redisService.set(cacheKey, kline, config.redis.ttl.kline);
      
      res.json({
        success: true,
        data: kline,
        cached: false
      });
    } catch (error) {
      logger.error('Error fetching kline:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 오더북 조회
  async getOrderbook(req, res) {
    try {
      const { 
        symbol = 'BTCUSDT',
        limit = 50 
      } = req.query;
      
      // Redis 캐시 확인
      const cacheKey = `orderbook:${symbol}`;
      const cached = await redisService.get(cacheKey);
      
      if (cached) {
        return res.json({
          success: true,
          data: cached,
          cached: true
        });
      }

      // Bybit API 호출
      const orderbook = await bybitService.getOrderbook(symbol, limit);
      
      // 캐싱
      await redisService.set(cacheKey, orderbook, config.redis.ttl.orderbook);
      
      res.json({
        success: true,
        data: orderbook,
        cached: false
      });
    } catch (error) {
      logger.error('Error fetching orderbook:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 최근 거래 내역 조회
  async getRecentTrades(req, res) {
    try {
      const { 
        symbol = 'BTCUSDT',
        limit = 50 
      } = req.query;
      
      // Bybit API 호출 (실시간 데이터이므로 캐싱하지 않음)
      const trades = await bybitService.getRecentTrades(symbol, limit);
      
      res.json({
        success: true,
        data: trades
      });
    } catch (error) {
      logger.error('Error fetching recent trades:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  // 24시간 통계
  async get24hrStats(req, res) {
    try {
      const { symbol = 'BTCUSDT' } = req.query;
      
      const ticker = await bybitService.getTicker(symbol);
      
      const stats = {
        symbol: ticker.symbol,
        lastPrice: ticker.lastPrice,
        highPrice24h: ticker.highPrice24h,
        lowPrice24h: ticker.lowPrice24h,
        volume24h: ticker.volume24h,
        turnover24h: ticker.turnover24h,
        price24hPcnt: ticker.price24hPcnt,
        prevPrice24h: ticker.prevPrice24h
      };
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Error fetching 24hr stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new MarketController();
