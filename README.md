# Bybit Mock Trading Server

비트코인 선물 레버리지 100배 모의 거래 서버 (확장 가능한 구조)

## 🚀 특징

- **실시간 시장 데이터**: Bybit WebSocket API 연동
- **100배 레버리지 거래**: 롱/숏 포지션 지원
- **모의 거래 엔진**: 실제와 유사한 거래 환경
- **실시간 PnL 계산**: 미실현/실현 손익 자동 계산
- **강제 청산 시스템**: 마진 콜 자동 처리
- **확장 가능한 구조**: 모듈화된 코드 구조
- **Supabase 연동 준비**: 데이터베이스 연동 준비 완료

## 📁 프로젝트 구조

```
bitapi/
├── server.js              # 메인 서버 파일
├── .env                   # 환경 변수
├── package.json           # 프로젝트 설정
├── ecosystem.config.js    # PM2 설정
├── public/               
│   └── index.html        # 테스트 웹 페이지
├── logs/                 # 로그 디렉토리
└── src/
    ├── config/           # 설정 관리
    │   └── index.js
    ├── controllers/      # API 컨트롤러
    │   └── marketController.js
    ├── models/          # 비즈니스 로직
    │   └── TradingEngine.js
    ├── services/        # 외부 서비스
    │   ├── bybitService.js
    │   └── redisService.js
    ├── utils/           # 유틸리티
    │   └── logger.js
    └── websocket/       # WebSocket 관리
        └── wsManager.js
```

## 🛠 설치 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. Redis 설치 (선택사항)

#### Windows:
- [Redis for Windows](https://github.com/microsoftarchive/redis/releases) 다운로드
- 또는 WSL2 사용

#### Linux/Mac:
```bash
# Ubuntu/Debian
sudo apt install redis-server

# Mac
brew install redis
```

### 3. 환경 변수 설정

`.env` 파일이 이미 생성되어 있습니다. 필요시 수정하세요.

## 🚀 실행 방법

### 개발 모드
```bash
npm run dev
```

### 프로덕션 모드
```bash
npm start
```

### PM2로 실행
```bash
# PM2 설치
npm install -g pm2

# 서버 시작
pm2 start ecosystem.config.js

# 로그 확인
pm2 logs bybit-mock-server

# 모니터링
pm2 monit
```

## 📊 테스트 페이지

브라우저에서 `http://localhost:3001` 접속

### 주요 기능:
- **실시간 차트**: TradingView 스타일 캔들 차트
- **호가창**: 실시간 매수/매도 호가
- **주문 패널**: 시장가/지정가 주문
- **레버리지 조절**: 1x ~ 100x
- **포지션 관리**: 실시간 손익 표시
- **자동 청산**: 마진 부족시 자동 청산

## 📡 WebSocket API

### 연결
```javascript
const ws = new WebSocket('ws://localhost:3001');
```

### 인증
```javascript
ws.send(JSON.stringify({
  action: 'auth',
  payload: { userId: 'optional-user-id' }
}));
```

### 주문 생성
```javascript
ws.send(JSON.stringify({
  action: 'place_order',
  payload: {
    side: 'Buy', // 'Buy' or 'Sell'
    orderType: 'Market', // 'Market' or 'Limit'
    qty: 0.001,
    leverage: 100,
    stopLoss: 45000, // optional
    takeProfit: 55000 // optional
  }
}));
```

## 🔧 REST API

### 시장 데이터
- `GET /api/market/ticker` - 현재 가격
- `GET /api/market/kline` - K선 데이터
- `GET /api/market/orderbook` - 호가창
- `GET /api/market/trades` - 최근 거래

### 거래 API
- `POST /api/trade/order` - 주문 생성
- `DELETE /api/trade/order/:orderId` - 주문 취소
- `POST /api/trade/position/close` - 포지션 청산

## 🔄 확장 계획

### Phase 1 (현재)
- ✅ 기본 거래 기능
- ✅ 실시간 시장 데이터
- ✅ WebSocket 통신
- ✅ 모의 거래 엔진

### Phase 2 (예정)
- [ ] Supabase 데이터베이스 연동
- [ ] 사용자 인증 시스템
- [ ] 거래 내역 저장
- [ ] 리더보드 기능

### Phase 3 (예정)
- [ ] 고급 주문 유형 (OCO, 트레일링 스탑)
- [ ] 거래 전략 백테스팅
- [ ] 소셜 트레이딩 기능
- [ ] 모바일 앱 지원

## ⚙️ AWS Lightsail 배포

### 1. 서버 준비
```bash
# Node.js 18.x 설치
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Redis 설치
sudo apt install redis-server
sudo systemctl enable redis-server
```

### 2. 프로젝트 배포
```bash
# 코드 클론
git clone [your-repo]
cd bitapi

# 패키지 설치
npm install

# PM2 설치 및 실행
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 startup
pm2 save
```

### 3. Nginx 설정 (선택)
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 📝 주의사항

1. **모의 거래 전용**: 실제 자금이 아닌 가상 자금으로 거래
2. **교육 목적**: 실제 거래 전 연습용
3. **데이터 정확성**: 실시간 시장 데이터는 Bybit API 제공
4. **보안**: 프로덕션 환경에서는 JWT_SECRET 변경 필수

## 🤝 기여

버그 리포트, 기능 제안 환영합니다.

## 📄 라이선스

MIT License