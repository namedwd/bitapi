// server.js - 메인 서버 파일 (확장성 있는 구조)
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

// 서비스
const redisService = require('./src/services/redisService');
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
app.use(helmet());
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
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: Date.now(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    redis: redisService.isConnected,
    bybit: bybitService.isConnected
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

// ===== 이벤트 핸들러 설정 =====

// Bybit 서비스 이벤트
bybitService.on('market_data', (data) => {
  // 시장 데이터를 구독자에게 브로드캐스트
  wsManager.broadcast('market', data);
});

bybitService.on('tickers.BTCUSDT', (data) => {
  if (data && data.length > 0) {
    // 현재 가격 업데이트
    tradingEngine.updateCurrentPrice(data[0].lastPrice);
    
    // 가격 정보 브로드캐스트
    wsManager.broadcast('ticker', {
      symbol: 'BTCUSDT',
      price: data[0].lastPrice,
      change24h: data[0].price24hPcnt,
      volume24h: data[0].volume24h
    });
  }
});

bybitService.on('orderbook.50.BTCUSDT', (data) => {
  // 오더북 브로드캐스트
  wsManager.broadcast('orderbook', data);
});

bybitService.on('publicTrade.BTCUSDT', (data) => {
  // 실시간 거래 브로드캐스트
  wsManager.broadcast('trades', data);
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
  wsManager.broadcast('liquidations', {
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
    // Redis 연결
    await redisService.connect();
    
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
    }, 2000);

    // 서버 시작
    const PORT = config.server.port;
    server.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
      logger.info(`Environment: ${config.server.env}`);
      logger.info(`WebSocket server is ready`);
    });

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
    
    // Redis 연결 종료
    await redisService.disconnect();
    
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