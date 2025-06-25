import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { EmbeddedWalletManager, EmbeddedWalletSession } from './embedded_wallet_manager';
import { DatabaseManager } from './database_manager';

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
    private walletManager: EmbeddedWalletManager;
    private databaseManager: DatabaseManager;
    private readonly welcomeMessage = `
🚀 *Welcome to Solana Flash Loan Bot\\!*

This bot provides embedded wallets and flash loan capabilities on Solana\\.

**Features:**
• 🎉 Create embedded wallets instantly (one per user)
• 💱 Flash loan quotes and execution
• 🔐 Secure wallet management
• 📊 Real\\-time token monitoring

**Getting Started:**
1. Create your embedded wallet (one per user)
2. Get flash loan quotes
3. Execute flash loans automatically

Your wallet is fully controlled by you \\- we never have access to your funds\\!
    `;

    constructor(token: string, authorizedUserIds: number[], connection: Connection, apiBaseUrl: string = 'http://localhost:3000') {
        this.bot = new TelegramBot(token, { polling: true });
        this.authorizedUserIds = authorizedUserIds;
        this.databaseManager = new DatabaseManager();
        this.walletManager = new EmbeddedWalletManager(connection, this.databaseManager);
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
                    { text: '👛 Create Wallet', callback_data: 'create_wallet' },
                    { text: '📊 Wallet Status', callback_data: 'wallet_status' }
                ],
                [
                    { text: '💱 Flash Quote', callback_data: 'flash_quote' },
                    { text: '📈 Token Monitor', callback_data: 'token_monitor' }
                ],
                [
                    { text: 'ℹ️ Help', callback_data: 'help' }
                ]
            ]
        };
    }

    private getWalletKeyboard(): TelegramBot.InlineKeyboardMarkup {
        return {
            inline_keyboard: [
                [
                    { text: '👛 Wallet Info', callback_data: 'wallet_info' },
                    { text: '💾 Backup Wallet', callback_data: 'backup_wallet' },
                    { text: '💸 Export Wallet', callback_data: 'export_wallet' }
                ],
                [
                    { text: '❌ Delete Wallet', callback_data: 'delete_wallet' },
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

            await this.handleConnectWallet(msg.chat.id, msg.from!.id);
        });

        // Flash quote command
        this.bot.onText(/\/flashquote (.+)/, async (msg, match) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            if (!this.walletManager.hasWallet(msg.from!.id)) {
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Please create a wallet first using /createwallet or the "Create Wallet" button.');
                return;
            }

            const parts = match![1].trim().split(/\s+/);
            const tokenMint = parts[0];
            const amount = parts[1] || "1"; // Default to 1 SOL if no amount specified
            
            await this.handleFlashQuoteCommand(msg.chat.id, msg.from!.id, tokenMint, amount);
        });

        // Create wallet command
        this.bot.onText(/\/createwallet/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            await this.handleCreateWallet(msg.chat.id, msg.from!.id);
        });

        // Export wallet command
        this.bot.onText(/\/exportwallet/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            await this.handleExportWallet(msg.chat.id, msg.from!.id);
        });

        // Handle callback queries (button clicks)
        this.bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message!.chat.id;
            
            switch (callbackQuery.data) {
                case 'main_menu':
                    await this.showMainMenu(chatId);
                    break;
                case 'create_wallet':
                    await this.handleCreateWallet(chatId, callbackQuery.from.id);
                    break;
                case 'wallet_status':
                    await this.handleWalletStatus(chatId, callbackQuery.from.id);
                    break;
                case 'wallet_info':
                    await this.handleWalletInfo(chatId, callbackQuery.from.id);
                    break;
                case 'backup_wallet':
                    await this.handleBackupWallet(chatId, callbackQuery.from.id);
                    break;
                case 'export_wallet':
                    await this.handleExportWallet(chatId, callbackQuery.from.id);
                    break;
                case 'delete_wallet':
                    await this.handleDisconnectWallet(chatId, callbackQuery.from.id);
                    break;
                case 'flash_quote':
                    await this.handleFlashQuoteMenu(chatId, callbackQuery.from.id);
                    break;
                case 'token_monitor':
                    await this.handleTokenMonitor(chatId, callbackQuery.from.id);
                    break;
                case 'help':
                    await this.handleHelp(chatId);
                    break;
                default:
                    await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Unknown action' });
            }
            
            await this.bot.answerCallbackQuery(callbackQuery.id);
        });

        // Handle text messages for wallet connection
        this.bot.on('message', async (msg) => {
            if (!msg.text || !this.isAuthorized(msg.from?.id)) return;

            const chatId = msg.chat.id;
            const userId = msg.from!.id;

            // Handle token mint addresses for flash quotes
            if (msg.text.length === 44 && /^[A-Za-z0-9]{44}$/.test(msg.text)) {
                if (await this.walletManager.hasWallet(userId)) {
                    await this.handleFlashQuoteCommand(chatId, userId, msg.text, "1");
                } else {
                    await this.bot.sendMessage(chatId, 
                        '❌ Please create a wallet first using /createwallet or the "Create Wallet" button.');
                }
            }
        });
    }

    private async handleWalletStatus(chatId: number, userId: number) {
        const walletInfo = await this.walletManager.getWalletInfo(userId);
        
        if (walletInfo) {
            const balance = await this.walletManager.getWalletBalance(userId);
            const message = `
👛 *Wallet Status*

✅ *Connected:* Yes
🔑 *Address:* \`${walletInfo.publicKey}\`
💰 *Balance:* ${balance.toFixed(4)} SOL
📅 *Created:* ${new Date(walletInfo.connectedAt).toLocaleDateString()}

Your embedded wallet is ready for flash loans\\!
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet connected. Use /createwallet to create one.');
        }
    }

    private async handleConnectWallet(chatId: number, userId: number) {
        // For embedded wallets, we create them directly
        await this.handleCreateWallet(chatId, userId);
    }

    private async handleDisconnectWallet(chatId: number, userId: number) {
        const success = await this.walletManager.deleteWallet(userId);
        
        if (success) {
            await this.bot.sendMessage(chatId, '✅ Wallet deleted successfully.');
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet found to delete.');
        }
    }

    private async handleWalletInfo(chatId: number, userId: number) {
        const walletInfo = await this.walletManager.getWalletInfo(userId);
        
        if (walletInfo) {
            const balance = await this.walletManager.getWalletBalance(userId);
            const message = `
👛 *Wallet Information*

🔑 *Address:* \`${walletInfo.publicKey}\`
💰 *Balance:* ${balance.toFixed(4)} SOL
📅 *Created:* ${new Date(walletInfo.connectedAt).toLocaleDateString()}
🕐 *Created Time:* ${new Date(walletInfo.connectedAt).toLocaleTimeString()}

**Wallet Type:** Embedded Wallet
**Status:** Active and Ready

Your wallet is ready for flash loans and swaps\\!
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet found. Use /createwallet to create one.');
        }
    }

    private async handleBackupWallet(chatId: number, userId: number) {
        const mnemonic = await this.walletManager.backupWallet(userId);
        
        if (mnemonic) {
            // Escape special characters for Telegram markdown
            const escapedMnemonic = mnemonic.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
            
            const message = `
💾 *Wallet Backup*

🔐 *Seed Phrase:* \`${escapedMnemonic}\`

**Important:**
• Save this seed phrase securely
• Never share it with anyone
• You can import this wallet into Phantom, Solflare, etc\\.
• This is the only way to recover your wallet

⚠️ *Keep this seed phrase safe\\!*
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet found to backup.');
        }
    }

    private async handleExportWallet(chatId: number, userId: number) {
        const exportData = await this.walletManager.exportWallet(userId);
        
        if (exportData) {
            await this.bot.sendMessage(chatId, exportData.message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            await this.bot.sendMessage(chatId, '❌ No wallet found to export.');
        }
    }

    private async handleFlashQuoteMenu(chatId: number, userId: number) {
        if (!(await this.walletManager.hasWallet(userId))) {
            await this.bot.sendMessage(chatId, 
                '❌ Please create a wallet first using the "Create Wallet" button.');
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
        if (!(await this.walletManager.hasWallet(userId))) {
            await this.bot.sendMessage(chatId, 
                '❌ Please create a wallet first using the "Create Wallet" button.');
            return;
        }

        const message = `
⚡ *Flash Swap*

To execute a flash swap, first get a quote using /flashquote, then follow the instructions to execute the transaction.

**Steps:**
1. Get a quote: \`/flashquote TOKEN_MINT\`
2. Review the quote details
3. Execute the flash loan (your wallet signs automatically)

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

    private async handleCreateWallet(chatId: number, userId: number) {
        const hasWallet = await this.walletManager.hasWallet(userId);
        
        if (hasWallet) {
            const walletInfo = await this.walletManager.getWalletInfo(userId);
            const balance = await this.walletManager.getWalletBalance(userId);
            const message = `
🎉 *Wallet Already Exists*

👛 *Wallet Address:* \`${walletInfo!.publicKey}\`
💰 *Balance:* ${balance.toFixed(4)} SOL
📅 *Created:* ${new Date(walletInfo!.connectedAt).toLocaleDateString()}

**You can only have one wallet per user.**

**Available Actions:**
• Use /walletinfo for detailed information
• Use /backupwallet to get your seed phrase
• Use /exportwallet to export your private key
• Use /deletewallet to delete and create a new one

Your embedded wallet is ready for flash loans and swaps\\!
            `;
            
            await this.bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: this.getWalletKeyboard()
            });
        } else {
            const statusMsg = await this.bot.sendMessage(chatId, '🔄 Creating your embedded wallet...');

            try {
                const result = await this.walletManager.generateWalletForUser(userId);
                
                await this.bot.editMessageText(result.message, {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: this.getWalletKeyboard()
                });
            } catch (error) {
                await this.bot.editMessageText(
                    '❌ Failed to create wallet: ' + (error instanceof Error ? error.message : 'Unknown error'), {
                    chat_id: chatId,
                    message_id: statusMsg.message_id
                });
            }
        }
    }

    private async handleFlashQuoteCommand(chatId: number, userId: number, tokenMint: string, amount: string) {
        const statusMsg = await this.bot.sendMessage(chatId, '🔄 Getting flash loan quote...');

        try {
            const walletInfo = await this.walletManager.getWalletInfo(userId);
            if (!walletInfo) {
                throw new Error('Wallet not found. Please create a wallet first using /createwallet');
            }

            const response = await axios.get(`${this.apiBaseUrl}/flashswap/quote`, {
                params: {
                    targetTokenMint: tokenMint,
                    desiredTargetAmount: amount,
                    slippageBps: this.config.maxSlippage * 10000,
                    userId: userId
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
3. Your embedded wallet will sign automatically
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
            let errorMessage = '❌ Failed to get flash swap quote';
            
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 400) {
                    errorMessage += ': Invalid parameters or wallet not found';
                } else if (error.response?.status === 404) {
                    errorMessage += ': Token not found or no liquidity';
                } else if (error.response?.status === 500) {
                    errorMessage += ': Server error - please try again later';
                } else {
                    errorMessage += `: ${error.response?.data?.error || error.message}`;
                }
            } else if (error instanceof Error) {
                errorMessage += `: ${error.message}`;
            } else {
                errorMessage += ': Unknown error occurred';
            }
            
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
/flashquote TOKEN\\_MINT [AMOUNT] \\- Get a flash loan quote
• Example: \`/flashquote EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 2\`
• Example: \`/flashquote DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263\` (defaults to 1 SOL)
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

    private async showMainMenu(chatId: number) {
        await this.bot.sendMessage(chatId, this.welcomeMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: this.getMainMenuKeyboard()
        });
    }

    private async handleTokenMonitor(chatId: number, userId: number) {
        const message = `
📈 *Token Monitor*

This feature monitors for new token launches on Solana.

**Status:** Coming Soon

We're working on real-time token monitoring capabilities\\.
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

    private async handleHelp(chatId: number) {
        const message = `
❓ *Help & Commands*

**Wallet Commands:**
• /createwallet \\- Create a new embedded wallet (one per user)
• /walletstatus \\- Check your wallet status
• /walletinfo \\- Get detailed wallet information
• /backupwallet \\- Get your wallet's seed phrase
• /exportwallet \\- Export your wallet (private key + seed phrase)
• /deletewallet \\- Delete your wallet

**Flash Loan Commands:**
• /flashquote TOKEN\\_MINT [AMOUNT] \\- Get a flash loan quote
• Example: \`/flashquote EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 2\`
• Example: \`/flashquote DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263\` (defaults to 1 SOL)

**How Flash Loans Work:**
1. Get a quote for the token you want
2. Review the estimated output and price impact
3. Execute the flash loan transaction
4. Your embedded wallet signs automatically

**Security:**
• Your seed phrase is your backup \\- keep it safe
• Never share your seed phrase
• You can import your wallet to other apps

Need help\\? Contact support\\!
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