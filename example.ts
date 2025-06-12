import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { buildSimulatedFlashLoanInstructions } from "./sdk/flash_swap";
import { Wallet } from "@coral-xyz/anchor";
import { SOLANA_PRIVATE_KEY, SOLANA_RPC_URL, USDC_MINT_KEY, SOLEND_ENVIRONMENT } from "./sdk/const";
import bs58 from "bs58";
import { LaunchDetector } from './sdk/launch_detector';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    // Use the RPC URL directly from environment
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

    // Create wallet from private key
    const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
    const wallet = new Wallet(keypair);

    console.log(`🔗 Network: ${SOLEND_ENVIRONMENT}`);
    console.log(`👛 Wallet: ${wallet.publicKey.toString()}`);
    
    const balance = await connection.getBalance(wallet.publicKey) / 1e9;
    console.log(`💰 Balance: ${balance} SOL`);

    // Check if wallet has enough SOL for fees
    if (balance < 0.01) {
        console.log(`\n❌ Insufficient SOL for transaction fees!`);
        if (SOLEND_ENVIRONMENT === 'devnet') {
            console.log(`💡 Get devnet SOL from: https://faucet.solana.com/`);
        } else {
            console.log(`💡 You need at least 0.01 SOL for transaction fees`);
        }
        return;
    }

    // Target token (USDC in this example)
    const targetTokenMint = USDC_MINT_KEY;
    
    // Desired amount in the target token's smallest unit
    // For USDC (6 decimals), 1000000 = 1 USDC
    const desiredTargetAmount = "1000000"; // 1 USDC
    
    console.log(`\n🔄 Building flash loan transaction:`);
    console.log(`📄 Target token: ${targetTokenMint.toString()}`);
    console.log(`💵 Desired amount: ${desiredTargetAmount} (${parseFloat(desiredTargetAmount) / 1e6} USDC)`);

    try {
        // Build the flash loan transaction
        console.log(`\n⏳ Fetching Jupiter quote...`);
        const result = await buildSimulatedFlashLoanInstructions({
            targetTokenMint, 
            desiredTargetAmount,
            slippageBps: 100, // 1% slippage
            connection, 
            wallet
        });

        console.log(`\n✅ Transaction built successfully!`);
        console.log(`📊 Expected output: ${result.estimatedOutput}`);
        console.log(`📈 Price impact: ${result.priceImpact}%`);
        console.log(`🛣️  Route: ${result.route.length} steps`);
        console.log(`💰 Borrowed amount: ${result.borrowedAmount} lamports`);
        console.log(`🏦 WSOL account: ${result.addresses.wsolAccount.toString()}`);

        // Simulate the transaction
        console.log(`\n🧪 Simulating transaction...`);
        const simulation = await connection.simulateTransaction(result.transaction);
        
        if (simulation.value.err) {
            console.error("❌ Simulation failed:", simulation.value.err);
            if (simulation.value.logs) {
                console.error("📋 Transaction logs:");
                simulation.value.logs.forEach((log, i) => {
                    console.error(`  ${i + 1}. ${log}`);
                });
            }
            
            // Provide specific error guidance
            const errorString = JSON.stringify(simulation.value.err);
            if (errorString.includes('InvalidAccountData')) {
                console.log(`\n💡 InvalidAccountData error suggests an account issue.`);
                console.log(`Check that all accounts exist and have the correct data.`);
            } else if (errorString.includes('InsufficientFunds')) {
                console.log(`\n💡 Insufficient funds - you may need more SOL for fees.`);
            } else if (errorString.includes('Custom: 49')) {
                console.log(`\n💡 Solend flash loan error (Custom: 49) - repay amount doesn't match borrow.`);
                console.log(`This should be fixed in the updated code that repays exact borrowed amount.`);
            } else if (errorString.includes('ProgramError')) {
                console.log(`\n💡 Program error - check that all program interactions are correct.`);
            }
        } else {
            console.log("✅ Simulation successful!");
            console.log(`⛽ Compute units used: ${simulation.value.unitsConsumed}`);
            
            if (simulation.value.logs && simulation.value.logs.length > 0) {
                console.log("📋 Last few transaction logs:");
                simulation.value.logs.slice(-5).forEach((log, i) => {
                    console.log(`  ${i + 1}. ${log}`);
                });
            }
            
            console.log(`\n🎉 Flash loan simulation completed successfully!`);
            console.log(`\n💡 To execute this transaction, uncomment the lines below in the code`);
            
            // Uncomment below to actually send the transaction
            // console.log("\n📤 Sending transaction...");
            // const signature = await connection.sendTransaction(result.transaction, [keypair]);
            // console.log("🎯 Transaction signature:", signature);
            // console.log(`🔗 Explorer: https://explorer.solana.com/tx/${signature}${SOLANA_RPC_URL.includes('devnet') ? '?cluster=devnet' : ''}`);
            
            // Wait for confirmation
            // console.log("⏳ Waiting for confirmation...");
            // const confirmation = await connection.confirmTransaction(signature, 'confirmed');
            // console.log("✅ Transaction confirmed:", confirmation);
        }

    } catch (error: any) {
        console.error("❌ Error:", error.message);
        
        // Provide helpful error messages
        if (error.message.includes('429')) {
            console.log("💡 Rate limited - try again in a few seconds");
        } else if (error.message.includes('fetch')) {
            console.log("💡 Network error - check your internet connection");
        } else if (error.message.includes('Jupiter')) {
            console.log("💡 Jupiter API error - the token pair might not be supported");
            console.log("   Try a different token or smaller amount");
        } else if (error.message.includes('Invalid account data')) {
            console.log("💡 Account data error - check that your wallet and token accounts are properly configured");
        } else if (error.message.includes('close account instruction')) {
            console.log("💡 Account closing conflict - this should be fixed in the updated code");
        } else {
            console.log("💡 Full error details:", error);
        }
    }

    // Initialize launch detector with position sizing config
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
            maxPositionSize: 1000,          // $1000 max position
            minLiquidityRatio: 10,          // 10:1 liquidity to position ratio
            volatilityMultiplier: 1.0,      // Base multiplier
            maxRiskPerTrade: 100,           // $100 max risk per trade
            minProfitThreshold: 0.03        // 3% minimum expected profit
        }
    );

    // Set up event listeners
    detector.on('newLaunch', (launch) => {
        console.log('\n🚀 New token launch detected:');
        console.log('Token:', launch.tokenAddress.toString());
        console.log('Pool:', launch.poolAddress.toString());
        console.log('DEX:', launch.dex);
        console.log('Initial Price:', launch.initialPrice);
        console.log('Liquidity:', launch.liquidity);
        console.log('Launch Block:', launch.launchBlock);
        console.log('Timestamp:', new Date(launch.timestamp).toISOString());
    });

    detector.on('priceUpdate', (update) => {
        const { launch, currentPrice, priceChange, block, position } = update;
        console.log('\n📊 Price Update:');
        console.log('Token:', launch.tokenAddress.toString());
        console.log('Current Price:', currentPrice);
        console.log('Price Change:', (priceChange * 100).toFixed(2) + '%');
        console.log('Block:', block);
        
        if (position) {
            console.log('\n📈 Position Update:');
            console.log('Size:', position.size.toFixed(2) + ' USD');
            console.log('Entry Price:', position.entryPrice);
            console.log('Current PnL:', position.currentPnL.toFixed(2) + ' USD');
            console.log('PnL %:', ((position.currentPnL / (position.size * position.entryPrice)) * 100).toFixed(2) + '%');
        }
    });

    detector.on('sellExecuted', (result) => {
        console.log('\n💰 Sell Executed:');
        console.log('Token:', result.tokenAddress.toString());
        console.log('Entry Price:', result.entryPrice);
        console.log('Exit Price:', result.exitPrice);
        console.log('Position Size:', result.positionSize.toFixed(2) + ' USD');
        console.log('PnL:', result.pnl.toFixed(2) + ' USD');
        console.log('PnL %:', ((result.pnl / (result.positionSize * result.entryPrice)) * 100).toFixed(2) + '%');
        console.log('Timestamp:', new Date(result.timestamp).toISOString());
    });

    detector.on('sellError', (error) => {
        console.log('\n❌ Sell Error:');
        console.log('Token:', error.tokenAddress.toString());
        console.log('Error:', error.error);
        console.log('Timestamp:', new Date(error.timestamp).toISOString());
    });

    try {
        // Initialize and start monitoring
        console.log('Initializing launch detector...');
        await detector.initialize();
        console.log('Launch detector initialized and monitoring for new pools...');

        // Example of updating position sizing config
        setTimeout(() => {
            console.log('\n🔄 Updating position sizing config...');
            detector.updatePositionSizingConfig({
                maxPositionSize: 2000,          // Increase max position size
                volatilityMultiplier: 0.8       // Reduce position size for volatile tokens
            });
        }, 300000); // Update after 5 minutes

        // Keep the process running
        process.on('SIGINT', async () => {
            console.log('\nStopping launch detector...');
            // Log final positions
            const activePositions = detector.getActivePositions();
            if (activePositions.length > 0) {
                console.log('\n📊 Final Positions:');
                activePositions.forEach(position => {
                    console.log(`Token: ${position.tokenAddress.toString()}`);
                    console.log(`Size: ${position.positionSize.toFixed(2)} USD`);
                    console.log(`Entry Price: ${position.entryPrice}`);
                    console.log(`Highest Price: ${position.highestPrice}`);
                    console.log(`Lowest Price: ${position.lowestPrice}`);
                    console.log('---');
                });
            }
            process.exit(0);
        });

    } catch (error) {
        console.error('Error initializing launch detector:', error);
        process.exit(1);
    }
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