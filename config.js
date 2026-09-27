// Seeded Geometries — mint page configuration.
//
// This file is the ONLY place that needs editing when the contract is
// deployed to mainnet: replace CONTRACT_ADDRESS with the deployed address
// and confirm CHAIN_ID / EXPLORER_TX_BASE match the target network.

const CONFIG = {
  // Mainnet deployment (2026-09-23).
  // Local Anvil rehearsal address (do not ship): 0x6E34E0A4530CcA761F98AeDFBE5E2bF7999397bC
  CONTRACT_ADDRESS: "0xf8b604cc9108bad6cc306b0a9f207cfb477562a7",

  // Ethereum mainnet
  CHAIN_ID: "0x1",
  CHAIN_NAME: "Ethereum mainnet",
  EXPLORER_TX_BASE: "https://etherscan.io/tx/",
  EXPLORER_ADDRESS_BASE: "https://etherscan.io/address/",

  // Sale parameters (must match the deployed contract)
  MAX_SUPPLY: 150,
  MINT_PRICE_WEI_HEX: "0x38d7ea4c68000", // 0.001 ETH, exact — the contract reverts over/underpayment
  MINT_PRICE_ETH: "0.001",

  ROYALTY_BPS: 1000, // 10%
  ROYALTY_RECEIVER_ENS: "coattails.eth",

  // 4-byte selectors of the contract functions the page calls.
  // Verified against the compiled artifact with `cast sig`.
  SELECTORS: {
    mint: "0x1249c58b",
    totalSupply: "0x18160ddd",
    mintPrice: "0x6817c76c",
    saleActive: "0x68428a1b",
    maxSupply: "0x32cb6b0c",
  },
};
