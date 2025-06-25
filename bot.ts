import { Connection } from '@solana/web3.js';
import { SnipingBot } from './sdk/telegram_bot';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Validate environment variables
function validateEnv() {
    const required = {
        'TELEGRAM_BOT_TOKEN': process.env.TELEGRAM_BOT_TOKEN,
        'AUTHORIZED_USER_IDS': process.env.AUTHORIZED_USER_IDS,
        'RPC_ENDPOINT': process.env.RPC_ENDPOINT || process.env.SOLANA_RPC_URL
    };

    const missing = Object.entries(required)
        .filter(([_, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

// Setup logging
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, `bot-${new Date().toISOString().split('T')[0]}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(message: string, type: 'info' | 'error' | 'warn' = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    
    // Log to console with colors
    const colors = {
        info: '\x1b[32m', // Green
        error: '\x1b[31m', // Red
        warn: '\x1b[33m',  // Yellow
        reset: '\x1b[0m'   // Reset
    };
    
    console.log(`${colors[type]}${logMessage}${colors.reset}`);
    
    // Log to file
    logStream.write(logMessage);
}

async function startBot() {
    try {
        // Validate environment
        validateEnv();
        log('Environment validation passed');

        // Parse authorized user IDs
        const authorizedUserIds = (process.env.AUTHORIZED_USER_IDS || '')
            .split(',')
            .map(id => parseInt(id.trim()))
            .filter(id => !isNaN(id));

        if (authorizedUserIds.length === 0) {
            throw new Error('No valid authorized user IDs found');
        }

        log(`Authorized users: ${authorizedUserIds.join(', ')}`);

        // Initialize Solana connection (for flash arbitrage)
        const connection = new Connection(process.env.RPC_ENDPOINT || process.env.SOLANA_RPC_URL!, 'confirmed');
        log('Solana connection initialized');

        // Initialize API client for token monitoring
        const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
        let isTokenMonitoringActive = false;
        const processedTokens = new Set<string>(); // Cache to avoid duplicates
        
        // Wait for API server to be ready
        log('Waiting for token monitoring API to be ready...');
        let apiReady = false;
        let retryCount = 0;
        const maxRetries = 30; // Wait up to 30 seconds
        let statusResponse: any;
        
        while (!apiReady && retryCount < maxRetries) {
            try {
                statusResponse = await axios.get(`${apiBaseUrl}/tokens/monitor/status`);
                log(`Token monitoring status: ${statusResponse.data.isMonitoring ? 'Active' : 'Inactive'}`);
                apiReady = true;
            } catch (error) {
                retryCount++;
                if (retryCount < maxRetries) {
                    log(`API not ready yet (attempt ${retryCount}/${maxRetries}), retrying in 1 second...`, 'warn');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    log(`Token monitoring API not available after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    log('Bot cannot function without token monitoring API');
                    process.exit(1);
                }
            }
        }
        
        try {
            if (!statusResponse.data.isMonitoring) {
                log('Starting token monitoring via API...');
                try {
                    await axios.post(`${apiBaseUrl}/tokens/monitor/start`);
                    log('Token monitoring started successfully');
                } catch (error) {
                    if (axios.isAxiosError(error) && error.response?.status === 400) {
                        log('Token monitoring is already active');
                    } else {
                        throw error;
                    }
                }
            }
            
            isTokenMonitoringActive = true;
            
            // Set up polling for new tokens using REST API
            setInterval(async () => {
                try {
                    const response = await axios.get(`${apiBaseUrl}/tokens/new/recent?limit=10`);
                    const tokens = response.data.tokens || [];
                    
                    // Filter out already processed tokens
                    const newTokens = tokens.filter((token: any) => {
                        const tokenId = `${token.lpSignature}-${token.baseInfo.baseAddress}`;
                        if (processedTokens.has(tokenId)) {
                            return false;
                        }
                        processedTokens.add(tokenId);
                        return true;
                    });
                    
                    if (newTokens.length > 0) {
                        log(`Found ${newTokens.length} new tokens`);
                        handleNewTokens(newTokens);
                    }
                } catch (error) {
                    log(`Error polling for new tokens: ${error instanceof Error ? error.message : String(error)}`, 'warn');
                }
            }, 5000); // Poll every 5 seconds
            
            log('Token monitoring polling initialized');
            
        } catch (error) {
            log(`Token monitoring API not available: ${error instanceof Error ? error.message : String(error)}`, 'error');
            log('Bot cannot function without token monitoring API');
            process.exit(1);
        }

        // Initialize Telegram bot with API base URL and Solana connection
        const bot = new SnipingBot(
            process.env.TELEGRAM_BOT_TOKEN!,
            authorizedUserIds,
            connection, // Pass Solana connection for wallet manager
            apiBaseUrl
        );
        log('Telegram bot initialized');

        // Handle process termination
        process.on('SIGINT', async () => {
            log('Received shutdown signal');
            
            // Stop token monitoring if active
            if (isTokenMonitoringActive) {
                try {
                    await axios.post(`${apiBaseUrl}/tokens/monitor/stop`);
                    log('Token monitoring stopped');
                } catch (error) {
                    if (axios.isAxiosError(error) && error.response?.status === 400) {
                        log('Token monitoring is already stopped');
                    } else {
                        log(`Error stopping token monitoring: ${error instanceof Error ? error.message : String(error)}`, 'error');
                    }
                }
            }
            
            await bot.stop();
            logStream.end();
            log('Bot stopped gracefully');
            process.exit(0);
        });

        process.on('uncaughtException', (error) => {
            log(`Uncaught exception: ${error.message}`, 'error');
            log(error.stack || '', 'error');
        });

        process.on('unhandledRejection', (reason) => {
            log(`Unhandled rejection: ${reason}`, 'error');
        });

        log('Bot started successfully');
        log('Press Ctrl+C to stop the bot');

        // Helper function to format token messages
        function formatTokenMessage(token: any, isMostRecent = false): string {
            return `━━━━━━━━━━━━━━━━━━━━━━\n🆕 *New Token Detected!*\n━━━━━━━━━━━━━━━━━━━━━━\n📝 *Signature*: \`${token.lpSignature}\`\n👤 *Creator*: \`${token.creator}\`\n🪙 *Base Token*: \`${token.baseInfo.baseAddress}\`\n💰 *Base Amount*: \`${Number(token.baseInfo.baseLpAmount).toLocaleString()}\`\n💎 *Quote Token*: \`${token.quoteInfo.quoteAddress}\`\n💵 *Quote Amount*: \`${token.quoteInfo.quoteLpAmount}\`\n⏰ *Time*: ${new Date(token.timestamp).toLocaleString('en-US', { hour12: false, timeZone: 'UTC' })} UTC\n${isMostRecent ? '━━━━━━━━━━━━━━━━━━━━━━\n*This is the most recent token.*' : '━━━━━━━━━━━━━━━━━━━━━━'}\n`;
        }

        // Helper function to handle new tokens from REST API
        async function handleNewTokens(newTokens: any[]) {
            if (newTokens.length === 0) return;
            
            log(`Processing ${newTokens.length} new tokens from REST API`);
            
            // Sort tokens by timestamp (oldest first) to show most recent at bottom
            const sortedTokens = newTokens.sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            
            // Group tokens into batches of 5 for better readability
            const batchSize = 5;
            for (let i = 0; i < sortedTokens.length; i += batchSize) {
                const batch = sortedTokens.slice(i, i + batchSize);
                const isLastBatch = i + batchSize >= sortedTokens.length;
                
                let message = `🆕 *New Tokens Detected!*\n\n`;
                
                batch.forEach((token, index) => {
                    const isMostRecent = isLastBatch && index === batch.length - 1;
                    message += formatTokenMessage(token, isMostRecent);
                    
                    if (index < batch.length - 1) {
                        message += '\n' + '─'.repeat(40) + '\n\n';
                    }
                });
                
                // Add flash arbitrage suggestion for the most recent token
                if (isLastBatch && batch.length > 0) {
                    const mostRecentToken = batch[batch.length - 1];
                    const liquidityUSD = mostRecentToken.quoteInfo.quoteLpAmount * 100; // Rough estimate
                    
                    message += '\n' + '═'.repeat(50) + '\n\n';
                    message += `🎯 *Flash Arbitrage Opportunity*\n\n`;
                    message += `*Token:* \`${mostRecentToken.baseInfo.baseAddress}\`\n`;
                    message += `*Liquidity:* ~$${liquidityUSD.toLocaleString()}\n`;
                    message += `*Creator:* \`${mostRecentToken.creator}\`\n\n`;
                    message += `*Quick Commands:*\n`;
                    message += `• \`/flasharbitrage ${mostRecentToken.baseInfo.baseAddress} 1000\` (3% profit)\n`;
                    message += `• \`/flasharbitrage ${mostRecentToken.baseInfo.baseAddress} 1000 5\` (5% profit)\n`;
                    message += `• \`/flashquote ${mostRecentToken.baseInfo.baseAddress} 1000\` (get quote)\n\n`;
                    message += `_Monitor price and execute when ready!_`;
                }
                
                await notifyUsers(bot, authorizedUserIds, message);
                
                // Add delay between batches to avoid rate limiting
                if (i + batchSize < sortedTokens.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            // Analyze each token for potential opportunities
            for (const token of newTokens) {
                await analyzeNewToken(token);
            }
        }

        // Helper function to analyze new tokens
        async function analyzeNewToken(token: any) {
            try {
                log(`Analyzing new token: ${token.baseInfo.baseAddress}`);
                
                // Add your analysis logic here
                // For example:
                // - Check liquidity levels
                // - Analyze token metadata
                // - Check for potential arbitrage opportunities
                // - Execute trading strategies
                
                // Example analysis (replace with your logic)
                const liquidityUSD = token.quoteInfo.quoteLpAmount * 100; // Assuming SOL = $100
                if (liquidityUSD > 10000) {
                    log(`High liquidity token detected: $${liquidityUSD.toFixed(2)}`);
                    notifyUsers(bot, authorizedUserIds, `💎 High liquidity token: $${liquidityUSD.toFixed(2)} - ${token.baseInfo.baseAddress}`);
                }
                
            } catch (error) {
                log(`Error analyzing token ${token.baseInfo.baseAddress}: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
        }

        // Helper function to notify users
        async function notifyUsers(bot: SnipingBot, userIds: number[], message: string) {
            try {
                await bot.sendNotification(message);
            } catch (error) {
                log(`Error notifying users: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
        }

    } catch (error) {
        log(`Failed to start bot: ${error instanceof Error ? error.message : String(error)}`, 'error');
        if (error instanceof Error && error.stack) {
            log(error.stack, 'error');
        }
        process.exit(1);
    }
}

// Start the bot
startBot().catch((error) => {
    log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    if (error instanceof Error && error.stack) {
        log(error.stack, 'error');
    }
    process.exit(1);
}); 