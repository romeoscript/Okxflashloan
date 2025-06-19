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
