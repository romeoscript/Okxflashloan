# 🚀 Simple Flash Loan Bot - Usage Guide

## Overview
This streamlined bot provides automatic token monitoring and flash loan sniping on Solana with a simple Telegram interface.

## 🎯 Core Features
- **Automatic Token Monitoring** - Detects new tokens on Raydium
- **Flash Loan Sniping** - Execute flash loans with one command
- **Embedded Wallets** - Secure wallet management per user
- **Real-time Notifications** - Get notified of new opportunities

## 🚀 Quick Start

### 1. Setup Environment
```bash
# Copy environment file
cp env.example .env

# Edit .env with your settings
TELEGRAM_BOT_TOKEN=your_bot_token
AUTHORIZED_USER_IDS=123456,789012
RPC_ENDPOINT=https://your-rpc-endpoint
```

### 2. Start the Services
```bash
# Terminal 1: Start the API server (for token monitoring)
npm run api

# Terminal 2: Start the bot
npm run bot
```

## 📱 Bot Commands

### Main Commands
- `/start` - Show main menu with buttons
- `/snip <token_address> <amount>` - Execute flash loan sniping
- `/balance` - Check wallet balance
- `/status` - Check monitoring status

### Button Interface
- **👛 Create Wallet** - Create your embedded wallet
- **💰 Wallet Balance** - Check your SOL balance
- **🎯 Start Sniping** - Start automatic token monitoring
- **⏹️ Stop Sniping** - Stop token monitoring
- **📊 Sniping Status** - View current status

## 💡 How to Use

### 1. Create Your Wallet
1. Start the bot with `/start`
2. Click "👛 Create Wallet"
3. Your wallet is created automatically

### 2. Start Monitoring
1. Click "🎯 Start Sniping"
2. Bot automatically monitors for new tokens
3. You'll get notifications when new tokens are detected

### 3. Execute Flash Loans
**Option A: Manual Sniping**
```
/snip EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1
```
- `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` = Token address
- `1` = Amount in SOL

**Option B: From Notifications**
When you get a new token notification, use the provided command:
```
/snip <token_address> <amount>
```

## 🔄 Flash Loan Process
1. **Borrow WSOL** from Solend protocol
2. **Buy Token** using Jupiter DEX
3. **Sell Token** immediately at higher price
4. **Repay Loan** with profit kept in your wallet

## ⚙️ Configuration
The bot uses these default settings:
- **Min Liquidity**: $10,000
- **Max Slippage**: 1%
- **Target Profit**: 3%
- **Max Gas**: 0.001 SOL

## 🛡️ Security
- **Non-custodial**: You control your private keys
- **Encrypted Storage**: Private keys are encrypted
- **User Authorization**: Only authorized users can access
- **Secure Transactions**: All transactions are signed locally

## 📊 Monitoring
The bot monitors:
- **Raydium Fee Account**: `7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5`
- **New LP Creation**: Detects when new liquidity pools are created
- **Token Launches**: Identifies new token launches automatically

## 🚨 Important Notes
- **Gas Fees**: You need SOL for transaction fees
- **Slippage**: Set to 1% by default for safety
- **Liquidity**: Only trades tokens with sufficient liquidity
- **Risk**: Flash loans carry inherent risks - use responsibly

## 🔧 Troubleshooting

### Bot Not Responding
```bash
# Check if API server is running
curl http://localhost:3000/health

# Restart both services
npm run api  # Terminal 1
npm run bot  # Terminal 2
```

### Connection Issues
```bash
# Test RPC connection
npm run test:connection
```

### Wallet Issues
- Delete and recreate wallet if needed
- Ensure you have SOL for gas fees
- Check RPC endpoint is working

## 📈 Example Workflow
1. **Start bot**: `npm run bot`
2. **Create wallet**: Click "👛 Create Wallet"
3. **Start monitoring**: Click "🎯 Start Sniping"
4. **Wait for notification**: Bot detects new token
5. **Execute sniping**: Use `/snip <token> <amount>`
6. **Profit**: Flash loan completes automatically

## 🎯 Success Indicators
- ✅ "Flash Sniping Complete!" message
- ✅ Transaction signature provided
- ✅ Explorer link to verify transaction
- ✅ Profit automatically added to your wallet

The bot is now streamlined and focused on the core functionality you need! 