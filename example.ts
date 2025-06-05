
import { PublicKey, Connection } from "@solana/web3.js"
import { buildSimulatedFlashLoanInstructions } from "./sdk/flash_swap"
import { createWallet } from '@okx-dex/okx-dex-sdk/dist/core/wallet';
import { SOLANA_PRIVATE_KEY, SOLANA_RPC_URL } from "./sdk/const";

async function main() {
    const connection = new Connection(SOLANA_RPC_URL!)

    const wallet = createWallet(SOLANA_PRIVATE_KEY!, connection);
    const targetTokenMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    const desiredTargetAmount = "100000000"
    // the function making use of the borrowed amount, as an instruction should be added
    const tx = await buildSimulatedFlashLoanInstructions({targetTokenMint, desiredTargetAmount, connection, wallet})
    const result = await connection.simulateTransaction(tx)
    console.log(result)
}

main()