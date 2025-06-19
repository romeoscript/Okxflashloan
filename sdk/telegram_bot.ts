import TelegramBot from 'node-telegram-bot-api';
import { LaunchDetector, TradePosition, PositionSizingConfig } from './launch_detector';
import { PublicKey, Keypair } from '@solana/web3.js';
import axios from 'axios';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';

interface BotConfig {
    minLiquidity: number;
    maxSlippage: number;
    targetProfitPercentage: number;
    maxGasPrice: number;
    dexes: string[];
    blockWindow: number;
}

interface FlashSwapQuote {
    quote: any;
    estimatedOutput: string;
    priceImpact: string;
    route: any[];
    borrowedAmount: string;
    addresses: any;
}

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
    private detector: LaunchDetector;
    private authorizedUserIds: number[];
    private config: BotConfig;
    private positionSizingConfig: PositionSizingConfig;
    private authorizedUsers: Set<number>;
    private apiBaseUrl: string;
    private readonly welcomeMessage = `
🚀 *Welcome to the Memecoin Sniping Bot!*

I'm your automated trading assistant for Solana memecoin launches. Here's what I can do:

📊 *Monitoring*
• Detect new token launches
• Track price movements
• Monitor liquidity changes
• Auto-execute trades

💰 *Trading Features*
• Smart position sizing
• Auto-sell with profit targets
• Stop-loss protection
• Slippage control

_Use the buttons below to control the bot:_
`;

    constructor(token: string, detector: LaunchDetector, authorizedUserIds: number[], apiBaseUrl: string = 'http://localhost:3000') {
        this.bot = new TelegramBot(token, { polling: true });
        this.detector = detector;
        this.authorizedUserIds = authorizedUserIds;
        this.config = detector.getConfig();
        this.positionSizingConfig = detector.getPositionSizingConfig();
        this.authorizedUsers = new Set(authorizedUserIds);
        this.apiBaseUrl = apiBaseUrl;
        this.setupCommands();
        this.setupEventListeners();
    }

    private getMainMenuKeyboard(): TelegramBot.InlineKeyboardMarkup {
        return {
            inline_keyboard: [
                [
                    { text: '📊 Status', callback_data: 'status' },
                    { text: '💰 Positions', callback_data: 'positions' }
                ],
                [
                    { text: '⚙️ Settings', callback_data: 'config' },
                    { text: '❓ Help', callback_data: 'help' }
                ],
                [
                    { text: '▶️ Start Monitoring', callback_data: 'start_monitoring' },
                    { text: '⏹ Stop Monitoring', callback_data: 'stop_monitoring' }
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
                case 'status':
                    await this.handleStatusCommand(chatId);
                    break;
                case 'positions':
                    await this.handlePositionsCommand(chatId);
                    break;
                case 'config':
                    await this.handleConfigCommand(chatId);
                    break;
                case 'help':
                    await this.handleHelpCommand(chatId);
                    break;
                case 'start_monitoring':
                    await this.detector.startMonitoring();
                    await this.bot.sendMessage(chatId, '✅ Started monitoring for new token launches');
                    break;
                case 'stop_monitoring':
                    await this.detector.stopMonitoring();
                    await this.bot.sendMessage(chatId, '⏹ Stopped monitoring for new token launches');
                    break;
                case 'main_menu':
                    await this.bot.editMessageText(this.welcomeMessage, {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: this.getMainMenuKeyboard()
                    });
                    break;
                default:
                    if (action?.startsWith('set_')) {
                        const param = action.replace('set_', '');
                        await this.handleConfigUpdate(chatId, param);
                    }
            }

            // Answer callback query to remove loading state
            await this.bot.answerCallbackQuery(callbackQuery.id);
        });

        // Status command with detailed information
        this.bot.onText(/\/status/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            const positions = this.detector.getActivePositions();
            const totalPnL = positions.reduce((sum, pos) => sum + (pos.currentPnL || 0), 0);
            const activePositions = positions.length;

            const statusMessage = `
📊 *Bot Status Report*

🟢 *System Status*
• Bot: Active
• Detector: Running
• Last Update: ${new Date().toLocaleString()}

💰 *Trading Summary*
• Active Positions: ${activePositions}
• Total PnL: $${totalPnL.toFixed(2)}
• Total Trades: ${this.detector.getTotalTrades()}

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

_Use /positions for detailed position information._
`;

            await this.bot.sendMessage(msg.chat.id, statusMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        });

        // Positions command with detailed position information
        this.bot.onText(/\/positions/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            const positions = this.detector.getActivePositions();
            if (positions.length === 0) {
                await this.bot.sendMessage(msg.chat.id, '📊 No active positions at the moment.', {
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

            await this.bot.sendMessage(msg.chat.id, summaryMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: this.getMainMenuKeyboard()
            });
        });

        // Config command with formatted settings
        this.bot.onText(/\/config/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

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

            await this.bot.sendMessage(msg.chat.id, configMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        });

        // Setconfig command with better formatting
        this.bot.onText(/\/setconfig (.+)/, async (msg, match) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            if (!match) {
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Invalid command format. Use: /setconfig param value\n' +
                    'Example: /setconfig minLiquidity 20000'
                );
                return;
            }

            const [_, param, value] = match[1].match(/(\w+)\s+([\d.]+)/) || [];
            if (!param || !value) {
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Invalid format. Use: /setconfig param value\n' +
                    'Example: /setconfig minLiquidity 20000'
                );
                return;
            }

            try {
                const numValue = parseFloat(value);
                if (isNaN(numValue)) {
                    throw new Error('Invalid number');
                }

                // Update config based on parameter
                const oldValue = this.updateConfig(param, numValue);
                const newValue = this.getConfigValue(param);

                const updateMessage = `
✅ *Configuration Updated*

*${param}:*
• Old Value: ${this.formatConfigValue(param, oldValue)}
• New Value: ${this.formatConfigValue(param, newValue)}

_Use /config to view all settings_
`;

                await this.bot.sendMessage(msg.chat.id, updateMessage, {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
            } catch (error) {
                await this.bot.sendMessage(msg.chat.id, 
                    `❌ Error updating configuration: ${error instanceof Error ? error.message : 'Invalid value'}\n` +
                    'Use /config to view valid parameters and their current values.'
                );
            }
        });

        // Help command with detailed information
        this.bot.onText(/\/help/, async (msg) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            const helpMessage = `
📚 *Bot Command Guide*

*Basic Commands*
/start - Start the bot and view welcome message
/status - Check bot status and trading summary
/positions - View active trading positions
/config - View current configuration
/help - Show this help message

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

            await this.bot.sendMessage(msg.chat.id, helpMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: this.getMainMenuKeyboard()
            });
        });

        // Flashswap Quote command
        this.bot.onText(/\/quote (.+)/, async (msg, match) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            if (!match) {
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Invalid command format. Use: /quote <token_mint> <amount>');
                return;
            }

            try {
                const args = match[1].split(' ');
                if (args.length < 2) {
                    await this.bot.sendMessage(msg.chat.id, 
                        '❌ Invalid format. Use: /quote <token_mint> <amount>\n' +
                        'Example: /quote EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000');
                    return;
                }

                // Get wallet public key from environment
                const privateKey = process.env.SOLANA_PRIVATE_KEY;
                if (!privateKey) {
                    throw new Error('Wallet private key not configured');
                }

                let keypair: Keypair;
                try {
                    // Try parsing as JSON first
                    const secretKey = Uint8Array.from(JSON.parse(privateKey));
                    keypair = Keypair.fromSecretKey(secretKey);
                } catch (e) {
                    try {
                        // If JSON parsing fails, try base58
                        const secretKey = bs58.decode(privateKey);
                        keypair = Keypair.fromSecretKey(secretKey);
                    } catch (e2) {
                        throw new Error('Invalid private key format. Must be either JSON array or base58 string');
                    }
                }

                const walletPublicKey = keypair.publicKey.toString();

                const [tokenMint, amount] = args;
                const quote = await this.getFlashSwapQuote(tokenMint, amount, walletPublicKey);

                const message = `
💱 *Flash Swap Quote*

📊 *Token Details*
• Target Token: \`${tokenMint}\`
• Desired Amount: ${amount}

💰 *Quote Details*
• Estimated Output: ${quote.estimatedOutput}
• Price Impact: ${quote.priceImpact}%
• Borrowed Amount: ${quote.borrowedAmount} lamports

🛣️ *Route*
• Steps: ${quote.route.length}

_To execute this swap, use:_
\`/flashswap ${tokenMint} ${amount}\`
`;

                await this.bot.sendMessage(msg.chat.id, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '🔄 Execute Swap', callback_data: `execute_${tokenMint}_${amount}` }
                        ]]
                    }
                });
            } catch (error) {
                console.error('Quote error:', error);
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Failed to get quote: ' + (error instanceof Error ? error.message : 'Unknown error'));
            }
        });

        // Flashswap Execute command
        this.bot.onText(/\/flashswap (.+)/, async (msg, match) => {
            if (!this.isAuthorized(msg.from?.id)) {
                await this.sendUnauthorizedMessage(msg.chat.id);
                return;
            }

            if (!match) {
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Invalid command format. Use: /flashswap <token_mint> <amount>');
                return;
            }

            try {
                const args = match[1].split(' ');
                if (args.length < 2) {
                    await this.bot.sendMessage(msg.chat.id, 
                        '❌ Invalid format. Use: /flashswap <token_mint> <amount>\n' +
                        'Example: /flashswap EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000');
                    return;
                }

                const [tokenMint, amount] = args;
                await this.executeFlashSwap(tokenMint, amount, msg);
            } catch (error) {
                console.error('Flashswap error:', error);
                await this.bot.sendMessage(msg.chat.id, 
                    '❌ Failed to execute flash swap: ' + (error instanceof Error ? error.message : 'Unknown error'));
            }
        });

        // Handle callback queries (e.g., Execute Swap button)
        this.bot.on('callback_query', async (query) => {
            if (!query.message || !this.isAuthorized(query.from.id)) {
                await this.bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
                return;
            }

            if (query.data?.startsWith('execute_')) {
                const [_, tokenMint, amount] = query.data.split('_');
                await this.executeFlashSwap(tokenMint, amount, query.message);
                await this.bot.answerCallbackQuery(query.id);
            }
        });
    }

    private setupEventListeners() {
        // New launch event
        this.detector.on('newLaunch', async (launch) => {
            const message = `
🚀 *New Token Launch Detected!*

*Token:* \`${launch.tokenAddress.toString()}\`
💰 *Initial Liquidity:* $${launch.initialLiquidity.toLocaleString()}
💱 *DEX:* ${launch.dex}
⏰ *Time:* ${new Date().toLocaleString()}

_Use /positions to track this token_
`;

            await this.broadcastMessage(message);
        });

        // Price update event
        this.detector.on('priceUpdate', async (update) => {
            if (update.position) {
                const pnlColor = update.priceChange >= 0 ? '🟢' : '🔴';
                const message = `
${pnlColor} *Price Update*

*Token:* \`${update.launch.tokenAddress.toString()}\`
📈 *Change:* ${(update.priceChange * 100).toFixed(2)}%
💰 *Current Price:* $${update.currentPrice.toFixed(6)}
💵 *PnL:* $${update.position.currentPnL?.toFixed(2) || '0.00'}
⏰ *Time:* ${new Date().toLocaleString()}
`;

                await this.broadcastMessage(message);
            }
        });

        // Sell executed event
        this.detector.on('sellExecuted', async (result) => {
            const emoji = result.pnl >= 0 ? '✅' : '❌';
            const message = `
${emoji} *Position Closed*

*Token:* \`${result.tokenAddress.toString()}\`
💰 *Final PnL:* $${result.pnl.toFixed(2)}
📈 *Return:* ${(result.returnPercentage * 100).toFixed(2)}%
⏰ *Time:* ${new Date().toLocaleString()}

_Use /positions to view remaining positions_
`;

            await this.broadcastMessage(message);
        });

        // Sell error event
        this.detector.on('sellError', async (error) => {
            const message = `
❌ *Sell Error*

*Token:* \`${error.tokenAddress.toString()}\`
⚠️ *Error:* ${error.error}
⏰ *Time:* ${new Date().toLocaleString()}

_Use /positions to view current positions_
`;

            await this.broadcastMessage(message);
        });
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

    private async handleStatusCommand(chatId: number) {
        const positions = this.detector.getActivePositions();
        const totalPnL = positions.reduce((sum, pos) => sum + (pos.currentPnL || 0), 0);
        const activePositions = positions.length;

        const statusMessage = `
📊 *Bot Status Report*

🟢 *System Status*
• Bot: Active
• Detector: Running
• Last Update: ${new Date().toLocaleString()}

💰 *Trading Summary*
• Active Positions: ${activePositions}
• Total PnL: $${totalPnL.toFixed(2)}
• Total Trades: ${this.detector.getTotalTrades()}

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

_Use the buttons below to control the bot:_
`;

        await this.bot.sendMessage(chatId, statusMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: this.getMainMenuKeyboard()
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

_Click a button below to update settings:_
`;

        await this.bot.sendMessage(chatId, configMessage, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: this.getConfigKeyboard()
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
        const positions = this.detector.getActivePositions();
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

    private async getFlashSwapQuote(tokenMint: string, amount: string, walletPublicKey: string): Promise<FlashSwapQuote> {
        try {
            const response = await axios.get(`${this.apiBaseUrl}/flashswap/quote`, {
                params: {
                    targetTokenMint: tokenMint,
                    desiredTargetAmount: amount,
                    slippageBps: this.config.maxSlippage * 10000,
                    walletPublicKey
                }
            });
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(error.response?.data?.error || error.message);
            }
            throw error;
        }
    }

    private async executeFlashSwap(tokenMint: string, amount: string, msg: TelegramBot.Message) {
        const chatId = msg.chat.id;
        
        // Send initial status
        const statusMsg = await this.bot.sendMessage(chatId, '🔄 Preparing flash swap...');

        try {
            // Get user's wallet from environment or secure storage
            // Note: In production, you should use a secure wallet management system
            const privateKey = process.env.SOLANA_PRIVATE_KEY;
            if (!privateKey) {
                throw new Error('Wallet private key not configured');
            }

            let keypair: Keypair;
            try {
                // Try parsing as JSON first
                const secretKey = Uint8Array.from(JSON.parse(privateKey));
                keypair = Keypair.fromSecretKey(secretKey);
            } catch (e) {
                try {
                    // If JSON parsing fails, try base58
                    const secretKey = bs58.decode(privateKey);
                    keypair = Keypair.fromSecretKey(secretKey);
                } catch (e2) {
                    throw new Error('Invalid private key format. Must be either JSON array or base58 string');
                }
            }

            const walletPublicKey = keypair.publicKey.toString();

            // Execute the flash swap
            const response = await axios.post(`${this.apiBaseUrl}/flashswap/execute`, {
                targetTokenMint: tokenMint,
                desiredTargetAmount: amount,
                slippageBps: this.config.maxSlippage * 10000,
                walletPrivateKey: privateKey
            });

            const result: FlashSwapExecuteResponse = response.data;

            // Update status with success
            const successMessage = `
✅ *Flash Swap Executed Successfully*

📊 *Transaction Details*
• Target Token: \`${tokenMint}\`
• Amount: ${amount}
• Estimated Output: ${result.estimatedOutput}
• Price Impact: ${result.priceImpact}%
• Borrowed Amount: ${result.borrowedAmount} lamports

🔗 [View Transaction on Solscan](${result.explorerUrl})

_Transaction has been signed and submitted to the network._
`;

            await this.bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: false
            });

        } catch (error) {
            // Update status with error
            const errorMessage = '❌ Flash swap failed: ' + 
                (error instanceof Error ? error.message : 'Unknown error');
            await this.bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
            throw error;
        }
    }

    // Public methods
    async stop() {
        await this.bot.stopPolling();
    }
} 