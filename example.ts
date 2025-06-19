import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { buildSimulatedFlashLoanInstructions } from "./sdk/flash_swap";
import { Wallet } from "@coral-xyz/anchor";
import { SOLANA_PRIVATE_KEY, SOLANA_RPC_URL, USDC_MINT_KEY, SOLEND_ENVIRONMENT } from "./sdk/const";
import bs58 from "bs58";
import { LaunchDetector } from './sdk/launch_detector';
import * as dotenv from 'dotenv';
import { SnipingBot } from './sdk/telegram_bot';

// Load environment variables
dotenv.config();

// Telegram bot token and authorized user IDs
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_USER_IDS = (process.env.AUTHORIZED_USER_IDS || '').split(',').map(id => parseInt(id.trim()));

// Validate environment variables
if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

if (AUTHORIZED_USER_IDS.length === 0) {
    console.error('AUTHORIZED_USER_IDS is not set in .env file');
    process.exit(1);
}

// At this point, TELEGRAM_BOT_TOKEN is guaranteed to be a string
const BOT_TOKEN: string = TELEGRAM_BOT_TOKEN;

async function main() {
    // Initialize Solana connection
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');

    // Initialize the launch detector with configuration
    const detector = new LaunchDetector(
        connection,
        {
            minLiquidity: 10000,    // $10k minimum liquidity
            maxSlippage: 0.01,      // 1% max slippage
            targetProfitPercentage: 0.03, // 3% target profit
            maxGasPrice: 1000000,   // 0.001 SOL max gas
            dexes: ['raydium', 'jupiter'],
            blockWindow: 10         // Monitor 10 blocks after launch
        },
        {
            maxPositionSize: 1000, // Maximum position size in USD
            minLiquidityRatio: 10, // Minimum liquidity ratio (position size : liquidity)
            volatilityMultiplier: 1.0, // Adjust position size based on volatility
            maxRiskPerTrade: 100, // Maximum risk per trade in USD
            minProfitThreshold: 0.03 // Minimum profit threshold (3%)
        }
    );

    // Initialize the Telegram bot
    const bot = new SnipingBot(BOT_TOKEN, detector, AUTHORIZED_USER_IDS);

    // Set up event listeners for the detector
    detector.on('newLaunch', (launch) => {
        console.log('New token launch detected:', {
            token: launch.tokenAddress.toString(),
            pool: launch.poolAddress.toString(),
            dex: launch.dex,
            initialPrice: launch.initialPrice,
            liquidity: launch.liquidity
        });
    });

    detector.on('priceUpdate', (update) => {
        if (update.position) {
            console.log('Price update:', {
                token: update.launch.tokenAddress.toString(),
                currentPrice: update.currentPrice,
                priceChange: update.priceChange,
                positionSize: update.position.size,
                pnl: ((update.currentPrice - update.position.entryPrice) / update.position.entryPrice) * 100
            });
        }
    });

    detector.on('sellExecuted', (result) => {
        console.log('Position closed:', {
            token: result.tokenAddress.toString(),
            entryPrice: result.entryPrice,
            exitPrice: result.exitPrice,
            positionSize: result.positionSize,
            pnl: result.pnl
        });
    });

    detector.on('sellError', (error) => {
        console.error('Error executing sell:', {
            token: error.tokenAddress.toString(),
            error: error.error
        });
    });

    // Initialize and start monitoring
    await detector.initialize();

    // Handle process termination
    process.on('SIGINT', async () => {
        console.log('\nGracefully shutting down...');
        await detector.stopMonitoring();
        await bot.stop();
        process.exit(0);
    });

    console.log('Memecoin sniping system started. Press Ctrl+C to stop.');
}

// Additional helper function to test with different amounts
async function testWithDifferentAmounts() {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
    const wallet = new Wallet(keypair);
    
    const amounts = ["100000", "500000", "1000000"]; // 0.1, 0.5, 1 USDC
    
    for (const amount of amounts) {
        console.log(`\n🧪 Testing with ${parseFloat(amount) / 1e6} USDC...`);
        try {
            const result = await buildSimulatedFlashLoanInstructions({
                targetTokenMint: USDC_MINT_KEY,
                desiredTargetAmount: amount,
                slippageBps: 100,
                connection,
                wallet
            });
            
            const simulation = await connection.simulateTransaction(result.transaction);
            console.log(`${simulation.value.err ? '❌' : '✅'} Amount ${parseFloat(amount) / 1e6} USDC: ${simulation.value.err ? 'Failed' : 'Success'}`);
            
        } catch (error: any) {
            console.log(`❌ Amount ${parseFloat(amount) / 1e6} USDC: ${error.message}`);
        }
    }
}

// Run the main function
main().catch(console.error);

// Uncomment to test different amounts
// testWithDifferentAmounts().catch(console.error);