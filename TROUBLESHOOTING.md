# Troubleshooting Guide

This guide helps you resolve common issues with the Solana Flash Loan SDK and token monitoring service.

## Connection Issues

### "connection contains error" or Connection Test Fails

**Symptoms:**
- Error messages like "connection contains error, [object Object]"
- Connection test fails with timeout or error
- Token monitoring doesn't start

**Solutions:**

1. **Test your connection first:**
   ```bash
   npm run test:connection
   ```

2. **Use a reliable RPC provider:**
   The default Solana RPC endpoints have rate limits and may not support WebSocket connections reliably. Use one of these providers:

   **QuickNode (Recommended):**
   ```bash
   # In your .env file
   RPC_ENDPOINT=https://your-quicknode-endpoint.solana-mainnet.quiknode.pro/your-api-key/
   RPC_WEBSOCKET_ENDPOINT=wss://your-quicknode-endpoint.solana-mainnet.quiknode.pro/your-api-key/
   ```

   **Helius:**
   ```bash
   # In your .env file
   RPC_ENDPOINT=https://rpc.helius.xyz/?api-key=your-api-key
   RPC_WEBSOCKET_ENDPOINT=wss://rpc.helius.xyz/?api-key=your-api-key
   ```

   **Alchemy:**
   ```bash
   # In your .env file
   RPC_ENDPOINT=https://solana-mainnet.g.alchemy.com/v2/your-api-key
   RPC_WEBSOCKET_ENDPOINT=wss://solana-mainnet.g.alchemy.com/v2/your-api-key
   ```

3. **Check your .env file:**
   Make sure you have a `.env` file in the root directory with the correct configuration:
   ```bash
   cp env.example .env
   # Edit .env with your RPC endpoints
   ```

4. **Verify WebSocket support:**
   Your RPC provider must support WebSocket connections for real-time monitoring to work.

## API Server Issues

### Server won't start

**Symptoms:**
- "Port already in use" error
- Server fails to start

**Solutions:**

1. **Change the port:**
   ```bash
   # In your .env file
   PORT=3001
   ```

2. **Kill existing processes:**
   ```bash
   # Find processes using port 3000
   lsof -ti:3000
   # Kill them
   kill -9 $(lsof -ti:3000)
   ```

### Endpoints return 500 errors

**Symptoms:**
- API calls return "Internal Server Error"
- Error logs show connection issues

**Solutions:**

1. **Check server logs:**
   Look for detailed error messages in the console output.

2. **Verify RPC connection:**
   Run the connection test:
   ```bash
   npm run test:connection
   ```

3. **Check environment variables:**
   Ensure all required environment variables are set correctly.

## Token Monitoring Issues

### No new tokens detected

**Symptoms:**
- Monitoring starts successfully but no tokens are found
- No data in `src/data/new_solana_tokens.json`

**Solutions:**

1. **Check Raydium activity:**
   The service monitors the Raydium fee account. If there are no new token launches, no data will be generated.

2. **Verify monitoring is active:**
   ```bash
   curl http://localhost:3000/tokens/monitor/status
   ```

3. **Check error logs:**
   Look at `errorNewLpsLogs.txt` for any errors.

### Monitoring stops unexpectedly

**Symptoms:**
- Monitoring was working but suddenly stopped
- No error messages

**Solutions:**

1. **Restart monitoring:**
   ```bash
   curl -X POST http://localhost:3000/tokens/monitor/stop
   curl -X POST http://localhost:3000/tokens/monitor/start
   ```

2. **Check RPC connection:**
   Your RPC provider might have disconnected. Test the connection:
   ```bash
   npm run test:connection
   ```

3. **Check rate limits:**
   Some RPC providers have rate limits. Consider upgrading your plan.

## Bot Integration Issues

### Bot can't connect to API

**Symptoms:**
- Bot fails to start
- "Failed to connect" errors

**Solutions:**

1. **Check API server:**
   Make sure the API server is running:
   ```bash
   npm run api
   ```

2. **Verify API URL:**
   Check that `API_BASE_URL` in your bot configuration matches the server URL.

3. **Check firewall/network:**
   Ensure the bot can reach the API server on the correct port.

### Bot doesn't receive new token notifications

**Symptoms:**
- Bot is running but doesn't process new tokens
- No console output for new tokens

**Solutions:**

1. **Check polling interval:**
   The bot polls for new tokens. Make sure the polling is working:
   ```typescript
   // In your bot code
   client.pollForNewTokens(3000, (newTokens) => {
     console.log('New tokens found:', newTokens.length);
   });
   ```

2. **Verify callback function:**
   Make sure your callback function is properly defined and not throwing errors.

## Performance Issues

### High memory usage

**Symptoms:**
- Process uses excessive memory
- System becomes slow

**Solutions:**

1. **Limit data retention:**
   The service stores all detected tokens. Consider implementing data cleanup:
   ```typescript
   // Clean up old data periodically
   setInterval(() => {
     // Remove tokens older than 24 hours
   }, 24 * 60 * 60 * 1000);
   ```

2. **Optimize polling frequency:**
   Reduce polling frequency if you don't need real-time updates:
   ```typescript
   client.pollForNewTokens(10000); // Poll every 10 seconds instead of 3
   ```

### Slow response times

**Symptoms:**
- API calls take a long time
- Bot responses are delayed

**Solutions:**

1. **Use a faster RPC provider:**
   Premium RPC providers offer better performance.

2. **Optimize queries:**
   Use the `/tokens/new/recent` endpoint with limits instead of getting all tokens.

3. **Check network latency:**
   Use an RPC provider with servers closer to your location.

## Common Error Messages

### "Failed to connect to Solana RPC"
- Check your RPC endpoint URL
- Verify your internet connection
- Try a different RPC provider

### "Transaction parsing failed"
- This is normal for some transactions
- The service will continue monitoring other transactions

### "WebSocket test timeout"
- This is normal for some RPC providers
- The service will still work with HTTP-only connections

### "Rate limit exceeded"
- Upgrade your RPC provider plan
- Reduce polling frequency
- Use a different RPC provider

## Getting Help

If you're still experiencing issues:

1. **Check the logs:**
   - Console output for detailed error messages
   - `errorNewLpsLogs.txt` for error history

2. **Run diagnostics:**
   ```bash
   npm run test:connection
   ```

3. **Verify configuration:**
   - Check all environment variables
   - Ensure RPC endpoints are correct
   - Verify WebSocket support

4. **Try a different RPC provider:**
   - QuickNode, Helius, or Alchemy are recommended
   - Free tiers may have limitations

## Environment Variables Reference

```bash
# Required
RPC_ENDPOINT=https://your-rpc-endpoint
RPC_WEBSOCKET_ENDPOINT=wss://your-ws-endpoint

# Optional
PORT=3000
TELEGRAM_BOT_TOKEN=your_bot_token
AUTHORIZED_USER_IDS=123456,789012
API_BASE_URL=http://localhost:3000
``` 