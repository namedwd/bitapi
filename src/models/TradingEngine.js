// models/TradingEngine.js - 모의 거래 엔진
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');
const config = require('../config');
const logger = require('../utils/logger');
const cacheService = require('../services/cacheService'); // 통합 캐시 서비스 사용

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.users = new Map();
    this.positions = new Map();
    this.orders = new Map();
    this.orderBook = {
      bids: [],
      asks: []
    };
    this.currentPrice = 50000;
    this.priceUpdateInterval = null;
  }

  // 사용자 초기화
  async initUser(userId) {
    if (this.users.has(userId)) {
      return this.users.get(userId);
    }

    const user = {
      userId,
      balance: {
        USDT: config.trading.initialBalance,
        availableBalance: config.trading.initialBalance,
        marginUsed: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        totalEquity: config.trading.initialBalance
      },
      positions: [],
      orders: [],
      tradeHistory: [],
      createdAt: Date.now()
    };

    this.users.set(userId, user);
    this.positions.set(userId, []);
    this.orders.set(userId, []);

    // 캐시에 저장
    await cacheService.hset('users', userId, user);

    logger.info(`User initialized: ${userId}`);
    return user;
  }

  // 현재 가격 업데이트
  updateCurrentPrice(price) {
    this.currentPrice = parseFloat(price);
    this.emit('priceUpdate', this.currentPrice);
    
    // 모든 포지션의 미실현 손익 업데이트
    this.updateAllPositionsPnL();
    
    // 대기 중인 지정가 주문 체크
    this.checkPendingOrders();
  }

  // 주문 생성
  async createOrder(userId, orderData) {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const {
      side, // Buy or Sell
      orderType, // Market or Limit
      qty,
      price,
      leverage = config.trading.defaultLeverage,
      stopLoss,
      takeProfit,
      reduceOnly = false
    } = orderData;

    // 레버리지 검증
    if (leverage > config.trading.maxLeverage) {
      throw new Error(`Maximum leverage is ${config.trading.maxLeverage}x`);
    }

    // 주문 가격 결정
    const executionPrice = orderType === 'Market' ? this.currentPrice : parseFloat(price);
    
    // 필요 증거금 계산
    const orderValue = qty * executionPrice;
    const requiredMargin = orderValue / leverage;
    const fee = orderValue * (orderType === 'Market' ? config.trading.takerFee : config.trading.makerFee);

    // 잔고 확인
    if (!reduceOnly && user.balance.availableBalance < (requiredMargin + fee)) {
      throw new Error('Insufficient balance');
    }

    const order = {
      orderId: uuidv4(),
      userId,
      symbol: 'BTCUSDT',
      side,
      orderType,
      qty: parseFloat(qty),
      price: executionPrice,
      leverage,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      reduceOnly,
      status: orderType === 'Market' ? 'Filled' : 'New',
      createdTime: Date.now(),
      updatedTime: Date.now(),
      filledQty: 0,
      avgPrice: 0,
      fee: 0
    };

    // Market 주문은 즉시 체결
    if (orderType === 'Market') {
      return await this.executeOrder(order);
    }

    // Limit 주문은 대기 목록에 추가
    const userOrders = this.orders.get(userId);
    userOrders.push(order);
    
    this.emit('orderCreated', order);
    logger.info(`Order created: ${order.orderId}`);
    
    return order;
  }

  // 주문 체결
  async executeOrder(order) {
    const user = this.users.get(order.userId);
    const userPositions = this.positions.get(order.userId);
    
    // 수수료 계산
    const orderValue = order.qty * order.price;
    order.fee = orderValue * (order.orderType === 'Market' ? config.trading.takerFee : config.trading.makerFee);
    order.filledQty = order.qty;
    order.avgPrice = order.price;
    order.status = 'Filled';
    order.updatedTime = Date.now();

    // 기존 포지션 찾기
    let position = userPositions.find(p => p.symbol === 'BTCUSDT');

    if (position) {
      // 기존 포지션 업데이트
      if (position.side === order.side && !order.reduceOnly) {
        // 같은 방향 - 포지션 추가
        const totalQty = position.qty + order.qty;
        const totalValue = (position.qty * position.avgPrice) + (order.qty * order.price);
        
        position.qty = totalQty;
        position.avgPrice = totalValue / totalQty;
        position.leverage = order.leverage;
        position.updatedTime = Date.now();
      } else {
        // 반대 방향 또는 포지션 감소
        if (position.qty > order.qty) {
          // 부분 청산
          const closedQty = order.qty;
          const pnl = this.calculatePnl(position, order.price, closedQty);
          
          position.qty -= closedQty;
          position.realizedPnl += pnl;
          user.balance.realizedPnl += pnl;
          user.balance.USDT += pnl;
        } else if (position.qty < order.qty && !order.reduceOnly) {
          // 포지션 전환
          const closedQty = position.qty;
          const pnl = this.calculatePnl(position, order.price, closedQty);
          
          user.balance.realizedPnl += pnl;
          user.balance.USDT += pnl;
          
          // 새 포지션 생성
          position.side = order.side;
          position.qty = order.qty - closedQty;
          position.avgPrice = order.price;
          position.leverage = order.leverage;
          position.realizedPnl = 0;
          position.unrealizedPnl = 0;
          position.createdTime = Date.now();
        } else {
          // 완전 청산
          const pnl = this.calculatePnl(position, order.price, position.qty);
          
          user.balance.realizedPnl += pnl;
          user.balance.USDT += pnl;
          
          const index = userPositions.indexOf(position);
          userPositions.splice(index, 1);
          position = null;
        }
      }
    } else if (!order.reduceOnly) {
      // 새 포지션 생성
      position = {
        positionId: uuidv4(),
        userId: order.userId,
        symbol: 'BTCUSDT',
        side: order.side,
        qty: order.qty,
        avgPrice: order.price,
        markPrice: this.currentPrice,
        leverage: order.leverage,
        unrealizedPnl: 0,
        realizedPnl: 0,
        marginUsed: 0,
        maintenanceMargin: 0,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        createdTime: Date.now(),
        updatedTime: Date.now()
      };
      
      userPositions.push(position);
    }

    // 증거금 업데이트
    if (position) {
      position.marginUsed = (position.qty * position.avgPrice) / position.leverage;
      position.maintenanceMargin = position.marginUsed * config.trading.maintenanceMarginRate;
      
      // 사용자 잔고 업데이트
      let totalMarginUsed = 0;
      userPositions.forEach(p => {
        totalMarginUsed += p.marginUsed;
      });
      
      user.balance.marginUsed = totalMarginUsed;
      user.balance.availableBalance = user.balance.USDT - totalMarginUsed;
    }

    // 수수료 차감
    user.balance.USDT -= order.fee;
    user.balance.availableBalance -= order.fee;

    // 거래 내역 추가
    user.tradeHistory.push({
      tradeId: uuidv4(),
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      price: order.price,
      qty: order.qty,
      fee: order.fee,
      realizedPnl: 0,
      time: Date.now()
    });

    this.emit('orderFilled', order);
    this.emit('positionUpdate', { userId: order.userId, position });
    
    logger.info(`Order executed: ${order.orderId}`);
    return order;
  }

  // 포지션 청산
  async closePosition(userId, positionId, closeQty = null) {
    const userPositions = this.positions.get(userId);
    const user = this.users.get(userId);
    
    const position = userPositions.find(p => p.positionId === positionId);
    if (!position) {
      throw new Error('Position not found');
    }

    const qtyToClose = closeQty || position.qty;
    if (qtyToClose > position.qty) {
      throw new Error('Close quantity exceeds position size');
    }

    // 반대 방향 시장가 주문 생성
    const closeOrder = await this.createOrder(userId, {
      side: position.side === 'Buy' ? 'Sell' : 'Buy',
      orderType: 'Market',
      qty: qtyToClose,
      leverage: position.leverage,
      reduceOnly: true
    });

    return closeOrder;
  }

  // PnL 계산
  calculatePnl(position, exitPrice, qty = null) {
    const quantity = qty || position.qty;
    
    if (position.side === 'Buy') {
      return (exitPrice - position.avgPrice) * quantity;
    } else {
      return (position.avgPrice - exitPrice) * quantity;
    }
  }

  // 모든 포지션 PnL 업데이트
  updateAllPositionsPnL() {
    for (const [userId, userPositions] of this.positions) {
      for (const position of userPositions) {
        position.markPrice = this.currentPrice;
        position.unrealizedPnl = this.calculatePnl(position, this.currentPrice);
        
        // 강제 청산 체크
        this.checkLiquidation(userId, position);
      }
      
      // 사용자 잔고 업데이트
      const user = this.users.get(userId);
      if (user) {
        let totalUnrealizedPnl = 0;
        userPositions.forEach(p => {
          totalUnrealizedPnl += p.unrealizedPnl;
        });
        
        user.balance.unrealizedPnl = totalUnrealizedPnl;
        user.balance.totalEquity = user.balance.USDT + totalUnrealizedPnl;
        
        this.emit('balanceUpdate', { userId, balance: user.balance });
      }
    }
  }

  // 강제 청산 체크
  async checkLiquidation(userId, position) {
    const user = this.users.get(userId);
    
    // 유지 증거금 비율 계산
    const equity = user.balance.USDT + position.unrealizedPnl;
    const maintenanceMarginRatio = position.maintenanceMargin / equity;
    
    if (maintenanceMarginRatio >= config.trading.liquidationThreshold) {
      logger.warn(`Liquidating position ${position.positionId} for user ${userId}`);
      
      // 강제 청산 실행
      await this.closePosition(userId, position.positionId);
      
      this.emit('liquidation', {
        userId,
        positionId: position.positionId,
        reason: 'Insufficient margin',
        loss: position.unrealizedPnl
      });
    }
  }

  // 대기 중인 지정가 주문 체크
  checkPendingOrders() {
    for (const [userId, userOrders] of this.orders) {
      for (const order of userOrders) {
        if (order.status !== 'New') continue;
        
        // 체결 조건 확인
        const shouldFill = 
          (order.side === 'Buy' && this.currentPrice <= order.price) ||
          (order.side === 'Sell' && this.currentPrice >= order.price);
        
        if (shouldFill) {
          this.executeOrder(order);
          
          // 체결된 주문 제거
          const index = userOrders.indexOf(order);
          userOrders.splice(index, 1);
        }
      }
    }
  }

  // 주문 취소
  cancelOrder(userId, orderId) {
    const userOrders = this.orders.get(userId);
    if (!userOrders) {
      throw new Error('User not found');
    }

    const orderIndex = userOrders.findIndex(o => o.orderId === orderId);
    if (orderIndex === -1) {
      throw new Error('Order not found');
    }

    const order = userOrders[orderIndex];
    if (order.status !== 'New') {
      throw new Error('Cannot cancel filled order');
    }

    order.status = 'Cancelled';
    order.updatedTime = Date.now();
    
    userOrders.splice(orderIndex, 1);
    
    this.emit('orderCancelled', order);
    logger.info(`Order cancelled: ${orderId}`);
    
    return order;
  }

  // 사용자 데이터 조회
  getUserData(userId) {
    const user = this.users.get(userId);
    if (!user) {
      return null;
    }

    return {
      user,
      positions: this.positions.get(userId) || [],
      orders: this.orders.get(userId) || []
    };
  }

  // 리더보드 조회
  getLeaderboard(limit = 10) {
    const leaderboard = [];
    
    for (const [userId, user] of this.users) {
      leaderboard.push({
        userId,
        totalEquity: user.balance.totalEquity,
        realizedPnl: user.balance.realizedPnl,
        unrealizedPnl: user.balance.unrealizedPnl,
        winRate: this.calculateWinRate(userId)
      });
    }

    return leaderboard
      .sort((a, b) => b.totalEquity - a.totalEquity)
      .slice(0, limit);
  }

  // 승률 계산
  calculateWinRate(userId) {
    const user = this.users.get(userId);
    if (!user || user.tradeHistory.length === 0) {
      return 0;
    }

    const wins = user.tradeHistory.filter(t => t.realizedPnl > 0).length;
    return (wins / user.tradeHistory.length) * 100;
  }

  // 현재 가격 조회 (캐시 활용)
  async getCurrentPrice() {
    try {
      const cachedPrice = await cacheService.get('current_price');
      if (cachedPrice) return parseFloat(cachedPrice);
      
      // 캐시에 가격이 없으면 현재 가격 사용
      return this.currentPrice || 50000;
    } catch (error) {
      logger.error('Error fetching price:', error);
      return this.currentPrice || 50000;
    }
  }
}

module.exports = TradingEngine;