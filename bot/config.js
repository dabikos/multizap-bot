require('dotenv').config();

module.exports = {
  // Telegram Bot Configuration
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8434817486:AAEPLlrWRR3EKbSbqan6vPaDWTi8NqmH0YQ',
  
  // Ethereum Network Configuration
  RPC_URL: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/x3twrYyq0NHf4x7oZSKKcQl9ehTwS4l9',
  CHAIN_ID: process.env.CHAIN_ID || 1,
  ROUTER_ADDRESS: process.env.ROUTER_ADDRESS || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
  
  // Private Key (замените на ваш приватный ключ)
  PRIVATE_KEY: process.env.PRIVATE_KEY || 'your_private_key_here',
  
  // Gas Configuration (EIP-1559)
  MAX_FEE_PER_GAS: process.env.MAX_FEE_PER_GAS || '50000000000', // 50 gwei
  MAX_PRIORITY_FEE_PER_GAS: process.env.MAX_PRIORITY_FEE_PER_GAS || '2000000000', // 2 gwei
  GAS_LIMIT: process.env.GAS_LIMIT || '500000',
  
  // Slippage Configuration
  DEFAULT_SLIPPAGE: process.env.DEFAULT_SLIPPAGE || '7', // 7% фиксированный
  MAX_SLIPPAGE: process.env.MAX_SLIPPAGE || '50', // 50% максимум
  MIN_SLIPPAGE: process.env.MIN_SLIPPAGE || '0.1', // 0.1% минимум
  
  // MultiZap Contract ABI Path
  MULTIZAP_ABI_PATH: '../artifacts/contracts/MultiZap.sol/MultiZap.json'
};
