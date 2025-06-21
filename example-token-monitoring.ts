/**
 * Example: How to consume the new token monitoring endpoints
 * 
 * This file demonstrates how to interact with the new token monitoring API
 * from your bot or any other client application.
 */

import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

class TokenMonitoringClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Start monitoring for new tokens
   */
  async startMonitoring(): Promise<{ status: string; message: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tokens/monitor/start`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to start monitoring: ${error}`);
    }
  }

  /**
   * Stop monitoring for new tokens
   */
  async stopMonitoring(): Promise<{ status: string; message: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tokens/monitor/stop`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to stop monitoring: ${error}`);
    }
  }

  /**
   * Get monitoring status
   */
  async getMonitoringStatus(): Promise<{ isMonitoring: boolean; message: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/tokens/monitor/status`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get monitoring status: ${error}`);
    }
  }

  /**
   * Get all new tokens data
   */
  async getAllNewTokens(): Promise<{ tokens: any[]; count: number }> {
    try {
      const response = await axios.get(`${this.baseUrl}/tokens/new`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get new tokens: ${error}`);
    }
  }

  /**
   * Get recent new tokens with optional limit
   */
  async getRecentNewTokens(limit: number = 10): Promise<{ tokens: any[]; count: number; total: number }> {
    try {
      const response = await axios.get(`${this.baseUrl}/tokens/new/recent?limit=${limit}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get recent new tokens: ${error}`);
    }
  }

  /**
   * Poll for new tokens (useful for bot integration)
   */
  async pollForNewTokens(intervalMs: number = 5000, callback?: (tokens: any[]) => void): Promise<void> {
    let lastTokenCount = 0;

    const poll = async () => {
      try {
        const { tokens, count } = await this.getAllNewTokens();
        
        if (count > lastTokenCount) {
          const newTokens = tokens.slice(lastTokenCount);
          console.log(`Found ${newTokens.length} new tokens!`);
          
          if (callback) {
            callback(newTokens);
          } else {
            // Default handling - log new tokens
            newTokens.forEach((token, index) => {
              console.log(`New Token ${index + 1}:`);
              console.log(`  Signature: ${token.lpSignature}`);
              console.log(`  Creator: ${token.creator}`);
              console.log(`  Base Token: ${token.baseInfo.baseAddress}`);
              console.log(`  Base Amount: ${token.baseInfo.baseLpAmount}`);
              console.log(`  Quote Token: ${token.quoteInfo.quoteAddress}`);
              console.log(`  Quote Amount: ${token.quoteInfo.quoteLpAmount}`);
              console.log(`  Timestamp: ${token.timestamp}`);
              console.log('---');
            });
          }
          
          lastTokenCount = count;
        }
      } catch (error) {
        console.error('Error polling for new tokens:', error);
      }
    };

    // Initial poll
    await poll();
    
    // Set up interval
    setInterval(poll, intervalMs);
  }
}

// Example usage
async function exampleUsage() {
  const client = new TokenMonitoringClient();

  try {
    // Check if monitoring is running
    const status = await client.getMonitoringStatus();
    console.log('Monitoring status:', status);

    // Start monitoring if not already running
    if (!status.isMonitoring) {
      const startResult = await client.startMonitoring();
      console.log('Started monitoring:', startResult);
    }

    // Get recent tokens
    const recentTokens = await client.getRecentNewTokens(5);
    console.log('Recent tokens:', recentTokens);

    // Set up polling for new tokens
    client.pollForNewTokens(3000, (newTokens) => {
      console.log('🚨 NEW TOKENS DETECTED! 🚨');
      newTokens.forEach(token => {
        console.log(`New token: ${token.baseInfo.baseAddress} by ${token.creator}`);
        // Here you can add your bot logic to process new tokens
        // For example: analyze liquidity, check for arbitrage opportunities, etc.
      });
    });

  } catch (error) {
    console.error('Error in example usage:', error);
  }
}

// Example of how to integrate with your bot
class BotTokenIntegration {
  private tokenClient: TokenMonitoringClient;

  constructor() {
    this.tokenClient = new TokenMonitoringClient();
  }

  async initialize() {
    try {
      // Start token monitoring
      await this.tokenClient.startMonitoring();
      console.log('Token monitoring started for bot');

      // Set up token detection handler
      this.tokenClient.pollForNewTokens(2000, this.handleNewToken.bind(this));
    } catch (error) {
      console.error('Failed to initialize token monitoring:', error);
    }
  }

  private async handleNewToken(newTokens: any[]) {
    for (const token of newTokens) {
      try {
        // Your bot logic here
        await this.analyzeToken(token);
        await this.checkArbitrageOpportunity(token);
        await this.executeStrategy(token);
      } catch (error) {
        console.error(`Error processing token ${token.baseInfo.baseAddress}:`, error);
      }
    }
  }

  private async analyzeToken(token: any) {
    // Analyze token characteristics
    console.log(`Analyzing token: ${token.baseInfo.baseAddress}`);
    // Add your analysis logic here
  }

  private async checkArbitrageOpportunity(token: any) {
    // Check for arbitrage opportunities
    console.log(`Checking arbitrage for: ${token.baseInfo.baseAddress}`);
    // Add your arbitrage detection logic here
  }

  private async executeStrategy(token: any) {
    // Execute your trading strategy
    console.log(`Executing strategy for: ${token.baseInfo.baseAddress}`);
    // Add your strategy execution logic here
  }
}

// Export for use in other files
export { TokenMonitoringClient, BotTokenIntegration };

// Run example if this file is executed directly
if (require.main === module) {
  exampleUsage();
} 