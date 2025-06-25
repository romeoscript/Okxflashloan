import { Connection } from '@solana/web3.js';
import { SimpleFlashBot } from './sdk/simple_flash_bot';
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

        // Initialize Solana connection
        const connection = new Connection(process.env.RPC_ENDPOINT || process.env.SOLANA_RPC_URL!, 'confirmed');
        log('Solana connection initialized');

        // Initialize API client for token monitoring
        const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
        
        // Wait for API server to be ready
        log('Waiting for token monitoring API to be ready...');
        let apiReady = false;
        let retryCount = 0;
        const maxRetries = 30; // Wait up to 30 seconds
        
        while (!apiReady && retryCount < maxRetries) {
            try {
                const statusResponse = await axios.get(`${apiBaseUrl}/tokens/monitor/status`);
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

        // Initialize Simple Flash Bot
        const bot = new SimpleFlashBot(
            process.env.TELEGRAM_BOT_TOKEN!,
            authorizedUserIds,
            connection,
            apiBaseUrl
        );
        log('Flash Loan Bot initialized');

        // Handle process termination
        process.on('SIGINT', async () => {
            log('Received shutdown signal');
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

        log('Flash Loan Bot started successfully');
        log('Press Ctrl+C to stop the bot');

    } catch (error) {
        log(`Fatal error starting bot: ${error instanceof Error ? error.message : String(error)}`, 'error');
        log(error instanceof Error ? error.stack || '' : '', 'error');
        process.exit(1);
    }
}

// Run the bot
startBot().catch((error) => {
    log(`Fatal error: ${error instanceof Error ? error.message : String(error)}`, 'error');
    process.exit(1);
}); 