import express from 'express';
import { LaunchDetector } from './sdk/launch_detector';
import { buildSimulatedFlashLoanInstructions } from './sdk/flash_swap';
import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { monitorNewTokens, NewTokenData } from './src/monitorNewTokens';
import { WalletManager } from './sdk/wallet_manager';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize Solana connection and LaunchDetector
const connection = new Connection(process.env.RPC_ENDPOINT || '', 'confirmed');
const detector = new LaunchDetector(connection);
const walletManager = new WalletManager(connection);

// Store new token monitoring state
let newTokenMonitorCleanup: (() => void) | null = null;
let isNewTokenMonitoring = false;

// --- Wallet Management Endpoints ---

// POST /wallet/connect
// Body: { userId: number, walletPublicKey: string, signature?: string, message?: string }
app.post('/wallet/connect', async (req, res) => {
  try {
    const { userId, walletPublicKey, signature, message } = req.body;
    
    if (!userId || !walletPublicKey) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }

    const success = await walletManager.verifyWalletConnection(
      userId,
      walletPublicKey,
      signature || '',
      message || walletManager.generateChallengeMessage(userId)
    );

    if (success) {
      res.json({ 
        status: 'connected',
        walletPublicKey,
        message: 'Wallet connected successfully'
      });
    } else {
      res.status(400).json({ error: 'Failed to verify wallet connection' });
    }
  } catch (err) {
    console.error('Wallet connection error:', err);
    res.status(500).json({ error: 'Failed to connect wallet', details: err instanceof Error ? err.message : err });
  }
});

// GET /wallet/status/:userId
app.get('/wallet/status/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const session = walletManager.getUserWallet(userId);
    
    if (session) {
      res.json({
        connected: true,
        walletPublicKey: session.walletPublicKey,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity
      });
    } else {
      res.json({ connected: false });
    }
  } catch (err) {
    console.error('Wallet status error:', err);
    res.status(500).json({ error: 'Failed to get wallet status' });
  }
});

// DELETE /wallet/disconnect/:userId
app.delete('/wallet/disconnect/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const success = walletManager.disconnectWallet(userId);
    
    if (success) {
      res.json({ status: 'disconnected', message: 'Wallet disconnected successfully' });
    } else {
      res.status(404).json({ error: 'No wallet connected for this user' });
    }
  } catch (err) {
    console.error('Wallet disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect wallet' });
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

    // Check if user has connected wallet
    const session = walletManager.getUserWallet(userId);
    if (!session) {
      res.status(400).json({ error: 'User wallet not connected' });
      return;
    }

    // Create a dummy wallet for transaction building
    const dummyWallet = { publicKey: new PublicKey(session.walletPublicKey) } as Wallet;
    
    const result = await buildSimulatedFlashLoanInstructions({
      targetTokenMint: new PublicKey(targetTokenMint),
      desiredTargetAmount,
      slippageBps,
      connection,
      wallet: dummyWallet
    });

    // Get the latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash('finalized');

    // Create the transaction for user to sign
    const transactionData = {
      transaction: result.transaction.serialize().toString('base64'),
      message: `Please sign this transaction to execute the flash loan.\n\nTransaction includes:\n- Flash loan from Solend\n- Token swap via Jupiter\n- Flash loan repayment\n\nThis transaction will be executed on your behalf using your connected wallet.`,
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

    // Check if user has connected wallet
    const session = walletManager.getUserWallet(userId);
    if (!session) {
      res.status(400).json({ error: 'User wallet not connected' });
      return;
    }

    // Deserialize the signed transaction
    const transactionBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuffer);

    // Execute the signed transaction
    const signature = await walletManager.executeSignedTransaction(userId, transaction);
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

// GET /flashswap/quote?targetTokenMint=...&desiredTargetAmount=...&slippageBps=...&walletPublicKey=...
app.get('/flashswap/quote', async (req, res) => {
  try {
    const { targetTokenMint, desiredTargetAmount, slippageBps = 100, walletPublicKey } = req.query;
    if (!targetTokenMint || !desiredTargetAmount || !walletPublicKey) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }
    const dummyWallet = { publicKey: new PublicKey(walletPublicKey as string) } as Wallet;
    const result = await buildSimulatedFlashLoanInstructions({
      targetTokenMint: new PublicKey(targetTokenMint as string),
      desiredTargetAmount: desiredTargetAmount as string,
      slippageBps: Number(slippageBps),
      connection,
      wallet: dummyWallet
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    connectedUsers: walletManager.getConnectedUsers().length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Connected users: ${walletManager.getConnectedUsers().length}`);
});

export { app, walletManager }; 