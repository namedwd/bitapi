// config/index.js - 중앙 설정 관리
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  // 서버 설정
  server: {
    port: process.env.PORT || 3001,
    env: process.env.NODE_ENV || 'development',
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000']
  },

  // Bybit API 설정
  bybit: {
    wsPublic: process.env.BYBIT_WS_PUBLIC || 'wss://stream.bybit.com/v5/public/linear',
    restApi: process.env.BYBIT_REST_API || 'https://api.bybit.com',
    apiKey: process.env.BYBIT_API_KEY || '',
    apiSecret: process.env.BYBIT_API_SECRET || ''
  },

  // Redis 설정
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0,
    keyPrefix: 'bybit:mock:',
    ttl: {
      price: 10,
      orderbook: 5,
      kline: 60
    }
  },

  // 거래 설정
  trading: {
    initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000,
    maxLeverage: parseInt(process.env.MAX_LEVERAGE) || 100,
    defaultLeverage: parseInt(process.env.DEFAULT_LEVERAGE) || 100,
    liquidationThreshold: parseFloat(process.env.LIQUIDATION_THRESHOLD) || 0.8,
    makerFee: parseFloat(process.env.MAKER_FEE) || 0.0002,
    takerFee: parseFloat(process.env.TAKER_FEE) || 0.0006,
    maintenanceMarginRate: 0.005 // 0.5%
  },

  // WebSocket 설정
  websocket: {
    heartbeatInterval: 20000, // 20초
    reconnectDelay: 5000, // 5초
    maxReconnectAttempts: 10,
    messageRateLimit: 100, // 초당 최대 메시지 수
    connectionLimit: 1000 // 최대 동시 연결 수
  },

  // 로깅 설정
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: './logs',
    maxFiles: '30d',
    maxSize: '20m'
  },

  // Supabase 설정 (미래 확장용)
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || ''
  },

  // 보안 설정
  security: {
    jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    bcryptRounds: 10,
    rateLimitWindow: 15 * 60 * 1000, // 15분
    rateLimitMax: 100 // 15분당 최대 요청 수
  }
};
