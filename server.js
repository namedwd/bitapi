// server.js - 메인 서버 파일 (Redis 옵션, 500명 최적화)
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

// 설정 및 유틸리티
const config = require('./src/config');
const logger = require('./src/utils/logger');

// 서비스 (캐시 서비스로 통합)
const cacheService = require('./src/services/cacheService');
const bybitService = require('./src/services/bybitService');

// 모델 및 매니저
const TradingEngine = require('./src/models/TradingEngine');
const WebSocketManager = require('./src/websocket/wsManager');

// 컨트롤러
const marketController = require('./src/controllers/marketController');

// Express 앱 초기화
const app = express();
const server = http.createServer(app);

// 거래 엔진 인스턴스 생성
const tradingEngine = new TradingEngine();

// WebSocket 매니저 초기화
const wsManager = new WebSocketManager(server, tradingEngine);

// 미들웨어 설정
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginOpenerPolicy: false
}));
app.use(compression());
app.use(cors({
  origin: config.server.corsOrigins,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.security.rateLimitWindow,
  max: config.security.rateLimitMax,
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// 정적 파일 제공 (테스트 페이지용)
app.use(express.static(path.join(__dirname, 'public')));

// ===== API 라우트 =====

// 헬스 체크
app.get('/health', async (req, res) => {
  const stats = cacheService.getStats ? cacheService.getStats() : {};
  
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cache: {
      type: config.cache.useRedis ? 'redis' : 'memory',
      stats: stats
    },
    bybit: bybitService.isConnected,
    websocket: {
      connections: wsManager.clients.size,
      maxConnections: config.websocket.connectionLimit
    }
  });
});

// 시장 데이터 API
app.get('/api/market/ticker', marketController.getTicker);
app.get('/api/market/kline', marketController.getKline);
app.get('/api/market/orderbook', marketController.getOrderbook);
app.get('/api/market/trades', marketController.getRecentTrades);
app.get('/api/market/stats', marketController.get24hrStats);

// 거래 API (REST 백업)
app.post('/api/trade/order', async (req, res) => {
  try {
    const { userId, ...orderData } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID required'
      });
    }

    const order = await tradingEngine.createOrder(userId, orderData);
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    logger.error('Order creation error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.delete('/api/trade/order/:orderId', async (req, res) => {
  try {
    const { userId } = req.body;
    const { orderId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID required'
      });
    }

    const order = tradingEngine.cancelOrder(userId, orderId);
    
    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    logger.error('Order cancellation error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/trade/position/close', async (req, res) => {
  try {
    const { userId, positionId, qty } = req.body;
    
    if (!userId || !positionId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Position ID required'
      });
    }

    const result = await tradingEngine.closePosition(userId, positionId, qty);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Position close error:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// 사용자 데이터 API
app.get('/api/user/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const userData = tradingEngine.getUserData(userId);
    
    if (!userData) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      data: userData
    });
  } catch (error) {
    logger.error('User data fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 리더보드 API
app.get('/api/leaderboard', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const leaderboard = tradingEngine.getLeaderboard(parseInt(limit));
    
    res.json({
      success: true,
      data: leaderboard
    });
  } catch (error) {
    logger.error('Leaderboard fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// 에러 핸들러
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    error: config.server.env === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// ===== 최적화된 브로드캐스트 시스템 =====

// 브로드캐스트 큐 (500명 동시 처리 최적화)
const broadcastQueue = [];
let isBroadcasting = false;

// 효율적인 브로드캐스트 처리
async function processBroadcastQueue() {
  if (isBroadcasting || broadcastQueue.length === 0) return;
  
  isBroadcasting = true;
  const batch = broadcastQueue.splice(0, 10); // 한 번에 10개씩 처리
  
  for (const item of batch) {
    wsManager.broadcast(item.channel, item.data);
  }
  
  isBroadcasting = false;
  
  // 다음 배치 처리
  if (broadcastQueue.length > 0) {
    setTimeout(processBroadcastQueue, 10);
  }
}

// 브로드캐스트 큐에 추가
function queueBroadcast(channel, data) {
  broadcastQueue.push({ channel, data });
  processBroadcastQueue();
}

// ===== 이벤트 핸들러 설정 =====

// Bybit 서비스 이벤트
bybitService.on('market_data', (data) => {
  // 시장 데이터를 큐에 추가 (바로 브로드캐스트하지 않음)
  queueBroadcast('market', data);
});

bybitService.on('tickers.BTCUSDT', async (data) => {
  if (data && data.length > 0) {
    const tickerData = data[0];
    
    // 현재 가격 업데이트
    tradingEngine.updateCurrentPrice(tickerData.lastPrice);
    
    // 캐시에 저장
    await cacheService.set('current_price', tickerData.lastPrice, config.cache.ttl.price);
    
    // 가격 정보 브로드캐스트 (큐 사용)
    queueBroadcast('ticker', {
      symbol: 'BTCUSDT',
      price: tickerData.lastPrice,
      change24h: tickerData.price24hPcnt * 100,
      volume24h: tickerData.volume24h
    });
    
    logger.debug(`Price updated: $${tickerData.lastPrice}`);
  }
});

bybitService.on('orderbook.50.BTCUSDT', (data) => {
  // 오더북 브로드캐스트 (큐 사용)
  queueBroadcast('orderbook', data);
});

bybitService.on('publicTrade.BTCUSDT', (data) => {
  // 실시간 거래 브로드캐스트 (큐 사용)
  queueBroadcast('trades', data);
});

// 거래 엔진 이벤트
tradingEngine.on('orderCreated', (order) => {
  wsManager.sendToUser(order.userId, {
    type: 'order_created',
    data: order
  });
});

tradingEngine.on('orderFilled', (order) => {
  wsManager.sendToUser(order.userId, {
    type: 'order_filled',
    data: order
  });
});

tradingEngine.on('orderCancelled', (order) => {
  wsManager.sendToUser(order.userId, {
    type: 'order_cancelled',
    data: order
  });
});

tradingEngine.on('positionUpdate', ({ userId, position }) => {
  wsManager.sendToUser(userId, {
    type: 'position_update',
    data: position
  });
});

tradingEngine.on('balanceUpdate', ({ userId, balance }) => {
  wsManager.sendToUser(userId, {
    type: 'balance_update',
    data: balance
  });
});

tradingEngine.on('liquidation', (data) => {
  wsManager.sendToUser(data.userId, {
    type: 'liquidation',
    data
  });
  
  // 강제 청산 알림을 모든 사용자에게 브로드캐스트 (익명화)
  queueBroadcast('liquidations', {
    symbol: 'BTCUSDT',
    side: data.side,
    qty: data.qty,
    loss: data.loss,
    timestamp: Date.now()
  });
});

// ===== 서버 시작 =====

async function startServer() {
  try {
    // 캐시 서비스 초기화 (Redis 연결 시도, 실패 시 메모리 캐시 사용)
    if (config.cache.useRedis && cacheService.connect) {
      const redisConnected = await cacheService.connect();
      if (!redisConnected) {
        logger.warn('Redis connection failed, using memory cache as fallback');
      }
    }
    
    // Bybit WebSocket 연결
    bybitService.connect();
    
    // 기본 구독 설정
    setTimeout(() => {
      bybitService.subscribe([
        'orderbook.50.BTCUSDT',
        'publicTrade.BTCUSDT',
        'tickers.BTCUSDT',
        'kline.1.BTCUSDT',
        'kline.5.BTCUSDT',
        'kline.15.BTCUSDT',
        'kline.60.BTCUSDT',
        'kline.240.BTCUSDT',
        'kline.D.BTCUSDT'
      ]);
      logger.info('Subscribed to Bybit market data channels');
    }, 2000);

    // 서버 시작
    const PORT = config.server.port;
    server.listen(PORT, () => {
      logger.info(`
========================================
🚀 Server is running on port ${PORT}
📊 Environment: ${config.server.env}
💾 Cache: ${config.cache.useRedis ? 'Redis' : 'Memory'}
🔌 WebSocket: Ready for connections
🎯 Max connections: ${config.websocket.connectionLimit}
========================================
      `);
    });

    // 서버 상태 모니터링 (1분마다)
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const connections = wsManager.clients.size;
      
      logger.info(`Server Stats - Connections: ${connections}, Memory: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      
      // 캐시 통계 (메모리 캐시 사용 시)
      if (!config.cache.useRedis && cacheService.getStats) {
        const cacheStats = cacheService.getStats();
        logger.debug(`Cache Stats:`, cacheStats);
      }
    }, 60000);

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// ===== Graceful Shutdown =====

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
  logger.info(`${signal} received: closing HTTP server`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    // WebSocket 연결 종료
    wsManager.close();
    
    // Bybit 서비스 종료
    bybitService.disconnect();
    
    // 캐시 정리
    if (cacheService.clear) {
      cacheService.clear();
    } else if (cacheService.disconnect) {
      await cacheService.disconnect();
    }
    
    logger.info('All connections closed');
    process.exit(0);
  });
  
  // 30초 후 강제 종료
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
}

// 처리되지 않은 에러 핸들링
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// 서버 시작
startServer();

module.exports = { app, server };