// websocket/wsManager.js - WebSocket 연결 관리
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

class WebSocketManager {
  constructor(server, tradingEngine) {
    this.wss = new WebSocket.Server({ server });
    this.tradingEngine = tradingEngine;
    this.clients = new Map();
    this.rateLimits = new Map();
    
    this.setupWebSocketServer();
  }

  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      const clientId = uuidv4();
      const clientIp = req.socket.remoteAddress;
      
      logger.info(`New WebSocket connection: ${clientId} from ${clientIp}`);
      
      // 클라이언트 초기화
      this.clients.set(clientId, {
        ws,
        userId: null,
        authenticated: false,
        subscriptions: new Set(),
        lastActivity: Date.now()
      });

      // 연결 확인 메시지
      this.sendToClient(clientId, {
        type: 'connection',
        data: {
          clientId,
          timestamp: Date.now()
        }
      });

      // 메시지 핸들러
      ws.on('message', async (message) => {
        try {
          // Rate limiting 체크
          if (!this.checkRateLimit(clientId)) {
            this.sendToClient(clientId, {
              type: 'error',
              data: {
                code: 'RATE_LIMIT',
                message: 'Too many requests'
              }
            });
            return;
          }

          const data = JSON.parse(message.toString());
          await this.handleMessage(clientId, data);
        } catch (error) {
          logger.error(`WebSocket message error: ${error.message}`);
          this.sendToClient(clientId, {
            type: 'error',
            data: {
              code: 'INVALID_MESSAGE',
              message: error.message
            }
          });
        }
      });

      // Ping-Pong 핸들러
      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) {
          client.lastActivity = Date.now();
        }
      });

      // 연결 종료 핸들러
      ws.on('close', () => {
        logger.info(`WebSocket disconnected: ${clientId}`);
        this.handleDisconnect(clientId);
      });

      // 에러 핸들러
      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}:`, error);
      });
    });

    // Heartbeat 체크
    this.startHeartbeat();
  }

  async handleMessage(clientId, data) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { action, payload } = data;

    switch (action) {
      case 'auth':
        await this.handleAuth(clientId, payload);
        break;
        
      case 'subscribe':
        this.handleSubscribe(clientId, payload);
        break;
        
      case 'unsubscribe':
        this.handleUnsubscribe(clientId, payload);
        break;
        
      case 'place_order':
        await this.handlePlaceOrder(clientId, payload);
        break;
        
      case 'cancel_order':
        await this.handleCancelOrder(clientId, payload);
        break;
        
      case 'close_position':
        await this.handleClosePosition(clientId, payload);
        break;
        
      case 'get_positions':
        this.handleGetPositions(clientId);
        break;
        
      case 'get_orders':
        this.handleGetOrders(clientId);
        break;
        
      case 'get_balance':
        this.handleGetBalance(clientId);
        break;
        
      case 'get_trade_history':
        this.handleGetTradeHistory(clientId);
        break;
        
      case 'get_leaderboard':
        this.handleGetLeaderboard(clientId);
        break;
        
      case 'ping':
        this.sendToClient(clientId, { type: 'pong' });
        break;
        
      default:
        this.sendToClient(clientId, {
          type: 'error',
          data: {
            code: 'UNKNOWN_ACTION',
            message: `Unknown action: ${action}`
          }
        });
    }
  }

  async handleAuth(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client) return;

    // 테스트 환경이므로 간단한 인증 (실제로는 JWT 등 사용)
    const { userId } = payload;
    
    if (!userId) {
      // 새 사용자 생성
      const newUserId = uuidv4();
      await this.tradingEngine.initUser(newUserId);
      
      client.userId = newUserId;
      client.authenticated = true;
      
      this.sendToClient(clientId, {
        type: 'auth_success',
        data: {
          userId: newUserId,
          isNew: true
        }
      });
    } else {
      // 기존 사용자 연결
      const userData = this.tradingEngine.getUserData(userId);
      
      if (userData) {
        client.userId = userId;
        client.authenticated = true;
        
        this.sendToClient(clientId, {
          type: 'auth_success',
          data: {
            userId,
            isNew: false,
            ...userData
          }
        });
      } else {
        // 사용자 없음 - 새로 생성
        await this.tradingEngine.initUser(userId);
        client.userId = userId;
        client.authenticated = true;
        
        this.sendToClient(clientId, {
          type: 'auth_success',
          data: {
            userId,
            isNew: true
          }
        });
      }
    }
  }

  handleSubscribe(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { channels } = payload;
    
    if (Array.isArray(channels)) {
      channels.forEach(channel => {
        client.subscriptions.add(channel);
      });
      
      this.sendToClient(clientId, {
        type: 'subscribed',
        data: { channels }
      });
      
      logger.info(`Client ${clientId} subscribed to: ${channels.join(', ')}`);
    }
  }

  handleUnsubscribe(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { channels } = payload;
    
    if (Array.isArray(channels)) {
      channels.forEach(channel => {
        client.subscriptions.delete(channel);
      });
      
      this.sendToClient(clientId, {
        type: 'unsubscribed',
        data: { channels }
      });
      
      logger.info(`Client ${clientId} unsubscribed from: ${channels.join(', ')}`);
    }
  }

  async handlePlaceOrder(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    try {
      const order = await this.tradingEngine.createOrder(client.userId, payload);
      
      this.sendToClient(clientId, {
        type: 'order_response',
        data: {
          success: true,
          order
        }
      });
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'order_response',
        data: {
          success: false,
          error: error.message
        }
      });
    }
  }

  async handleCancelOrder(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    try {
      const { orderId } = payload;
      const order = this.tradingEngine.cancelOrder(client.userId, orderId);
      
      this.sendToClient(clientId, {
        type: 'order_cancelled',
        data: order
      });
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'CANCEL_FAILED',
          message: error.message
        }
      });
    }
  }

  async handleClosePosition(clientId, payload) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    try {
      const { positionId, qty } = payload;
      const result = await this.tradingEngine.closePosition(client.userId, positionId, qty);
      
      this.sendToClient(clientId, {
        type: 'position_closed',
        data: result
      });
    } catch (error) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'CLOSE_FAILED',
          message: error.message
        }
      });
    }
  }

  handleGetPositions(clientId) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    const userData = this.tradingEngine.getUserData(client.userId);
    
    this.sendToClient(clientId, {
      type: 'positions',
      data: userData ? userData.positions : []
    });
  }

  handleGetOrders(clientId) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    const userData = this.tradingEngine.getUserData(client.userId);
    
    this.sendToClient(clientId, {
      type: 'orders',
      data: userData ? userData.orders : []
    });
  }

  handleGetBalance(clientId) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    const userData = this.tradingEngine.getUserData(client.userId);
    
    this.sendToClient(clientId, {
      type: 'balance',
      data: userData ? userData.user.balance : null
    });
  }

  handleGetTradeHistory(clientId) {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      this.sendToClient(clientId, {
        type: 'error',
        data: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required'
        }
      });
      return;
    }

    const userData = this.tradingEngine.getUserData(client.userId);
    
    this.sendToClient(clientId, {
      type: 'trade_history',
      data: userData ? userData.user.tradeHistory : []
    });
  }

  handleGetLeaderboard(clientId) {
    const leaderboard = this.tradingEngine.getLeaderboard();
    
    this.sendToClient(clientId, {
      type: 'leaderboard',
      data: leaderboard
    });
  }

  handleDisconnect(clientId) {
    const client = this.clients.get(clientId);
    
    if (client && client.userId) {
      // 사용자 상태 저장 (필요시)
      logger.info(`User ${client.userId} disconnected`);
    }
    
    this.clients.delete(clientId);
    this.rateLimits.delete(clientId);
  }

  // 클라이언트에게 메시지 전송
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  // 사용자에게 메시지 전송
  sendToUser(userId, message) {
    for (const [clientId, client] of this.clients) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  // 구독자에게 브로드캐스트
  broadcast(channel, message) {
    for (const [clientId, client] of this.clients) {
      if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: 'broadcast',
          channel,
          data: message
        }));
      }
    }
  }

  // 모든 클라이언트에게 브로드캐스트
  broadcastAll(message) {
    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  // Rate limiting
  checkRateLimit(clientId) {
    const now = Date.now();
    const limit = config.websocket.messageRateLimit;
    
    if (!this.rateLimits.has(clientId)) {
      this.rateLimits.set(clientId, {
        messages: 1,
        resetTime: now + 1000
      });
      return true;
    }

    const rateLimit = this.rateLimits.get(clientId);
    
    if (now > rateLimit.resetTime) {
      rateLimit.messages = 1;
      rateLimit.resetTime = now + 1000;
      return true;
    }

    if (rateLimit.messages >= limit) {
      return false;
    }

    rateLimit.messages++;
    return true;
  }

  // Heartbeat
  startHeartbeat() {
    setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          // Ping 전송
          client.ws.ping();
          
          // 비활성 연결 체크 (5분)
          if (Date.now() - client.lastActivity > 300000) {
            logger.warn(`Closing inactive connection: ${clientId}`);
            client.ws.close();
          }
        }
      }
    }, 30000); // 30초마다
  }

  // 서버 종료 시 정리
  close() {
    for (const [clientId, client] of this.clients) {
      client.ws.close();
    }
    
    this.wss.close();
    logger.info('WebSocket server closed');
  }
}

module.exports = WebSocketManager;
