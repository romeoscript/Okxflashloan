const axios = require('axios');

// Test configuration
const API_BASE_URL = 'http://localhost:3000';
const TEST_USER_ID = 12345;

async function testEmbeddedWalletSystem() {
    console.log('🎉 Testing Embedded Wallet System (Like Privy/Dynamic)\n');

    try {
        // 1. Test wallet creation
        console.log('1️⃣ Testing wallet creation...');
        const createResponse = await axios.post(`${API_BASE_URL}/wallet/create`, {
            userId: TEST_USER_ID
        });
        console.log('✅ Wallet created:', createResponse.data);

        // 2. Test wallet status
        console.log('\n2️⃣ Testing wallet status...');
        const statusResponse = await axios.get(`${API_BASE_URL}/wallet/status/${TEST_USER_ID}`);
        console.log('✅ Wallet status:', statusResponse.data);

        // 3. Test wallet balance
        console.log('\n3️⃣ Testing wallet balance...');
        const balanceResponse = await axios.get(`${API_BASE_URL}/wallet/balance/${TEST_USER_ID}`);
        console.log('✅ Wallet balance:', balanceResponse.data);

        // 4. Test flash quote with embedded wallet
        console.log('\n4️⃣ Testing flash quote with embedded wallet...');
        const quoteResponse = await axios.get(`${API_BASE_URL}/flashswap/quote`, {
            params: {
                targetTokenMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
                desiredTargetAmount: '1',
                slippageBps: 100,
                userId: TEST_USER_ID
            }
        });
        console.log('✅ Flash quote response:', quoteResponse.data);

        // 5. Test wallet backup
        console.log('\n5️⃣ Testing wallet backup...');
        const backupResponse = await axios.get(`${API_BASE_URL}/wallet/backup/${TEST_USER_ID}`);
        console.log('✅ Wallet backup:', backupResponse.data);

        console.log('\n🎉 All tests passed! Embedded wallet system is working like Privy/Dynamic!');

    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

// Run the test
testEmbeddedWalletSystem(); 