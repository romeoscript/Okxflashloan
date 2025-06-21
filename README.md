# OKX Flashloan Service - Solana Token Monitor

This service monitors new token listings on Raydium DEX by watching the Raydium fee account for new transactions.

## Prerequisites

- Node.js 16+ installed
- A Solana RPC endpoint with WebSocket support (recommended providers: QuickNode, Helius, or Alchemy)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/okx-flashloan-service.git
cd okx-flashloan-service
```

2. Install dependencies:
```bash
npm install
```

3. Update the RPC endpoint:
Edit `src/constants.ts` and replace the default RPC URL with your own endpoint:
```typescript
export const solanaConnection = new Connection('YOUR_RPC_ENDPOINT', {
  commitment: 'confirmed',
  wsEndpoint: 'YOUR_WSS_ENDPOINT'
});
```

## Usage

1. Build the project:
```bash
npm run build
```

2. Start the monitoring service:
```bash
npm start
```

Or run in development mode:
```bash
npm run dev
```

## Data Storage

The service stores new token data in `src/data/new_solana_tokens.json`. Each entry contains:
- Transaction signature
- Token creator address
- Base token information (address, decimals, LP amount)
- Quote token information (SOL)
- Transaction logs

Error logs are stored in `errorNewLpsLogs.txt`.

## Important Notes

- The service requires a reliable RPC endpoint with WebSocket support for proper functionality
- High-quality RPC providers are recommended for production use
- The service monitors the Raydium fee account: `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1`

# Solana Flash Loan SDK

A TypeScript SDK for Solana flash loans with Jupiter DEX integration, featuring automated token monitoring and arbitrage detection.

## Features

- **Flash Loan Execution**: Execute flash loans on Solana using Jupiter DEX
- **Launch Detection**: Monitor for new token launches and liquidity additions
- **Arbitrage Detection**: Identify arbitrage opportunities across DEXes
- **Telegram Bot Integration**: Real-time notifications and control via Telegram
- **New Token Monitoring**: Monitor Raydium for new token launches
- **REST API**: Full REST API for all functionality

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start the API server**:
   ```bash
   npm run api
   ```

4. **Start the bot** (optional):
   ```bash
   npm run bot
   ```

## API Endpoints

### Flash Swap Endpoints

- `POST /flashswap/execute` - Execute a flash swap
- `GET /flashswap/quote` - Get a flash swap quote

### Launch Detection Endpoints

- `GET /launches/active` - Get all active launches
- `POST /launches/start` - Start monitoring for new launches
- `POST /launches/stop` - Stop monitoring for launches
- `GET /positions` - Get all active positions

### New Token Monitoring Endpoints

The new token monitoring system tracks new token launches on Raydium and provides real-time data through REST endpoints.

#### Start Monitoring
```http
POST /tokens/monitor/start
```
Starts monitoring for new token launches on Raydium.

**Response:**
```json
{
  "status": "started",
  "message": "New token monitoring has been started successfully"
}
```

#### Stop Monitoring
```http
POST /tokens/monitor/stop
```
Stops the new token monitoring.

**Response:**
```json
{
  "status": "stopped",
  "message": "New token monitoring has been stopped successfully"
}
```

#### Get Monitoring Status
```http
GET /tokens/monitor/status
```
Returns the current monitoring status.

**Response:**
```json
{
  "isMonitoring": true,
  "message": "New token monitoring is active"
}
```

#### Get All New Tokens
```http
GET /tokens/new
```
Returns all detected new tokens.

**Response:**
```json
{
  "tokens": [
    {
      "lpSignature": "5J7X...",
      "creator": "9WzDX...",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "baseInfo": {
        "baseAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "baseDecimals": 6,
        "baseLpAmount": 1000000
      },
      "quoteInfo": {
        "quoteAddress": "So11111111111111111111111111111111111111112",
        "quoteDecimals": 9,
        "quoteLpAmount": 0.5
      },
      "logs": ["Program log: ..."]
    }
  ],
  "count": 1
}
```

#### Get Recent New Tokens
```http
GET /tokens/new/recent?limit=10
```
Returns the most recent new tokens with optional limit parameter.

**Parameters:**
- `limit` (optional): Number of recent tokens to return (default: 10)

**Response:**
```json
{
  "tokens": [...],
  "count": 5,
  "total": 25
}
```

## Bot Integration

The bot now includes both launch detection and token monitoring capabilities in a single unified system.

### Features

**Launch Detection (Original):**
- Monitors DEX pools for new token launches
- Automatic trading with position management
- Auto-selling based on profit targets and stop losses
- Price tracking and PnL calculation

**Token Monitoring (New):**
- Real-time monitoring of Raydium for new token launches
- Detailed token information (creator, liquidity, amounts)
- Rich Telegram notifications with formatted messages
- Graceful fallback if API is unavailable

### How to Use

1. **Start the API server** (for token monitoring):
   ```bash
   npm run api
   ```

2. **Start the unified bot**:
   ```bash
   npm run bot
   ```

3. **Or run both together**:
   ```bash
   npm run dev:all
   ```

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
AUTHORIZED_USER_IDS=123456,789012
RPC_ENDPOINT=https://your-rpc-endpoint

# Optional (for token monitoring API)
API_BASE_URL=http://localhost:3000
```

### Bot Capabilities

The unified bot will:

1. **Launch Detection**: Monitor for new token launches and execute trades automatically
2. **Token Monitoring**: Detect new tokens on Raydium and send detailed notifications
3. **Dual Notifications**: Send both launch detection and token monitoring alerts
4. **Graceful Fallback**: Continue working even if the token monitoring API is unavailable

### Example Notifications

**Launch Detection:**
```
🚀 New token launch detected: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

**Token Monitoring:**
```
🆕 New Token Detected!
📝 Signature: 5J7X...
👤 Creator: 9WzDX...
🪙 Base Token: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
💰 Base Amount: 1000000
💎 Quote Token: So11111111111111111111111111111111111111112
💵 Quote Amount: 0.5
⏰ Time: 1/15/2024, 10:30:00 AM
```

### Customization

You can add your own analysis logic in the `analyzeNewToken` function in `bot.ts`:

```typescript
async function analyzeNewToken(token: any) {
    // Your custom analysis logic here
    const liquidityUSD = token.quoteInfo.quoteLpAmount * 100;
    
    if (liquidityUSD > 10000) {
        // High liquidity token - take action
        await executeStrategy(token);
    }
    
    // Check for arbitrage opportunities
    await checkArbitrageOpportunity(token);
}
```

## Development

```bash
# Run API server in development mode
npm run dev:api

# Run bot in development mode
npm run dev:bot

# Run both API and bot concurrently
npm run dev:all

# Build for production
npm run build
```

## Architecture

The system consists of several components:

1. **API Server** (`server.ts`): REST API endpoints for all functionality
2. **Bot** (`bot.ts`): Telegram bot for notifications and control
3. **Launch Detector** (`sdk/launch_detector.ts`): Monitors for new token launches
4. **Flash Swap** (`sdk/flash_swap.ts`): Executes flash loan transactions
5. **New Token Monitor** (`src/monitorNewTokens.ts`): Monitors Raydium for new tokens

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC
