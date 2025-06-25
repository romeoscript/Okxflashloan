import TelegramBot from 'node-telegram-bot-api';
import { Connection, PublicKey } from '@solana/web3.js';
import { buildSimulatedFlashLoanInstructions } from './flash_swap';
import { EmbeddedWalletManager } from './embedded_wallet_manager';
import { DatabaseManager } from './database_manager';
import axios from 'axios';

interface SimpleFlashBotConfig {
  minLiquidity: number;
  maxSlippage: number;
  targetProfitPercentage: number;
  maxGasPrice: number;
}

export class SimpleFlashBot {
  private bot: TelegramBot;
  private authorizedUserIds: number[];
  private config: SimpleFlashBotConfig;
  private authorizedUsers: Set<number>;
  private apiBaseUrl: string;
  private walletManager: EmbeddedWalletManager;
  private databaseManager: DatabaseManager;
  private connection: Connection;
  private isMonitoring: boolean = false;
  private processedTokens: Set<string> = new Set();
  private waitingForTokenAddress = new Map<number, boolean>();
  private waitingForAmount = new Map<number, boolean>();
  private pendingSnipes = new Map<number, { tokenAddress: string }>();

  constructor(
    token: string, 
    authorizedUserIds: number[], 
    connection: Connection, 
    apiBaseUrl: string = 'http://localhost:3000'
  ) {
    this.bot = new TelegramBot(token, { polling: true });
    this.authorizedUserIds = authorizedUserIds;
    this.databaseManager = new DatabaseManager();
    this.walletManager = new EmbeddedWalletManager(connection, this.databaseManager);
    this.connection = connection;
    this.config = {
      minLiquidity: 10000,    // $10k minimum liquidity
      maxSlippage: 0.01,      // 1% max slippage
      targetProfitPercentage: 0.03, // 3% target profit
      maxGasPrice: 1000000,   // 0.001 SOL max gas
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
          { text: '💰 Wallet Balance', callback_data: 'wallet_balance' }
        ],
        [
          { text: '🔑 Show Address', callback_data: 'show_address' },
          { text: '📤 Export Wallet', callback_data: 'export_wallet' }
        ],
        [
          { text: '🎯 Start Sniping', callback_data: 'start_sniping' },
          { text: '⚡ Quick Snipe', callback_data: 'quick_snipe' }
        ],
        [
          { text: '📊 Sniping Status', callback_data: 'sniping_status' }
        ]
      ]
    };
  }

  private setupCommands() {
    // Start command
    this.bot.onText(/\/start/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      const welcomeMessage = `🚀 Simple Flash Loan Bot

Features:
• 🎯 Automatic token monitoring
• ⚡ Interactive flash loan sniping
• 💰 Profit auto-collection
• 🔑 Wallet management

Commands:
• /snip - Start interactive sniping (asks for token & amount)
• /balance - Check wallet balance
• /address - Show wallet address
• /export - Export wallet (private key + seed phrase)
• /status - Check monitoring status

Buttons:
• ⚡ Quick Snipe - Start sniping with prompts
• 🎯 Start Sniping - Start automatic monitoring
• 📊 Sniping Status - View current status

Use the buttons below to get started!`;

      await this.bot.sendMessage(msg.chat.id, welcomeMessage, {
        reply_markup: this.getMainMenuKeyboard()
      });
    });

    // Sniping command
    this.bot.onText(/\/snip/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      const hasWallet = await this.walletManager.hasWallet(msg.from!.id);
      if (!hasWallet) {
        await this.bot.sendMessage(msg.chat.id, 
          '❌ Please create a wallet first using the "Create Wallet" button.');
        return;
      }

      await this.startSnipingFlow(msg.chat.id, msg.from!.id);
    });

    // Handle sniping with parameters (for backward compatibility)
    this.bot.onText(/\/snip (.+)/, async (msg, match) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      const hasWallet = await this.walletManager.hasWallet(msg.from!.id);
      if (!hasWallet) {
        await this.bot.sendMessage(msg.chat.id, 
          '❌ Please create a wallet first using the "Create Wallet" button.');
        return;
      }

      const parts = match![1].trim().split(/\s+/);
      const tokenMint = parts[0];
      const amount = parts[1] || "1"; // Default to 1 SOL

      await this.executeFlashSniping(msg.chat.id, msg.from!.id, tokenMint, amount);
    });

    // Balance command
    this.bot.onText(/\/balance/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      await this.handleWalletBalance(msg.chat.id, msg.from!.id);
    });

    // Address command
    this.bot.onText(/\/address/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      await this.handleShowAddress(msg.chat.id, msg.from!.id);
    });

    // Export command
    this.bot.onText(/\/export/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      await this.handleExportWallet(msg.chat.id, msg.from!.id);
    });

    // Status command
    this.bot.onText(/\/status/, async (msg) => {
      if (!this.isAuthorized(msg.from?.id)) {
        await this.sendUnauthorizedMessage(msg.chat.id);
        return;
      }

      await this.handleSnipingStatus(msg.chat.id);
    });

    // Callback query handler
    this.bot.on('callback_query', async (query) => {
      if (!this.isAuthorized(query.from?.id)) {
        await this.sendUnauthorizedMessage(query.message!.chat.id);
        return;
      }

      const chatId = query.message!.chat.id;
      const userId = query.from!.id;

      switch (query.data) {
        case 'create_wallet':
          await this.handleCreateWallet(chatId, userId);
          break;
        case 'wallet_balance':
          await this.handleWalletBalance(chatId, userId);
          break;
        case 'show_address':
          await this.handleShowAddress(chatId, userId);
          break;
        case 'export_wallet':
          await this.handleExportWallet(chatId, userId);
          break;
        case 'start_sniping':
          await this.handleStartSniping(chatId);
          break;
        case 'quick_snipe':
          await this.handleQuickSnipe(chatId, userId);
          break;
        case 'stop_sniping':
          await this.handleStopSniping(chatId);
          break;
        case 'sniping_status':
          await this.handleSnipingStatus(chatId);
          break;
      }

      await this.bot.answerCallbackQuery(query.id);
    });

    // Add message handler for text input
    this.setupMessageHandler();
  }

  private async handleCreateWallet(chatId: number, userId: number) {
    try {
      const hasWallet = await this.walletManager.hasWallet(userId);
      if (hasWallet) {
        await this.bot.sendMessage(chatId, '❌ Wallet already exists for this user.');
        return;
      }

      const result = await this.walletManager.generateWalletForUser(userId);
      
      await this.bot.sendMessage(chatId, 
        `✅ Wallet Created Successfully!\n\n` +
        `🔑 Public Key: ${result.publicKey}\n` +
        `💡 ${result.message}\n\n` +
        `You can now start sniping!`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to create wallet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleWalletBalance(chatId: number, userId: number) {
    try {
      const hasWallet = await this.walletManager.hasWallet(userId);
      if (!hasWallet) {
        await this.bot.sendMessage(chatId, '❌ No wallet found. Please create one first.');
        return;
      }

      const balance = await this.walletManager.getWalletBalance(userId);
      
      await this.bot.sendMessage(chatId, 
        `💰 Wallet Balance\n\n` +
        `💎 SOL: ${balance.toFixed(4)}\n` +
        `📊 Lamports: ${balance}\n\n` +
        `Ready for sniping!`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to get balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleShowAddress(chatId: number, userId: number) {
    try {
      const hasWallet = await this.walletManager.hasWallet(userId);
      if (!hasWallet) {
        await this.bot.sendMessage(chatId, '❌ No wallet found. Please create one first.');
        return;
      }

      const walletInfo = await this.walletManager.getWalletInfo(userId);
      if (!walletInfo) {
        await this.bot.sendMessage(chatId, '❌ Failed to get wallet info.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        `🔑 Your Wallet Address\n\n` +
        `📝 Public Key:\n${walletInfo.publicKey}\n\n` +
        `📅 Created: ${walletInfo.connectedAt.toLocaleDateString()}\n\n` +
        `💡 You can use this address to receive SOL or tokens!`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to get wallet address: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleExportWallet(chatId: number, userId: number) {
    try {
      const hasWallet = await this.walletManager.hasWallet(userId);
      if (!hasWallet) {
        await this.bot.sendMessage(chatId, '❌ No wallet found. Please create one first.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        `📤 Exporting your wallet...\n\n` +
        `⏳ Please wait while I prepare your wallet data...`);

      const exportData = await this.walletManager.exportWallet(userId);
      if (!exportData) {
        await this.bot.sendMessage(chatId, '❌ Failed to export wallet.');
        return;
      }

      await this.bot.sendMessage(chatId, 
        `✅ Wallet Exported Successfully!\n\n` +
        `🔑 Public Key:\n${exportData.publicKey}\n\n` +
        `🔐 Private Key:\n${exportData.privateKey}\n\n` +
        `🌱 Seed Phrase:\n${exportData.mnemonic}\n\n` +
        `⚠️ IMPORTANT: Keep this information secure and never share it with anyone!\n\n` +
        `💡 You can import this wallet into other Solana wallets using the private key or seed phrase.`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to export wallet: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleStartSniping(chatId: number) {
    try {
      if (this.isMonitoring) {
        await this.bot.sendMessage(chatId, '⚠️ Token monitoring is already active.');
        return;
      }

      // Start token monitoring via API
      await axios.post(`${this.apiBaseUrl}/tokens/monitor/start`);
      this.isMonitoring = true;

      // Set up polling for new tokens
      this.startTokenPolling();

      await this.bot.sendMessage(chatId, 
        `🎯 Sniping Started!\n\n` +
        `✅ Token monitoring: Active\n` +
        `🔍 Scanning for new tokens...\n\n` +
        `You'll be notified of new opportunities automatically!`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to start sniping: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleStopSniping(chatId: number) {
    try {
      if (!this.isMonitoring) {
        await this.bot.sendMessage(chatId, '⚠️ Token monitoring is not active.');
        return;
      }

      // Stop token monitoring via API
      await axios.post(`${this.apiBaseUrl}/tokens/monitor/stop`);
      this.isMonitoring = false;

      await this.bot.sendMessage(chatId, 
        `⏹️ Sniping Stopped!\n\n` +
        `✅ Token monitoring: Inactive\n` +
        `🔍 No longer scanning for new tokens`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to stop sniping: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleSnipingStatus(chatId: number) {
    try {
      const status = this.isMonitoring ? '🟢 Active' : '🔴 Inactive';
      
      await this.bot.sendMessage(chatId, 
        `📊 Sniping Status\n\n` +
        `🎯 Token Monitoring: ${status}\n` +
        `📈 Processed Tokens: ${this.processedTokens.size}\n\n` +
        `Use /snip <token_address> <amount> to manually snipe any token`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to get status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeFlashSniping(chatId: number, userId: number, tokenMint: string, amount: string) {
    try {
      await this.bot.sendMessage(chatId, 
        `🎯 Executing Flash Sniping...\n\n` +
        `🪙 Token: ${tokenMint}\n` +
        `💰 Amount: ${amount} SOL\n` +
        `⏳ Processing...`);

      // Get user's wallet
      const userWallet = await this.walletManager.getUserAnchorWallet(userId);
      if (!userWallet) {
        await this.bot.sendMessage(chatId, '❌ User wallet not found.');
        return;
      }

      // Build flash loan instructions
      const result = await buildSimulatedFlashLoanInstructions({
        targetTokenMint: new PublicKey(tokenMint),
        desiredTargetAmount: (parseFloat(amount) * 1e9).toString(), // Convert SOL to lamports
        slippageBps: 100, // 1% slippage
        connection: this.connection,
        wallet: userWallet
      });

      // Execute the transaction
      const signature = await this.walletManager.executeTransactionWithUserWallet(userId, result.transaction);
      const explorerUrl = `https://solscan.io/tx/${signature}`;

      await this.bot.sendMessage(chatId, 
        `✅ Flash Sniping Complete!\n\n` +
        `🪙 Token: ${tokenMint}\n` +
        `💰 Amount: ${amount} SOL\n` +
        `📊 Estimated Output: ${result.estimatedOutput}\n` +
        `📈 Price Impact: ${result.priceImpact}%\n` +
        `🔗 View Transaction: ${explorerUrl}`, {
        disable_web_page_preview: true
      });

    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Flash Sniping Failed!\n\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n\n` +
        `Please check the token address and try again.`);
    }
  }

  private startTokenPolling() {
    // Poll for new tokens every 5 seconds
    setInterval(async () => {
      if (!this.isMonitoring) return;

      try {
        const response = await axios.get(`${this.apiBaseUrl}/tokens/new/recent?limit=5`);
        const tokens = response.data.tokens || [];
        
        // Filter out already processed tokens
        const newTokens = tokens.filter((token: any) => {
          const tokenId = `${token.lpSignature}-${token.baseInfo.baseAddress}`;
          if (this.processedTokens.has(tokenId)) {
            return false;
          }
          this.processedTokens.add(tokenId);
          return true;
        });
        
        if (newTokens.length > 0) {
          await this.notifyNewTokens(newTokens);
        }
      } catch (error) {
        console.error('Error polling for new tokens:', error);
      }
    }, 5000);
  }

  private async notifyNewTokens(tokens: any[]) {
    for (const token of tokens) {
      const message = 
        `🚨 New Token Detected!\n\n` +
        `🪙 Token: ${token.baseInfo.baseAddress}\n` +
        `👤 Creator: ${token.creator}\n` +
        `💰 LP Amount: ${token.baseInfo.baseLpAmount}\n` +
        `⏰ Time: ${new Date(token.timestamp).toLocaleString()}\n\n` +
        `Use /snip ${token.baseInfo.baseAddress} <amount> to snipe this token!`;

      // Notify all authorized users
      for (const userId of this.authorizedUserIds) {
        try {
          await this.bot.sendMessage(userId, message);
        } catch (error) {
          console.error(`Failed to notify user ${userId}:`, error);
        }
      }
    }
  }

  private isAuthorized(userId?: number): boolean {
    return userId ? this.authorizedUsers.has(userId) : false;
  }

  private async sendUnauthorizedMessage(chatId: number) {
    await this.bot.sendMessage(chatId, 
      '❌ You are not authorized to use this bot. Please contact the administrator.');
  }

  async stop() {
    if (this.isMonitoring) {
      try {
        await axios.post(`${this.apiBaseUrl}/tokens/monitor/stop`);
      } catch (error) {
        console.error('Error stopping monitoring:', error);
      }
    }
    await this.bot.stopPolling();
  }

  private async startSnipingFlow(chatId: number, userId: number) {
    try {
      await this.bot.sendMessage(chatId, 
        `🎯 Flash Loan Sniping\n\n` +
        `Please provide the token contract address you want to snipe.\n\n` +
        `Example: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n\n` +
        `Just paste the token address below:`);

      // Store the user's state to expect token address
      this.waitingForTokenAddress.set(userId, true);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to start sniping flow: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleTokenAddressInput(chatId: number, userId: number, tokenAddress: string) {
    try {
      // Validate token address format
      if (!tokenAddress.match(/^[A-Za-z0-9]{32,44}$/)) {
        await this.bot.sendMessage(chatId, 
          `❌ Invalid token address format.\n\n` +
          `Please provide a valid Solana token address.\n` +
          `Example: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n\n` +
          `Try again:`);
        return;
      }

      // Store the token address and ask for amount
      this.pendingSnipes.set(userId, { tokenAddress });
      this.waitingForTokenAddress.delete(userId);
      this.waitingForAmount.set(userId, true);

      await this.bot.sendMessage(chatId, 
        `✅ Token Address: ${tokenAddress}\n\n` +
        `Now please provide the amount in SOL you want to use for sniping.\n\n` +
        `Example: 1 (for 1 SOL)\n` +
        `Example: 0.5 (for 0.5 SOL)\n\n` +
        `Enter the amount:`);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Error processing token address: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleAmountInput(chatId: number, userId: number, amount: string) {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        await this.bot.sendMessage(chatId, 
          `❌ Invalid amount. Please provide a valid number greater than 0.\n\n` +
          `Example: 1, 0.5, 2.5\n\n` +
          `Try again:`);
        return;
      }

      const pendingSnipe = this.pendingSnipes.get(userId);
      if (!pendingSnipe) {
        await this.bot.sendMessage(chatId, '❌ No pending snipe found. Please start over with /snip');
        return;
      }

      // Clear the pending state
      this.waitingForAmount.delete(userId);
      this.pendingSnipes.delete(userId);

      // Execute the flash sniping
      await this.executeFlashSniping(chatId, userId, pendingSnipe.tokenAddress, amount);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Error processing amount: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Add message handler for text input
  private setupMessageHandler() {
    this.bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return; // Skip commands
      if (!this.isAuthorized(msg.from?.id)) return;

      const userId = msg.from!.id;
      const chatId = msg.chat.id;
      const text = msg.text.trim();

      // Check if user is waiting for token address
      if (this.waitingForTokenAddress.has(userId)) {
        await this.handleTokenAddressInput(chatId, userId, text);
        return;
      }

      // Check if user is waiting for amount
      if (this.waitingForAmount.has(userId)) {
        await this.handleAmountInput(chatId, userId, text);
        return;
      }
    });
  }

  private async handleQuickSnipe(chatId: number, userId: number) {
    try {
      const hasWallet = await this.walletManager.hasWallet(userId);
      if (!hasWallet) {
        await this.bot.sendMessage(chatId, 
          '❌ Please create a wallet first using the "Create Wallet" button.');
        return;
      }

      await this.startSnipingFlow(chatId, userId);
    } catch (error) {
      await this.bot.sendMessage(chatId, 
        `❌ Failed to start quick snipe: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 