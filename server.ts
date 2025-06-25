import express from 'express';
import { LaunchDetector } from './sdk/launch_detector';
import { buildSimulatedFlashLoanInstructions } from './sdk/flash_swap';
import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { monitorNewTokens, NewTokenData } from './src/monitorNewTokens';
import { EmbeddedWalletManager } from './sdk/embedded_wallet_manager';
import { DatabaseManager } from './sdk/database_manager';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Solana connection and LaunchDetector
const connection = new Connection(process.env.RPC_ENDPOINT || '', 'confirmed');
const detector = new LaunchDetector(connection);

// Initialize database and wallet manager
const database = new DatabaseManager();
const walletManager = new EmbeddedWalletManager(connection, database);

// Store new token monitoring state
let newTokenMonitorCleanup: (() => void) | null = null;
let isNewTokenMonitoring = false;

// --- Embedded Wallet Management Endpoints ---

// POST /wallet/create
// Body: { userId: number }
app.post('/wallet/create', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    const result = await walletManager.generateWalletForUser(userId);
    
    res.json({ 
      status: 'created',
      publicKey: result.publicKey,
      message: result.message
    });
  } catch (err) {
    console.error('Wallet creation error:', err);
    res.status(500).json({ error: 'Failed to create wallet', details: err instanceof Error ? err.message : err });
  }
});

// GET /wallet/status/:userId
app.get('/wallet/status/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const walletInfo = await walletManager.getWalletInfo(userId);
    
    if (walletInfo) {
      res.json({
        hasWallet: true,
        publicKey: walletInfo.publicKey,
        connectedAt: walletInfo.connectedAt
      });
    } else {
      res.json({ hasWallet: false });
    }
  } catch (err) {
    console.error('Wallet status error:', err);
    res.status(500).json({ error: 'Failed to get wallet status' });
  }
});

// GET /wallet/balance/:userId
app.get('/wallet/balance/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const balance = await walletManager.getWalletBalance(userId);
    
    res.json({
      balance: balance,
      balanceSOL: balance.toFixed(4)
    });
  } catch (err) {
    console.error('Wallet balance error:', err);
    res.status(500).json({ error: 'Failed to get wallet balance' });
  }
});

// GET /wallet/backup/:userId
app.get('/wallet/backup/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const mnemonic = await walletManager.backupWallet(userId);
    
    if (mnemonic) {
      res.json({
        mnemonic,
        message: 'Keep this seed phrase safe - it\'s your wallet backup!'
      });
    } else {
      res.status(404).json({ error: 'No wallet found to backup' });
    }
  } catch (err) {
    console.error('Wallet backup error:', err);
    res.status(500).json({ error: 'Failed to backup wallet' });
  }
});

// GET /wallet/export/:userId
app.get('/wallet/export/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const exportData = await walletManager.exportWallet(userId);
    
    if (exportData) {
      res.json({
        publicKey: exportData.publicKey,
        privateKey: exportData.privateKey,
        mnemonic: exportData.mnemonic,
        message: 'Wallet exported successfully - keep your private key and seed phrase secure!'
      });
    } else {
      res.status(404).json({ error: 'No wallet found to export' });
    }
  } catch (err) {
    console.error('Wallet export error:', err);
    res.status(500).json({ error: 'Failed to export wallet' });
  }
});

// DELETE /wallet/delete/:userId
app.delete('/wallet/delete/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const success = await walletManager.deleteWallet(userId);
    
    if (success) {
      res.json({ status: 'deleted', message: 'Wallet deleted successfully' });
    } else {
      res.status(404).json({ error: 'No wallet found to delete' });
    }
  } catch (err) {
    console.error('Wallet delete error:', err);
    res.status(500).json({ error: 'Failed to delete wallet' });
  }
});

// --- LaunchDetector Endpoints ---

// Get all active launches
app.get('/launches/active', (req, res) => {
  try {
    res.json(detector.getActiveLaunches());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active launches' });
  }
});

// Start monitoring for new launches
app.post('/launches/start', async (req, res) => {
  try {
    await detector.startMonitoring();
    res.json({ status: 'started' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start monitoring' });
  }
});

// Stop monitoring for launches
app.post('/launches/stop', async (req, res) => {
  try {
    await detector.stopMonitoring();
    res.json({ status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to stop monitoring' });
  }
});

// Get all active positions
app.get('/positions', (req, res) => {
  try {
    res.json(detector.getActivePositions());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// --- FlashSwap Endpoints (Non-Custodial) ---

// POST /flashswap/create-transaction
// Body: { targetTokenMint: string, desiredTargetAmount: string, slippageBps?: number, userId: number }
app.post('/flashswap/create-transaction', async (req, res) => {
  try {
    const { targetTokenMint, desiredTargetAmount, slippageBps = 100, userId } = req.body;
    
    if (!targetTokenMint || !desiredTargetAmount || !userId) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Check if user has a wallet
    const walletInfo = walletManager.getWalletInfo(userId);
    if (!walletInfo) {
      res.status(400).json({ error: 'User wallet not found' });
      return;
    }

    // Get user's Anchor wallet
    const userWallet = await walletManager.getUserAnchorWallet(userId);
    if (!userWallet) {
      res.status(400).json({ error: 'User wallet not found' });
      return;
    }
    
    const result = await buildSimulatedFlashLoanInstructions({
      targetTokenMint: new PublicKey(targetTokenMint),
      desiredTargetAmount,
      slippageBps,
      connection,
      wallet: userWallet
    });

    // Get the latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash('finalized');

    // Create the transaction for user to sign
    const transactionData = {
      transaction: Buffer.from(result.transaction.serialize()).toString('base64'),
      message: `Your embedded wallet will sign this transaction automatically.\n\nTransaction includes:\n- Flash loan from Solend\n- Token swap via Jupiter\n- Flash loan repayment\n\nThis transaction will be signed and executed automatically.`,
      recentBlockhash: latestBlockhash.blockhash,
      quote: result.quote,
      estimatedOutput: result.estimatedOutput,
      priceImpact: result.priceImpact,
      route: result.route,
      borrowedAmount: result.borrowedAmount,
      addresses: result.addresses
    };

    res.json(transactionData);
  } catch (err) {
    console.error('FlashSwap create transaction error:', err);
    res.status(500).json({ error: 'Failed to create flash swap transaction', details: err instanceof Error ? err.message : err });
  }
});

// POST /flashswap/execute-signed
// Body: { userId: number, signedTransaction: string }
app.post('/flashswap/execute-signed', async (req, res) => {
  try {
    const { userId, signedTransaction } = req.body;
    
    if (!userId || !signedTransaction) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Check if user has a wallet
    const walletInfo = walletManager.getWalletInfo(userId);
    if (!walletInfo) {
      res.status(400).json({ error: 'User wallet not found' });
      return;
    }

    // Deserialize the signed transaction
    const transactionBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuffer);

    // Execute the signed transaction
    const signature = await walletManager.executeTransactionWithUserWallet(userId, transaction);
    const explorerUrl = `https://solscan.io/tx/${signature}`;

    res.json({
      signature,
      explorerUrl,
      message: 'Flash swap executed successfully'
    });
  } catch (err) {
    console.error('FlashSwap execute signed error:', err);
    res.status(500).json({ error: 'Failed to execute signed transaction', details: err instanceof Error ? err.message : err });
  }
});

// GET /flashswap/quote?targetTokenMint=...&desiredTargetAmount=...&slippageBps=...&userId=...
app.get('/flashswap/quote', async (req, res) => {
  try {
    const { targetTokenMint, desiredTargetAmount, slippageBps = 100, userId } = req.query;
    if (!targetTokenMint || !desiredTargetAmount || !userId) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    // Get user's Anchor wallet
    const userWallet = await walletManager.getUserAnchorWallet(parseInt(userId as string));
    if (!userWallet) {
      res.status(400).json({ error: 'User wallet not found' });
      return;
    }

    const result = await buildSimulatedFlashLoanInstructions({
      targetTokenMint: new PublicKey(targetTokenMint as string),
      desiredTargetAmount: desiredTargetAmount as string,
      slippageBps: Number(slippageBps),
      connection,
      wallet: userWallet
    });
    res.json({
      quote: result.quote,
      estimatedOutput: result.estimatedOutput,
      priceImpact: result.priceImpact,
      route: result.route,
      borrowedAmount: result.borrowedAmount,
      addresses: result.addresses
    });
  } catch (err) {
    console.error('FlashSwap quote error:', err);
    res.status(500).json({ error: 'Failed to get flash swap quote', details: err instanceof Error ? err.message : err });
  }
});

// --- New Token Monitoring Endpoints ---

// Start monitoring for new tokens
app.post('/tokens/monitor/start', async (req, res) => {
  try {
    if (isNewTokenMonitoring) {
      res.status(400).json({ error: 'New token monitoring is already running' });
      return;
    }

    newTokenMonitorCleanup = await monitorNewTokens(connection);
    isNewTokenMonitoring = true;

    res.json({ 
      status: 'started', 
      message: 'New token monitoring has been started successfully' 
    });
  } catch (err) {
    console.error('New token monitoring start error:', err);
    res.status(500).json({ 
      error: 'Failed to start new token monitoring', 
      details: err instanceof Error ? err.message : err 
    });
  }
});

// Stop monitoring for new tokens
app.post('/tokens/monitor/stop', async (req, res) => {
  try {
    if (!isNewTokenMonitoring) {
      res.status(400).json({ error: 'New token monitoring is not running' });
      return;
    }

    if (newTokenMonitorCleanup) {
      newTokenMonitorCleanup();
      newTokenMonitorCleanup = null;
    }
    isNewTokenMonitoring = false;

    res.json({ 
      status: 'stopped', 
      message: 'New token monitoring has been stopped successfully' 
    });
  } catch (err) {
    console.error('New token monitoring stop error:', err);
    res.status(500).json({ 
      error: 'Failed to stop new token monitoring', 
      details: err instanceof Error ? err.message : err 
    });
  }
});

// Get monitoring status
app.get('/tokens/monitor/status', (req, res) => {
  res.json({ 
    isMonitoring: isNewTokenMonitoring,
    message: isNewTokenMonitoring ? 'New token monitoring is active' : 'New token monitoring is not running'
  });
});

// Get all new tokens data
app.get('/tokens/new', (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'src', 'data', 'new_solana_tokens.json');
    
    if (!fs.existsSync(dataPath)) {
      res.json({ tokens: [] });
      return;
    }

    const data = fs.readFileSync(dataPath, 'utf8');
    const tokens = JSON.parse(data);
    
    res.json({ 
      tokens: Array.isArray(tokens) ? tokens : [tokens],
      count: Array.isArray(tokens) ? tokens.length : 1
    });
  } catch (err) {
    console.error('Error reading new tokens data:', err);
    res.status(500).json({ 
      error: 'Failed to read new tokens data', 
      details: err instanceof Error ? err.message : err 
    });
  }
});

// Get recent new tokens (with optional limit)
app.get('/tokens/new/recent', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const dataPath = path.join(__dirname, 'src', 'data', 'new_solana_tokens.json');
    
    if (!fs.existsSync(dataPath)) {
      res.json({ tokens: [] });
      return;
    }

    const data = fs.readFileSync(dataPath, 'utf8');
    const tokens = JSON.parse(data);
    const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
    
    // Sort by timestamp (newest first) and limit results
    const sortedTokens = tokenArray
      .sort((a: NewTokenData, b: NewTokenData) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, Number(limit));
    
    res.json({ 
      tokens: sortedTokens,
      count: sortedTokens.length,
      total: tokenArray.length
    });
  } catch (err) {
    console.error('Error reading recent new tokens:', err);
    res.status(500).json({ 
      error: 'Failed to read recent new tokens', 
      details: err instanceof Error ? err.message : err 
    });
  }
});

// --- Health Check ---
app.get('/health', async (req, res) => {
  const wallets = await walletManager.getAllWallets();
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    connectedUsers: wallets.length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  const wallets = await walletManager.getAllWallets();
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Connected users: ${wallets.length}`);
});

export { app, walletManager }; 