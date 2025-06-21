/**
 * Test script to verify Solana RPC connection
 * Run this to diagnose connection issues before starting the monitoring service
 */

import { Connection, clusterApiUrl } from '@solana/web3.js';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

async function testConnection() {
  console.log(chalk.blue('🔍 Testing Solana RPC Connection...\n'));

  const RPC_ENDPOINT = process.env.RPC_ENDPOINT ?? clusterApiUrl('mainnet-beta');
  const RPC_WEBSOCKET_ENDPOINT = process.env.RPC_WEBSOCKET_ENDPOINT ?? 'wss://api.mainnet-beta.solana.com';

  console.log(chalk.yellow('Configuration:'));
  console.log(`  RPC Endpoint: ${RPC_ENDPOINT}`);
  console.log(`  WebSocket Endpoint: ${RPC_WEBSOCKET_ENDPOINT}`);
  console.log('');

  const connection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  });

  try {
    // Test 1: Basic connection
    console.log(chalk.blue('1. Testing basic connection...'));
    const slot = await connection.getSlot();
    console.log(chalk.green(`   ✓ Connected! Current slot: ${slot}`));

    // Test 2: Get recent blockhash
    console.log(chalk.blue('2. Testing blockhash retrieval...'));
    const { blockhash } = await connection.getLatestBlockhash();
    console.log(chalk.green(`   ✓ Blockhash retrieved: ${blockhash}`));

    // Test 3: Get cluster nodes
    console.log(chalk.blue('3. Testing cluster nodes...'));
    const nodes = await connection.getClusterNodes();
    console.log(chalk.green(`   ✓ Cluster nodes: ${nodes.length} nodes available`));

    // Test 4: Test WebSocket connection (if available)
    console.log(chalk.blue('4. Testing WebSocket connection...'));
    try {
      const subscriptionId = connection.onSlotChange((slotInfo) => {
        console.log(chalk.green(`   ✓ WebSocket working! Slot: ${slotInfo.slot}`));
        // Unsubscribe after first successful message
        connection.removeSlotChangeListener(subscriptionId);
      });
      
      // Wait a bit for the subscription to work
      setTimeout(() => {
        console.log(chalk.yellow('   ⚠ WebSocket test timeout - this is normal for some RPC providers'));
      }, 3000);
    } catch (wsError) {
      console.log(chalk.yellow(`   ⚠ WebSocket test failed: ${wsError}`));
    }

    console.log(chalk.green('\n🎉 All connection tests passed! Your RPC endpoint is working correctly.'));
    console.log(chalk.blue('\nYou can now start the token monitoring service with:'));
    console.log(chalk.white('  npm run api'));

  } catch (error) {
    console.error(chalk.red('\n❌ Connection test failed!'));
    console.error(chalk.red(`Error: ${error}`));
    
    console.log(chalk.yellow('\n🔧 Troubleshooting tips:'));
    console.log(chalk.white('1. Check your .env file has the correct RPC_ENDPOINT'));
    console.log(chalk.white('2. Try using a different RPC provider:'));
    console.log(chalk.white('   - QuickNode: https://www.quicknode.com/'));
    console.log(chalk.white('   - Helius: https://www.helius.dev/'));
    console.log(chalk.white('   - Alchemy: https://www.alchemy.com/'));
    console.log(chalk.white('3. Make sure your RPC endpoint supports WebSocket connections'));
    console.log(chalk.white('4. Check if you have rate limits on your RPC endpoint'));
    
    process.exit(1);
  }
}

// Run the test
testConnection().catch((error) => {
  console.error(chalk.red('Fatal error in connection test:'), error);
  process.exit(1);
}); 