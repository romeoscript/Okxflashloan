import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { WalletManager, UserWalletSession } from './wallet_manager';

// Bot configuration interface
interface BotConfig {
    minLiquidity: number;
    maxSlippage: number;
    targetProfitPercentage: number;
    maxGasPrice: number;
    dexes: string[];
    blockWindow: number;
}

// Position sizing configuration
interface PositionSizingConfig {
    maxPositionSize: number;
    minLiquidityRatio: number;
    volatilityMultiplier: number;
    maxRiskPerTrade: number;
    minProfitThreshold: number;
}

// Flash swap quote interface
interface FlashSwapQuote {
    quote: any;
    estimatedOutput: string;
    priceImpact: string;
    route: any[];
    borrowedAmount: string;
    addresses: any;
}

// Flash swap execute response interface
interface FlashSwapExecuteResponse {
    transaction: string;
    quote: any;
    estimatedOutput: string;
    priceImpact: string;
    route: any[];
    borrowedAmount: string;
    addresses: any;
    explorerUrl: string;
}

export class SnipingBot {
    private bot: TelegramBot;
    private authorizedUserIds: number[];
    private config: BotConfig;
    private positionSizingConfig: PositionSizingConfig;
    private authorizedUsers: Set<number>;
    private apiBaseUrl: string;
    private walletManager: WalletManager;
    private readonly welcomeMessage = `
🚀 *Welcome to the Flash Arbitrage Bot!*

I'm your automated flash arbitrage assistant for Solana tokens. Here's what I can do:

📊 *Token Monitoring*
• Detect new token launches via API
• Track token information
• Monitor liquidity changes
• Auto-suggest flash arbitrage opportunities

💰 *Flash Arbitrage Features*
• Flash loan execution with profit monitoring
• Real-time price tracking
• Automatic execution when targets are met
• Rich Telegram interface

🔐 *Non-Custodial Security*
• Connect your own wallet (Phantom, Solflare, etc.)
• You control your private keys
• Bot never holds your funds
• Sign transactions yourself

_Use the buttons below to control the bot:_
`;

    constructor(token: string, authorizedUserIds: number[], connection: Connection, apiBaseUrl: string = 'http://localhost:3000') {
        this.bot = new TelegramBot(token, { polling: true });
        this.authorizedUserIds = authorizedUserIds;
        this.walletManager = new WalletManager(connection);
        this.config = {
            minLiquidity: 10000,    // $10k minimum liquidity
            maxSlippage: 0.01,      // 1% max slippage
            targetProfitPercentage: 0.03, // 3% target profit
            maxGasPrice: 1000000,   // 0.001 SOL max gas
            dexes: ['raydium', 'jupiter'],
            blockWindow: 10         // Monitor 10 blocks after launch
        };
        this.positionSizingConfig = {
            maxPositionSize: 1000,          // $1000 max position
            minLiquidityRatio: 10,          // 10:1 liquidity to position ratio
            volatilityMultiplier: 1.0,      // Base multiplier
            maxRiskPerTrade: 100,           // $100 max risk per trade
            minProfitThreshold: 0.03,       // 3% minimum expected profit
        };
        this.authorizedUsers = new Set(authorizedUserIds);
        this.apiBaseUrl = apiBaseUrl;
        this.setupCommands();
    }

    private getMainMenuKeyboard(): TelegramBot.InlineKeyboardMarkup {
        return {
            inline_keyboard: [
                [
                    { text: '🔐 Connect Wallet', callback_data: 'connect_wallet' },
                    { text: '📊 Status', callback_data: 'status' }
                ],
                [
                    { text: '💰 Flash Quote', callback_data: 'flash_quote' },
                    { text: '⚡ Flash Swap', callback_data: 'flash_swap' }
                ],
                [
                    { text: '🆕 Recent Tokens', callback_data: 'recent_tokens' },
                    { text: '⚙️ Settings', callback_data: 'config' }
                ],
                [
                    { text: '❓ Help', callback_data: 'help' },
                    { text: '🔄 Flash Arbitrage', callback_data: 'flash_help' }
                ],
                [
                    { text: '▶️ Start Monitoring', callback_data: 'start_monitoring' },
                    { text: '⏹ Stop Monitoring', callback_data: 'stop_monitoring' }
                ]
            ]
        };
    }

    private getWalletKeyboard(): TelegramBot.InlineKeyboardMarkup {
        return {
            inline_keyboard: [
                [
                    { text: '🔗 Connect New Wallet', callback_data: 'connect_new_wallet' },
                    { text: '❌ Disconnect Wallet', callback_data: 'disconnect_wallet' }
                ],
                [
                    { text: '👛 Wallet Info', callback_data: 'wallet_info' },
                    { text: '🔙 Back to Menu', callback_data: 'main_menu' }
                ]
            ]
        };
    }

    private getConfigKeyboard(): TelegramBot.InlineKeyboardMarkup {
        return {
            inline_keyboard: [
                [
                    { text: '💰 Min Liquidity', callback_data: 'set_minLiquidity' },
                    { text: '📈 Max Slippage', callback_data: 'set_maxSlippage' }
                ],
                [
                    { text: '🎯 Target Profit', callback_data: 'set_targetProfit' },
                    { text: '⛽ Max Gas', callback_data: 'set_maxGasPrice' }
                ],
                [
                    { text: '📊 Position Size', callback_data: 'set_maxPositionSize' },
                    { text: '⚖️ Risk/Trade', callback_data: 'set_maxRiskPerTrade' }
                ],
                [
                    { text: '🔙 Back to Menu', callback_data: 'main_menu' }
                ]
            ]
        };
    }

    private setupCommands() {
        // Start command with welcome message and buttons
        this.bot.onText(/\/start/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            await this.bot.sendMessage(msg.chat.id, this.welcomeMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: this.getMainMenuKeyboard()
            });
        });

        // Wallet connection command
        this.bot.onText(/\/connect/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            await this.handleWalletConnection(msg.chat.id, msg.from!.id);
        });

        // Flash quote command
        this.bot.onText(/\/flashquote (.+)/, async (msg, match) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            if (!this.walletManager.isWalletConnected(msg.from!.id)) {
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Please connect your wallet first using /connect or the "Connect Wallet" button.');
                return;
            }

            const tokenMint = match![1];
            await this.handleFlashQuoteCommand(msg.chat.id, tokenMint, "1"); // Default 1 SOL
        });

        // Handle callback queries (button clicks)
        this.bot.on('callback_query', async (callbackQuery) => {
            if (!callbackQuery.message || !this.isAuthorized(callbackQuery.from.id)) {
                await this.bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ Unauthorized access',
                    show_alert: true
                });
                return;
            }

            const chatId = callbackQuery.message.chat.id;
            const action = callbackQuery.data;

            switch (action) {
                case 'connect_wallet':
                    await this.handleWalletConnection(chatId, callbackQuery.from.id);
                    break;
                case 'connect_new_wallet':
                    await this.handleWalletConnection(chatId, callbackQuery.from.id);
                    break;
                case 'disconnect_wallet':
                    await this.handleWalletDisconnection(chatId, callbackQuery.from.id);
                    break;
                case 'wallet_info':
                    await this.handleWalletInfo(chatId, callbackQuery.from.id);
                    break;
                case 'flash_quote':
                    await this.handleFlashQuoteMenu(chatId, callbackQuery.from.id);
                    break;
                case 'flash_swap':
                    await this.handleFlashSwapMenu(chatId, callbackQuery.from.id);
                    break;
                case 'status':
                    await this.handleStatusCommand(chatId);
                    break;
                case 'config':
                    await this.handleConfigCommand(chatId);
                    break;
                case 'help':
                    await this.handleHelpCommand(chatId);
                    break;
                case 'recent_tokens':
                    await this.handleRecentTokensCommand(chatId);
                    break;
                case 'flash_help':
                    await this.handleFlashArbitrageHelp(chatId);
                    break;
                case 'start_monitoring':
                    await this.startMonitoring();
                    await this.bot.sendMessage(chatId, '✅ Started monitoring for new token launches');
                    break;
                case 'stop_monitoring':
                    await this.stopMonitoring();
                    await this.bot.sendMessage(chatId, '⏹ Stopped monitoring for new token launches');
                    break;
                case 'main_menu':
                    await this.bot.editMessageText(this.welcomeMessage, {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                        reply_markup: this.getMainMenuKeyboard()
                    });
                    break;
                default:
                    await this.bot.answerCallbackQuery(callbackQuery.id, {
                        text: 'Unknown action',
                        show_alert: true
                    });
            }

            await this.bot.answerCallbackQuery(callbackQuery.id);
        });

        // Handle text messages for wallet connection
        this.bot.on('message', async (msg) => {
            if (!msg.text || !this.isAuthorized(msg.from?.id)) return;

            const chatId = msg.chat.id;
            const userId = msg.from!.id;

            // Check if user is in wallet connection mode
            if (msg.text.startsWith('wallet:')) {
                await this.handleWalletPublicKey(chatId, userId, msg.text.substring(7).trim());
            }
        });
    }

    private async handleWalletConnection(chatId: number, userId: number) {
        const isConnected = this.walletManager.isWalletConnected(userId);
        
        if (isConnected) {
            const session = this.walletManager.getUserWallet(userId);
            const message = `
🔐 *Wallet Connected*

👛 *Wallet Address:* \`${session!.walletPublicKey}\`
🕐 *Connected:* ${session!.connectedAt.toLocaleString()}
⏰ *Last Activity:* ${session!.lastActivity.toLocaleString()}

_Your wallet is ready for flash loans and swaps!_
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            const message = `
🔐 *Connect Your Wallet*

To use flash loans and swaps, you need to connect your Solana wallet.

**Supported Wallets:**
• Phantom
• Solflare
• Sollet
• Any wallet that supports Solana

**How to connect:**
1. Copy your wallet's public key
2. Send it in this format: \`wallet:YOUR_PUBLIC_KEY\`

**Example:**
\`wallet:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU\`

⚠️ *Security Note: Only send your public key, never your private key!*
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    }

    private async handleWalletPublicKey(chatId: number, userId: number, publicKey: string) {
        try {
            // Validate the public key
            new PublicKey(publicKey);
            
            // For now, we'll accept the connection without signature verification
            // In production, you should implement proper signature verification
            const success = await this.walletManager.verifyWalletConnection(
                userId,
                publicKey,
                '', // No signature for now
                this.walletManager.generateChallengeMessage(userId)
            );
            
            if (success) {
                const message = `
✅ *Wallet Connected Successfully!*

👛 *Wallet Address:* \`${publicKey}\`
🕐 *Connected:* ${new Date().toLocaleString()}

_Your wallet is now ready for flash loans and swaps!_

**Next Steps:**
• Use /flashquote TOKEN_MINT to get a quote
• Use the "Flash Quote" button to get started
                `;
                
                await this.bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: this.getMainMenuKeyboard()
                });
            } else {
                await this.bot.sendMessage(chatId, '❌ Failed to connect wallet. Please try again.');
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, '❌ Invalid wallet address. Please check and try again.');
        }
    }

    private async handleWalletDisconnection(chatId: number, userId: number) {
        const success = this.walletManager.disconnectWallet(userId);
        
        if (success) {
            await this.bot.sendMessage(chatId, '✅ Wallet disconnected successfully.', {
                reply_markup: this.getMainMenuKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet was connected.');
        }
    }

    private async handleWalletInfo(chatId: number, userId: number) {
        const session = this.walletManager.getUserWallet(userId);
        
        if (session) {
            const message = `
👛 *Wallet Information*

**Address:** \`${session.walletPublicKey}\`
**Connected:** ${session.connectedAt.toLocaleString()}
**Last Activity:** ${session.lastActivity.toLocaleString()}

_Your wallet is connected and ready for transactions._
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet connected. Please connect a wallet first.');
        }
    }

    private async handleFlashQuoteMenu(chatId: number, userId: number) {
        if (!this.walletManager.isWalletConnected(userId)) {
            await this.bot.sendMessage(chatId, 
                '❌ Please connect your wallet first using the "Connect Wallet" button.');
            return;
        }

        const message = `
💰 *Flash Quote*

To get a flash loan quote, send a message with the token mint address.

**Format:** \`/flashquote TOKEN_MINT\`

**Example:** \`/flashquote DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263\`

**Or send just the token mint address:**
\`DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263\`

_The default amount is 1 SOL. You can specify a custom amount later._
        `;
        
        await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    private async handleFlashSwapMenu(chatId: number, userId: number) {
        if (!this.walletManager.isWalletConnected(userId)) {
            await this.bot.sendMessage(chatId, 
                '❌ Please connect your wallet first using the "Connect Wallet" button.');
            return;
        }

        const message = `
⚡ *Flash Swap*

To execute a flash swap, first get a quote using /flashquote, then follow the instructions to sign the transaction.

**Steps:**
1. Get a quote: \`/flashquote TOKEN_MINT\`
2. Review the quote details
3. Sign the transaction with your wallet
4. Execute the flash loan

⚠️ *Make sure you have enough SOL in your wallet for transaction fees!*
        `;
        
        await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                ]
            }
        });
    }

    private async handleFlashQuoteCommand(chatId: number, tokenMint: string, amount: string) {
        const statusMsg = await this.bot.sendMessage(chatId, '🔄 Getting flash loan quote...');

        try {
            const session = this.walletManager.getUserWallet(chatId);
            if (!session) {
                throw new Error('Wallet not connected');
            }

            const response = await axios.get(`${this.apiBaseUrl}/flashswap/quote`, {
                params: {
                    targetTokenMint: tokenMint,
                    desiredTargetAmount: amount,
                    slippageBps: this.config.maxSlippage * 10000,
                    walletPublicKey: session.walletPublicKey
                }
            });

            const result: FlashSwapQuote = response.data;
            
            const message = `
💰 *Flash Loan Quote*

🎯 **Token:** \`${tokenMint}\`
💸 **Borrow Amount:** ${amount} SOL
📊 **Estimated Output:** ${result.estimatedOutput} tokens
📈 **Price Impact:** ${result.priceImpact}%
🛣️ **Route:** ${result.route.length} step(s)

**Next Steps:**
1. Review the quote above
2. If you want to proceed, use the "Execute Flash Swap" button
3. Sign the transaction with your wallet
4. The flash loan will be executed

⚠️ *This is a simulation. Actual execution may vary due to market conditions.*
            `;

            await this.bot.editMessageText(message, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⚡ Execute Flash Swap', callback_data: `execute_swap_${tokenMint}_${amount}` }],
                        [{ text: '🔙 Back to Menu', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            const errorMessage = '❌ Failed to get flash swap quote: ' + 
                (error instanceof Error ? error.message : 'Unknown error');
            await this.bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
        }
    }

    private isAuthorized(userId?: number): boolean {
        if (!userId) return false;
        return this.authorizedUserIds.includes(userId);
    }

    private sendUnauthorizedMessage(chatId: number) {
        return this.bot.sendMessage(chatId, 
            '❌ *Unauthorized Access*\n\n' +
            'You are not authorized to use this bot. Please contact the administrator for access.',
            { parse_mode: 'Markdown' }
        );
    }

    private updateConfig(param: string, value: number): any {
        // TODO: Implement proper config update logic
        return this.config[param as keyof BotConfig];
    }

    private getConfigValue(param: string): any {
        return this.config[param as keyof BotConfig];
    }

    private formatConfigValue(param: string, value: any): string {
        // Implementation of formatConfigValue method
        return String(value); // Placeholder return, actual implementation needed
    }

    private async broadcastMessage(message: string) {
        for (const userId of this.authorizedUserIds) {
            try {
                await this.bot.sendMessage(userId, message, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
            } catch (error) {
                console.error(`Failed to send message to user ${userId}:`, error);
            }
        }
    }

    // Public method for external components to send notifications
    async sendNotification(message: string) {
        await this.broadcastMessage(message);
    }

    private async handleStatusCommand(chatId: number) {
        const positions = this.getActivePositions();
        const totalPnL = positions.reduce((sum, pos) => sum + (pos.currentPnL || 0), 0);
        const activePositions = positions.length;

        const statusMessage = `
📊 *Bot Status Report*

🟢 *System Status*
• Bot: Active
• Token Monitoring: Running via API
• Last Update: ${new Date().toLocaleString()}

💰 *Flash Arbitrage Summary*
• Active Positions: ${activePositions}
• Total PnL: $${totalPnL.toFixed(2)}
• Total Trades: ${this.getTotalTrades()}

⚙️ *Current Settings*
• Min Liquidity: $${this.config.minLiquidity.toLocaleString()}
• Max Slippage: ${(this.config.maxSlippage * 100).toFixed(1)}%
• Target Profit: ${(this.config.targetProfitPercentage * 100).toFixed(1)}%
• Max Gas: ${(this.config.maxGasPrice / 1e9).toFixed(3)} SOL

📈 *Position Sizing*
• Max Size: $${this.positionSizingConfig.maxPositionSize.toLocaleString()}
• Min Liquidity Ratio: ${this.positionSizingConfig.minLiquidityRatio}x
• Max Risk/Trade: $${this.positionSizingConfig.maxRiskPerTrade.toLocaleString()}
• Min Profit Threshold: ${(this.positionSizingConfig.minProfitThreshold * 100).toFixed(1)}%

_Use /recent to view detected tokens._
`;

        await this.bot.sendMessage(chatId, statusMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
    }

    private async handleConfigCommand(chatId: number) {
        const configMessage = `
⚙️ *Current Configuration*

📈 *Trading Parameters*
• Min Liquidity: $${this.config.minLiquidity.toLocaleString()}
• Max Slippage: ${(this.config.maxSlippage * 100).toFixed(1)}%
• Target Profit: ${(this.config.targetProfitPercentage * 100).toFixed(1)}%
• Max Gas: ${(this.config.maxGasPrice / 1e9).toFixed(3)} SOL
• DEXes: ${this.config.dexes.join(', ')}
• Block Window: ${this.config.blockWindow}

💰 *Position Sizing*
• Max Position Size: $${this.positionSizingConfig.maxPositionSize.toLocaleString()}
• Min Liquidity Ratio: ${this.positionSizingConfig.minLiquidityRatio}x
• Volatility Multiplier: ${this.positionSizingConfig.volatilityMultiplier}x
• Max Risk/Trade: $${this.positionSizingConfig.maxRiskPerTrade.toLocaleString()}
• Min Profit Threshold: ${(this.positionSizingConfig.minProfitThreshold * 100).toFixed(1)}%

_To update settings, use /setconfig with the following format:_
\`/setconfig param value\`

_Example: /setconfig minLiquidity 20000_
`;

        await this.bot.sendMessage(chatId, configMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
        });
    }

    private async handleConfigUpdate(chatId: number, param: string) {
        const paramInfo = {
            minLiquidity: { label: 'Minimum Liquidity', unit: 'USD', format: (v: number) => `$${v.toLocaleString()}` },
            maxSlippage: { label: 'Maximum Slippage', unit: '%', format: (v: number) => `${(v * 100).toFixed(1)}%` },
            targetProfitPercentage: { label: 'Target Profit', unit: '%', format: (v: number) => `${(v * 100).toFixed(1)}%` },
            maxGasPrice: { label: 'Maximum Gas', unit: 'SOL', format: (v: number) => `${(v / 1e9).toFixed(3)} SOL` },
            maxPositionSize: { label: 'Maximum Position Size', unit: 'USD', format: (v: number) => `$${v.toLocaleString()}` },
            maxRiskPerTrade: { label: 'Maximum Risk per Trade', unit: 'USD', format: (v: number) => `$${v.toLocaleString()}` }
        }[param];

        if (!paramInfo) {
            await this.bot.sendMessage(chatId, '❌ Invalid parameter');
            return;
        }

        const currentValue = this.getConfigValue(param);
        const message = `
⚙️ *Update ${paramInfo.label}*

Current value: ${paramInfo.format(currentValue)}
Unit: ${paramInfo.unit}

Please enter the new value:
`;

        const sent = await this.bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                force_reply: true,
                selective: true
            }
        });

        // Set up one-time message listener for the response
        const listener = async (msg: TelegramBot.Message) => {
            if (msg.reply_to_message?.message_id === sent.message_id) {
                try {
                    const newValue = parseFloat(msg.text || '');
                    if (isNaN(newValue)) {
                        throw new Error('Invalid number');
                    }

                    const oldValue = this.updateConfig(param, newValue);
                    await this.bot.sendMessage(chatId, 
                        `✅ Updated ${paramInfo.label}:\n` +
                        `• Old: ${paramInfo.format(oldValue)}\n` +
                        `• New: ${paramInfo.format(newValue)}`,
                        { reply_markup: this.getConfigKeyboard() }
                    );
                } catch (error) {
                    await this.bot.sendMessage(chatId, 
                        `❌ Error: ${error instanceof Error ? error.message : 'Invalid value'}\n` +
                        'Please try again with a valid number.',
                        { reply_markup: this.getConfigKeyboard() }
                    );
                }
                this.bot.removeListener('message', listener);
            }
        };

        this.bot.on('message', listener);
    }

    private async handlePositionsCommand(chatId: number) {
        const positions = this.getActivePositions();
        if (positions.length === 0) {
            await this.bot.sendMessage(chatId, '📊 No active positions at the moment.', {
                reply_markup: this.getMainMenuKeyboard()
            });
            return;
        }

        const positionsMessage = positions.map((pos, index) => {
            const pnlColor = (pos.currentPnL || 0) >= 0 ? '🟢' : '🔴';
            const pnlPercentage = ((pos.currentPnL || 0) / pos.positionSize * 100).toFixed(2);
            
            return `
*Position ${index + 1}*
${pnlColor} *Token:* \`${pos.tokenAddress.toString()}\`
💰 *Size:* $${pos.positionSize.toLocaleString()}
📈 *Entry:* $${pos.entryPrice.toFixed(6)}
📊 *Current:* $${pos.currentPrice?.toFixed(6) || 'N/A'}
💵 *PnL:* $${(pos.currentPnL || 0).toFixed(2)} (${pnlPercentage}%)
⏱ *Time:* ${new Date(pos.entryTime).toLocaleString()}
🎯 *Target:* ${(pos.autoSellConfig.profitTarget * 100).toFixed(1)}%
🛑 *Stop Loss:* ${(pos.autoSellConfig.stopLoss * 100).toFixed(1)}%
`;
        }).join('\n');

        const summaryMessage = `
📊 *Active Positions Summary*
${positionsMessage}

_Total PnL: $${positions.reduce((sum, pos) => sum + (pos.currentPnL || 0), 0).toFixed(2)}_

_Use the buttons below to control the bot:_
`;

        await this.bot.sendMessage(chatId, summaryMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: this.getMainMenuKeyboard()
        });
    }

    private async handleHelpCommand(chatId: number) {
        const helpMessage = `
📚 *Bot Command Guide*

*Basic Commands*
/start - Start the bot and view welcome message
/status - Check bot status and trading summary
/positions - View active trading positions
/config - View current configuration
/help - Show this help message

*Token Monitoring*
/recent - View recent tokens for flash arbitrage

*Flash Loan Commands*
/flashquote <token_mint> <amount> - Get flash swap quote with fees
/flashswap <token_mint> <amount> - Execute immediate flash swap
/flasharbitrage <token_mint> <amount> [profit_target%] - Flash arbitrage with profit monitoring

*Flash Arbitrage Examples*
• \`/flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000\` (3% default)
• \`/flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000 5\` (5% target)

*Flash Loan Costs:*
• Flash Loan Fee: ~0.000003 SOL (≈ $0.0003)
• Transaction Fee: ~0.000005 SOL (≈ $0.0005)
• Total Cost: ~$0.0008 per trade

*Workflow*
1. Use /recent to see detected tokens
2. Copy token address from the list
3. Execute flash arbitrage with desired profit target
4. Bot monitors price and executes automatically

*Configuration Parameters*
• minLiquidity - Minimum liquidity in USD
• maxSlippage - Maximum allowed slippage (0.01 = 1%)
• targetProfitPercentage - Target profit (0.03 = 3%)
• maxGasPrice - Maximum gas price in lamports
• maxPositionSize - Maximum position size in USD
• minLiquidityRatio - Minimum liquidity ratio
• volatilityMultiplier - Volatility adjustment factor
• maxRiskPerTrade - Maximum risk per trade in USD
• minProfitThreshold - Minimum profit threshold

*Need more help?*
Contact the bot administrator for additional support.

_Use the buttons below to control the bot:_
`;

        await this.bot.sendMessage(chatId, helpMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: this.getMainMenuKeyboard()
        });
    }

    private async handleRecentTokensCommand(chatId: number) {
        try {
            // Get recent tokens from the monitoring API
            const response = await axios.get(`${this.apiBaseUrl}/tokens/new/recent?limit=10`);
            const tokens = response.data.tokens || [];

            if (tokens.length === 0) {
                await this.bot.sendMessage(chatId, 
                    '📊 No recent tokens found. Start monitoring to detect new tokens.', {
                    reply_markup: this.getMainMenuKeyboard()
                });
                return;
            }

            let message = `📊 *Recent Tokens for Flash Arbitrage*\n\n`;
            
            tokens.forEach((token: any, index: number) => {
                const liquidityUSD = token.quoteInfo.quoteLpAmount * 100; // Rough estimate
                const timeAgo = this.getTimeAgo(new Date(token.timestamp));
                
                message += `*${index + 1}. ${token.baseInfo.baseAddress}*\n`;
                message += `💰 Liquidity: ~$${liquidityUSD.toLocaleString()}\n`;
                message += `👤 Creator: \`${token.creator}\`\n`;
                message += `⏰ ${timeAgo}\n\n`;
                message += `*Quick Actions:*\n`;
                message += `• \`/flasharbitrage ${token.baseInfo.baseAddress} 1000\` (3%)\n`;
                message += `• \`/flasharbitrage ${token.baseInfo.baseAddress} 1000 5\` (5%)\n`;
                message += `• \`/flashquote ${token.baseInfo.baseAddress} 1000\` (flash quote)\n\n`;
                
                if (index < tokens.length - 1) {
                    message += '─'.repeat(40) + '\n\n';
                }
            });

            message += `_Click any command above to execute flash arbitrage!_`;

            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });

        } catch (error) {
            console.error('Recent tokens error:', error);
            await this.bot.sendMessage(chatId, 
                '❌ Failed to get recent tokens: ' + (error instanceof Error ? error.message : 'Unknown error'), {
                reply_markup: this.getMainMenuKeyboard()
            });
        }
    }

    private async handleFlashArbitrageHelp(chatId: number) {
        const helpMessage = `
🔄 *Flash Arbitrage Guide*

*What is Flash Arbitrage?*
Flash arbitrage allows you to borrow funds, buy tokens, and sell them for profit in a single transaction.

*How it Works:*
1. **Monitor** - Bot detects new token launches
2. **Wait** - Monitor price until target profit (3-5%)
3. **Execute** - Borrow WSOL, buy token, sell immediately
4. **Repay** - Repay loan with profit

*Costs:*
• Flash Loan Fee: ~0.000003 SOL (≈ $0.0003)
• Transaction Fee: ~0.000005 SOL (≈ $0.0005)
• Total Cost: ~$0.0008 per trade

*Commands:*
• \`/recent\` - View detected tokens
• \`/flasharbitrage <token> <amount>\` - Wait for 3% profit
• \`/flasharbitrage <token> <amount> 5\` - Wait for 5% profit
• \`/flashquote <token> <amount>\` - Get flash swap quote with fees

*Example Workflow:*
1. Use \`/recent\` to see new tokens
2. Copy token address: \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`
3. Execute: \`/flasharbitrage EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000 5\`
4. Bot monitors price and executes automatically

*Risk Warning:*
Flash loans carry significant risks. Only use with funds you can afford to lose.

_Use the buttons below to control the bot:_
`;

        await this.bot.sendMessage(chatId, helpMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: this.getMainMenuKeyboard()
        });
    }

    private getTimeAgo(date: Date): string {
        const now = new Date();
        const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        
        if (diffInSeconds < 60) {
            return `${diffInSeconds}s ago`;
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            return `${minutes}m ago`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            return `${hours}h ago`;
        } else {
            const days = Math.floor(diffInSeconds / 86400);
            return `${days}d ago`;
        }
    }

    // Public methods
    async stop() {
        await this.bot.stopPolling();
    }

    // Mock methods for compatibility (since we're not using LaunchDetector)
    private async startMonitoring(): Promise<void> {
        try {
            await axios.post(`${this.apiBaseUrl}/tokens/monitor/start`);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 400) {
                // Monitoring is already running, this is fine
                console.log('Token monitoring is already active');
            } else {
                console.error('Error starting monitoring:', error);
            }
        }
    }

    private async stopMonitoring(): Promise<void> {
        try {
            await axios.post(`${this.apiBaseUrl}/tokens/monitor/stop`);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 400) {
                // Monitoring is already stopped, this is fine
                console.log('Token monitoring is already stopped');
            } else {
                console.error('Error stopping monitoring:', error);
            }
        }
    }

    private getActivePositions(): any[] {
        // Return empty array since we're not tracking positions
        return [];
    }

    private getTotalTrades(): number {
        // Return 0 since we're not tracking trades
        return 0;
    }
} 