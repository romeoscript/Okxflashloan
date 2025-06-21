#!/usr/bin/env ts-node

/**
 * Flash Arbitrage Example
 * 
 * This example demonstrates how to use the flash arbitrage feature
 * to monitor token prices and execute flash loans when profit targets are met.
 */

import { SnipingBot } from './sdk/telegram_bot';
import { LaunchDetector } from './sdk/launch_detector';
import { Connection } from '@solana/web3.js';

async function main() {
    console.log('🚀 Starting Flash Arbitrage Example...\n');

    // Configuration
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const AUTHORIZED_USER_IDS = process.env.AUTHORIZED_USER_IDS?.split(',').map(id => parseInt(id)) || [];
    const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
    const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';

    if (!TELEGRAM_BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
        process.exit(1);
    }

    if (AUTHORIZED_USER_IDS.length === 0) {
        console.error('❌ AUTHORIZED_USER_IDS environment variable is required');
        process.exit(1);
    }

    try {
        // Initialize Solana connection
        const connection = new Connection(RPC_ENDPOINT, 'confirmed');
        
        // Initialize launch detector
        const detector = new LaunchDetector(connection);
        
        // Initialize Telegram bot
        const bot = new SnipingBot(
            TELEGRAM_BOT_TOKEN,
            detector,
            AUTHORIZED_USER_IDS,
            API_BASE_URL
        );

        console.log('✅ Bot initialized successfully');
        console.log('📱 Send /start to your Telegram bot to begin');
        console.log('💡 Use /help to see all available commands\n');

        // Example flash arbitrage scenarios
        console.log('🎯 Example Flash Arbitrage Commands:');
        console.log('');
        console.log('1. Wait for 3% profit (default):');
        console.log('   /flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000');
        console.log('');
        console.log('2. Wait for 5% profit:');
        console.log('   /flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000 5');
        console.log('');
        console.log('3. Get quote first:');
        console.log('   /flashquote EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000');
        console.log('');
        console.log('4. Execute immediately:');
        console.log('   /flashswap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000');
        console.log('');

        // Keep the process running
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down...');
            await bot.stop();
            process.exit(0);
        });

    } catch (error) {
        console.error('❌ Error starting bot:', error);
        process.exit(1);
    }
}

// Run the example
if (require.main === module) {
    main().catch(console.error);
}

export { main }; 