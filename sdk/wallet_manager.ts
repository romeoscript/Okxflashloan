import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';

// User wallet session interface
export interface UserWalletSession {
  userId: number;
  walletPublicKey: string;
  connectedAt: Date;
  lastActivity: Date;
}

// Wallet connection request interface
export interface WalletConnectionRequest {
  userId: number;
  walletPublicKey: string;
  signature: string;
  message: string;
  timestamp: number;
}

export class WalletManager {
  private userSessions: Map<number, UserWalletSession> = new Map();
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Generate a challenge message for wallet connection
   */
  generateChallengeMessage(userId: number): string {
    const timestamp = Date.now();
    const message = `Connect wallet to Flash Arbitrage Bot\n\nUser ID: ${userId}\nTimestamp: ${timestamp}\n\nSign this message to connect your wallet.`;
    return message;
  }

  /**
   * Verify wallet connection signature
   */
  async verifyWalletConnection(
    userId: number,
    walletPublicKey: string,
    signature: string,
    message: string
  ): Promise<boolean> {
    try {
      // Verify the signature
      const publicKey = new PublicKey(walletPublicKey);
      const messageBytes = new TextEncoder().encode(message);
      
      // For now, we'll accept the connection if the public key is valid
      // In production, you should verify the signature cryptographically
      const isValidPublicKey = PublicKey.isOnCurve(publicKey.toBytes());
      
      if (isValidPublicKey) {
        // Store the user session
        this.userSessions.set(userId, {
          userId,
          walletPublicKey,
          connectedAt: new Date(),
          lastActivity: new Date()
        });
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error verifying wallet connection:', error);
      return false;
    }
  }

  /**
   * Get user's connected wallet
   */
  getUserWallet(userId: number): UserWalletSession | null {
    const session = this.userSessions.get(userId);
    if (session) {
      session.lastActivity = new Date();
      return session;
    }
    return null;
  }

  /**
   * Check if user has connected wallet
   */
  isWalletConnected(userId: number): boolean {
    return this.userSessions.has(userId);
  }

  /**
   * Disconnect user's wallet
   */
  disconnectWallet(userId: number): boolean {
    return this.userSessions.delete(userId);
  }

  /**
   * Get all connected users
   */
  getConnectedUsers(): UserWalletSession[] {
    return Array.from(this.userSessions.values());
  }

  /**
   * Create a transaction for user to sign
   */
  createTransactionForUser(
    userId: number,
    instructions: any[],
    recentBlockhash: string
  ): { transaction: VersionedTransaction; message: string } | null {
    const session = this.getUserWallet(userId);
    if (!session) {
      return null;
    }

    try {
      const publicKey = new PublicKey(session.walletPublicKey);
      
      // Create transaction message
      const { TransactionMessage } = require('@solana/web3.js');
      const messageV0 = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash,
        instructions
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      
      // Create a message for the user to sign
      const message = `Please sign this transaction to execute the flash loan.\n\nTransaction includes:\n- Flash loan from Solend\n- Token swap via Jupiter\n- Flash loan repayment\n\nThis transaction will be executed on your behalf using your connected wallet.`;
      
      return { transaction, message };
    } catch (error) {
      console.error('Error creating transaction for user:', error);
      return null;
    }
  }

  /**
   * Execute signed transaction
   */
  async executeSignedTransaction(
    userId: number,
    signedTransaction: VersionedTransaction
  ): Promise<string> {
    const session = this.getUserWallet(userId);
    if (!session) {
      throw new Error('User wallet not connected');
    }

    try {
      // Send the signed transaction
      const signature = await this.connection.sendTransaction(signedTransaction, {
        skipPreflight: false
      });
      
      return signature;
    } catch (error) {
      console.error('Error executing signed transaction:', error);
      throw error;
    }
  }

  /**
   * Clean up old sessions (optional)
   */
  cleanupOldSessions(maxAgeHours: number = 24): void {
    const now = new Date();
    const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
    
    for (const [userId, session] of this.userSessions.entries()) {
      if (now.getTime() - session.lastActivity.getTime() > maxAge) {
        this.userSessions.delete(userId);
      }
    }
  }
} 