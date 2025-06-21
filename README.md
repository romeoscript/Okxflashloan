# OKX Flashloan Service - Solana Token Monitor

A comprehensive Solana token monitoring and flash loan arbitrage service with Telegram bot integration.

## 🚀 Features

### Token Monitoring
- **Real-time token detection** on Solana
- **REST API endpoints** for monitoring control
- **Telegram bot integration** with rich notifications
- **Automatic position management** with profit targets

### Flash Loan Arbitrage
- **Flash loan execution** using Solend protocol
- **Jupiter DEX integration** for token swaps
- **Profit monitoring** with customizable targets (3-5%)
- **Real-time price tracking** with automatic execution
- **Telegram commands** for easy control

## 📋 Quick Start

### Prerequisites
- Node.js 18+
- Solana CLI tools
- Telegram Bot Token
- Solana wallet with SOL for gas fees

### Installation
```bash
git clone https://github.com/yourusername/okx-flashloan-service.git
cd okx-flashloan-service
npm install
```

### Configuration
1. Copy `.env.example` to `.env`
2. Set your configuration:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
SOLANA_PRIVATE_KEY=your_wallet_private_key
AUTHORIZED_USER_IDS=123456789,987654321
```

### Running the Service
```bash
# Start the API server
npm run server

# Start the Telegram bot
npm run bot

# Start both services
npm start
```

## 🔄 Flash Arbitrage Flow

The flash arbitrage system works as follows:

1. **Monitor for new tokens** - Bot automatically detects new token launches via Raydium monitoring
2. **User views recent tokens** - Use `/recent` command to see detected tokens
3. **User inputs token + amount** - Execute flash arbitrage on any detected token
4. **Wait for profit target** - Monitor price until 3-5% increase
5. **Execute flash loan** - Borrow WSOL from Solend
6. **Buy token** - Swap borrowed WSOL for target token
7. **Sell immediately** - Swap token back to WSOL at higher price
8. **Repay loan** - Repay borrowed WSOL + fee with profit

### Telegram Commands

#### Token Monitoring
```bash
/recent - View recent tokens for flash arbitrage
```

#### Flash Arbitrage (Recommended)
```bash
# Wait for 3% profit (default)
/flasharbitrage <token_mint> <amount>

# Wait for 5% profit
/flasharbitrage <token_mint> <amount> 5

# Examples
/flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000
/flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000 5
```

#### Immediate Flash Swap
```bash
# Execute immediately without waiting
/flashswap <token_mint> <amount>

# Get quote first
/flashquote <token_mint> <amount>
```

### Example Usage

1. **Start the bot:**
   ```bash
   npm run bot
   ```

2. **View recent tokens:**
   ```
   /recent
   ```

3. **Execute flash arbitrage on a detected token:**
   ```
   /flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000 5
   ```

4. **Bot will automatically:**
   - Monitor price in real-time
   - Wait for 5% increase
   - Execute flash loan when target reached
   - Send transaction confirmation

### Automatic Token Detection

The bot automatically:
- **Monitors Raydium** for new token launches
- **Sends notifications** with token details and flash arbitrage suggestions
- **Provides quick commands** to execute flash arbitrage immediately
- **Tracks liquidity** and creator information for each token

## 📊 API Endpoints

### Token Monitoring
- `POST /monitor/start` - Start token monitoring
- `POST /monitor/stop` - Stop token monitoring
- `GET /monitor/status` - Get monitoring status
- `GET /monitor/tokens` - Get new tokens data

### Flash Swap
- `POST /flashswap/execute` - Execute flash swap
- `GET /flashswap/quote` - Get flash swap quote

## 🛠️ Architecture

The service consists of several key components:

1. **Token Monitor** (`monitorNewTokens.ts`): Detects new token launches
2. **Launch Detector** (`sdk/launch_detector.ts`): Manages trading positions
3. **Flash Swap** (`sdk/flash_swap.ts`): Executes flash loan transactions
4. **Telegram Bot** (`sdk/telegram_bot.ts`): User interface and notifications
5. **API Server** (`server.ts`): REST endpoints for external integration

## 🔧 Configuration

### Bot Settings
- `minLiquidity`: Minimum liquidity in USD
- `maxSlippage`: Maximum allowed slippage
- `targetProfitPercentage`: Target profit percentage
- `maxGasPrice`: Maximum gas price in lamports

### Position Sizing
- `maxPositionSize`: Maximum position size in USD
- `minLiquidityRatio`: Minimum liquidity ratio
- `maxRiskPerTrade`: Maximum risk per trade
- `minProfitThreshold`: Minimum profit threshold

## 📈 Monitoring Features

### Real-time Notifications
- New token launches
- Price updates
- Position changes
- Trade executions
- Error alerts

### Rich Telegram Interface
- Inline keyboards for easy control
- Formatted messages with emojis
- Real-time status updates
- Transaction links

## 🚨 Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## ⚠️ Disclaimer

This software is for educational purposes only. Flash loans carry significant risks including:
- Smart contract vulnerabilities
- Market volatility
- Gas fee fluctuations
- Liquidity constraints

Use at your own risk and never invest more than you can afford to lose.
