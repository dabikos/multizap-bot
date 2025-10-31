require('dotenv').config();

module.exports = {
  // Telegram Bot Configuration
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8434817486:AAEPLlrWRR3EKbSbqan6vPaDWTi8NqmH0YQ',
  
  // BSC Network Configuration
  RPC_URL: process.env.RPC_URL || 'https://bsc-dataseed1.binance.org',
  CHAIN_ID: process.env.CHAIN_ID || 56,
  ROUTER_ADDRESS: process.env.ROUTER_ADDRESS || '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || '0xcA143Ce0Fe65960E6Aa4D42C8D3cE161c2B6604f',
  
  // Private Key (замените на ваш приватный ключ)
  PRIVATE_KEY: process.env.PRIVATE_KEY || 'your_private_key_here',
  
  // Gas Configuration (BSC uses legacy gas)
  GAS_PRICE: process.env.GAS_PRICE || '500000000', // 0.5 gwei
  GAS_LIMIT: process.env.GAS_LIMIT || '2000000',
  
  // Slippage Configuration
  DEFAULT_SLIPPAGE: process.env.DEFAULT_SLIPPAGE || '7', // 7% фиксированный
  MAX_SLIPPAGE: process.env.MAX_SLIPPAGE || '50', // 50% максимум
  MIN_SLIPPAGE: process.env.MIN_SLIPPAGE || '0.1', // 0.1% минимум
  
  // MultiZap Contract ABI Path
  MULTIZAP_ABI_PATH: '../artifacts/contracts/MultiZap.sol/MultiZap.json'
};
