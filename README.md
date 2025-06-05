# Solana Flash Loan Service

A TypeScript service that enables flash loan operations on Solana on any OKX DEX API tokens.

## Features

- Flash loan borrowing and repayment using Solend Protocol
- Token swaps using OKX DEX aggregator
- Automatic Associated Token Account (ATA) creation
- Support for custom user instructions
- Transaction simulation before execution
- Slippage protection
- Rate estimation for token swaps

## Prerequisites

- Node.js (v16 or higher)
- Solana CLI tools
- A Solana wallet with SOL
- OKX API credentials

## Installation

1. Clone the repository:
```bash
git clone https://github.com/s29papi/OKX-FLASHLOAN-SERVICE
cd OKX-FLASHLOAN-SERVICE
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
OKX_API_KEY=your_okx_api_key
OKX_SECRET_KEY=your_okx_secret_key
OKX_API_PASSPHRASE=your_okx_passphrase
OKX_PROJECT_ID=your_okx_project_id
SOLANA_RPC_URL=your_solana_rpc_url
SOLANA_PRIVATE_KEY=your_solana_private_key
```

## Usage

### Basic Flash Loan with Token Swap

```typescript
import { buildSimulatedFlashLoanInstructions } from './sdk/flash_swap';
import { Connection, PublicKey } from '@solana/web3.js';
import { Wallet } from '@okx-dex/okx-dex-sdk';

async function executeFlashLoan() {
    const connection = new Connection(process.env.SOLANA_RPC_URL!);
    const wallet = new Wallet(/* your wallet implementation */);
    
    const targetTokenMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
    const desiredAmount = "1000"; // Amount in target token decimals
    
    const { instructions, lookupTableAccounts } = await buildSimulatedFlashLoanInstructions({
        targetTokenMint,
        desiredTargetAmount: desiredAmount,
        slippage: "0.1",
        connection,
        wallet
    });
    
    // Execute the transaction
    // ... your transaction execution logic
}
```

### Adding Custom Instructions

You can add custom instructions to be executed between the flash loan borrow and repay:

```typescript
const customInstructions = [
    // Your custom instructions here
];

const { instructions, lookupTableAccounts } = await buildSimulatedFlashLoanInstructions({
    targetTokenMint,
    desiredTargetAmount: desiredAmount,
    userInstructions: customInstructions,
    connection,
    wallet
});
```

## Configuration

The service uses several constants defined in `sdk/const.ts`:

- `LENDING_PROGRAM_ID`: Solend Protocol program ID
- `SUPPLYPUBKEY`: Liquidity address
- `LENDING_MARKET`: Reserve lending market
- `RESERVE_ADDRESS`: Reserve address
- `FEE_RECEIVER_ADDRESS`: Fee receiver address
- `WSOL_MINT_KEY`: WSOL mint address

## Important Notes

1. Always simulate transactions before executing them
2. Ensure sufficient SOL for transaction fees
3. Consider slippage when swapping tokens
4. The service automatically creates ATAs if they don't exist
5. Flash loans must be repaid within the same transaction

## Error Handling

The service includes error handling for:
- Missing token accounts
- Failed simulations
- Invalid API responses
- Lookup table loading failures

## Security Considerations

1. Never commit your `.env` file
2. Keep your private keys secure
3. Use appropriate slippage values
4. Test with small amounts first
5. Monitor transaction simulations

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT
