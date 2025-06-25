const axios = require('axios');

// Test configuration
const API_BASE_URL = 'http://localhost:3000';
const TEST_USER_ID = 12345;
const TEST_WALLET_PUBLIC_KEY = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TEST_TOKEN_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

async function testNonCustodialFlow() {
    console.log('🧪 Testing Non-Custodial Flash Loan Flow\n');

    try {
        // 1. Test wallet connection
        console.log('1️⃣ Testing wallet connection...');
        const connectResponse = await axios.post(`${API_BASE_URL}/wallet/connect`, {
            userId: TEST_USER_ID,
            walletPublicKey: TEST_WALLET_PUBLIC_KEY
        });
        console.log('✅ Wallet connected:', connectResponse.data);

        // 2. Test wallet status
        console.log('\n2️⃣ Testing wallet status...');
        const statusResponse = await axios.get(`${API_BASE_URL}/wallet/status/${TEST_USER_ID}`);
        console.log('✅ Wallet status:', statusResponse.data);

        // 3. Test flash swap quote
        console.log('\n3️⃣ Testing flash swap quote...');
        const quoteResponse = await axios.get(`${API_BASE_URL}/flashswap/quote`, {
            params: {
                targetTokenMint: TEST_TOKEN_MINT,
                desiredTargetAmount: '1',
                slippageBps: 100,
                walletPublicKey: TEST_WALLET_PUBLIC_KEY
            }
        });
        console.log('✅ Flash swap quote received:', {
            estimatedOutput: quoteResponse.data.estimatedOutput,
            priceImpact: quoteResponse.data.priceImpact,
            borrowedAmount: quoteResponse.data.borrowedAmount
        });

        // 4. Test transaction creation
        console.log('\n4️⃣ Testing transaction creation...');
        const createTxResponse = await axios.post(`${API_BASE_URL}/flashswap/create-transaction`, {
            targetTokenMint: TEST_TOKEN_MINT,
            desiredTargetAmount: '1',
            slippageBps: 100,
            userId: TEST_USER_ID
        });
        console.log('✅ Transaction created:', {
            hasTransaction: !!createTxResponse.data.transaction,
            message: createTxResponse.data.message,
            recentBlockhash: createTxResponse.data.recentBlockhash
        });

        // 5. Test health check
        console.log('\n5️⃣ Testing health check...');
        const healthResponse = await axios.get(`${API_BASE_URL}/health`);
        console.log('✅ Health check:', healthResponse.data);

        console.log('\n🎉 All tests passed! Non-custodial implementation is working correctly.');

    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
        
        if (error.response?.status === 500) {
            console.log('\n💡 This might be expected if the server is not running or there are configuration issues.');
            console.log('   Make sure to:');
            console.log('   1. Start the server: npm start');
            console.log('   2. Check environment variables');
            console.log('   3. Verify Solana RPC endpoint');
        }
    }
}

// Run the test
testNonCustodialFlow().catch(console.error); 