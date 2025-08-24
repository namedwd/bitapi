// services/bybitService.js - Bybit API 통신 서비스
const WebSocket = require('ws');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const EventEmitter = require('events');

class BybitService extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.subscriptions = new Set();
    this.pingInterval = null;
    this.reconnectTimeout = null;
  }

  // WebSocket 연결
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(config.bybit.wsPublic);

    this.ws.on('open', () => {
      logger.info('Connected to Bybit WebSocket');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      // 기존 구독 복원
      this.restoreSubscriptions();
      
      // Ping 시작
      this.startPing();
      
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.op === 'pong') {
          return;
        }

        if (message.success === false) {
          logger.error('Bybit subscription error:', message);
          return;
        }

        // 토픽별로 이벤트 발생
        if (message.topic) {
          this.emit('market_data', message);
          this.emit(message.topic, message.data);
        }
      } catch (error) {
        logger.error('Error parsing Bybit message:', error);
      }
    });

    this.ws.on('error', (error) => {
      logger.error('Bybit WebSocket error:', error);
      this.isConnected = false;
    });

    this.ws.on('close', () => {
      logger.warn('Bybit WebSocket disconnected');
      this.isConnected = false;
      this.stopPing();
      this.scheduleReconnect();
    });
  }

  // 구독 관리
  subscribe(topics) {
    if (!Array.isArray(topics)) {
      topics = [topics];
    }

    topics.forEach(topic => this.subscriptions.add(topic));

    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        op: 'subscribe',
        args: topics
      }));
      logger.info('Subscribed to topics:', topics);
    }
  }

  unsubscribe(topics) {
    if (!Array.isArray(topics)) {
      topics = [topics];
    }

    topics.forEach(topic => this.subscriptions.delete(topic));

    if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        op: 'unsubscribe',
        args: topics
      }));
      logger.info('Unsubscribed from topics:', topics);
    }
  }

  // 구독 복원
  restoreSubscriptions() {
    if (this.subscriptions.size > 0) {
      const topics = Array.from(this.subscriptions);
      this.ws.send(JSON.stringify({
        op: 'subscribe',
        args: topics
      }));
      logger.info('Restored subscriptions:', topics);
    }
  }

  // Ping 관리
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, config.websocket.heartbeatInterval);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // 재연결 관리
  scheduleReconnect() {
    if (this.reconnectAttempts >= config.websocket.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(
      config.websocket.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      logger.info(`Reconnecting to Bybit... Attempt ${this.reconnectAttempts}`);
      this.connect();
    }, delay);
  }

  // REST API 메소드
  async getTicker(symbol = 'BTCUSDT') {
    try {
      const response = await axios.get(`${config.bybit.restApi}/v5/market/tickers`, {
        params: {
          category: 'linear',
          symbol
        }
      });
      return response.data.result.list[0];
    } catch (error) {
      logger.error('Error fetching ticker:', error);
      throw error;
    }
  }

  async getKline(symbol = 'BTCUSDT', interval = '1', limit = 200) {
    try {
      const response = await axios.get(`${config.bybit.restApi}/v5/market/kline`, {
        params: {
          category: 'linear',
          symbol,
          interval,
          limit
        }
      });
      return response.data.result.list;
    } catch (error) {
      logger.error('Error fetching kline:', error);
      throw error;
    }
  }

  async getOrderbook(symbol = 'BTCUSDT', limit = 50) {
    try {
      const response = await axios.get(`${config.bybit.restApi}/v5/market/orderbook`, {
        params: {
          category: 'linear',
          symbol,
          limit
        }
      });
      return response.data.result;
    } catch (error) {
      logger.error('Error fetching orderbook:', error);
      throw error;
    }
  }

  async getRecentTrades(symbol = 'BTCUSDT', limit = 50) {
    try {
      const response = await axios.get(`${config.bybit.restApi}/v5/market/recent-trade`, {
        params: {
          category: 'linear',
          symbol,
          limit
        }
      });
      return response.data.result.list;
    } catch (error) {
      logger.error('Error fetching recent trades:', error);
      throw error;
    }
  }

  // 연결 종료
  disconnect() {
    this.stopPing();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    logger.info('Bybit service disconnected');
  }
}

module.exports = new BybitService();
