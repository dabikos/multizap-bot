require('dotenv').config();

// Конфигурации сетей
const NETWORKS = {
  ETH: {
    name: 'Ethereum',
    chainId: 1,
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    routerAddress: process.env.ETH_ROUTER_ADDRESS || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
    factoryAddress: process.env.ETH_FACTORY_ADDRESS || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2 Factory
    explorerUrl: 'https://etherscan.io',
    nativeCurrency: 'ETH',
    gasPrice: process.env.ETH_GAS_PRICE || null, // null = auto
    gasLimit: process.env.ETH_GAS_LIMIT || '2000000',
    supportsEIP1559: true
  },
  BSC: {
    name: 'Binance Smart Chain',
    chainId: 56,
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
    routerAddress: process.env.BSC_ROUTER_ADDRESS || '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 Router
    factoryAddress: process.env.BSC_FACTORY_ADDRESS || '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', // PancakeSwap V2 Factory
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: 'BNB',
    gasPrice: process.env.BSC_GAS_PRICE || '5', // 5 gwei (будет преобразовано в wei)
    gasLimit: process.env.BSC_GAS_LIMIT || '2000000',
    supportsEIP1559: false
  },
  BASE: {
    name: 'Base',
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    routerAddress: process.env.BASE_ROUTER_ADDRESS || '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Uniswap V2 Router on Base
    factoryAddress: process.env.BASE_FACTORY_ADDRESS || '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', // Uniswap V2 Factory on Base (получен из Router.factory())
    explorerUrl: 'https://basescan.org',
    nativeCurrency: 'ETH',
    gasPrice: process.env.BASE_GAS_PRICE || null, // null = auto
    gasLimit: process.env.BASE_GAS_LIMIT || '2000000',
    supportsEIP1559: true
  }
};

module.exports = {
  // Telegram Bot Configuration
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8434817486:AAEPLlrWRR3EKbSbqan6vPaDWTi8NqmH0YQ',
  
  // Networks Configuration
  NETWORKS: NETWORKS,
  
  // Default Network (для обратной совместимости)
  DEFAULT_NETWORK: process.env.DEFAULT_NETWORK || 'BSC',
  
  // Legacy BSC Configuration (для обратной совместимости)
  RPC_URL: process.env.RPC_URL || NETWORKS.BSC.rpcUrl,
  CHAIN_ID: process.env.CHAIN_ID || NETWORKS.BSC.chainId,
  ROUTER_ADDRESS: process.env.ROUTER_ADDRESS || NETWORKS.BSC.routerAddress,
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || NETWORKS.BSC.factoryAddress,
  
  // Private Key (замените на ваш приватный ключ)
  PRIVATE_KEY: process.env.PRIVATE_KEY || 'your_private_key_here',
  
  // Gas Configuration (legacy, для обратной совместимости)
  GAS_PRICE: process.env.GAS_PRICE || '500000000', // 0.5 gwei
  GAS_LIMIT: process.env.GAS_LIMIT || '2000000',
  
  // Slippage Configuration
  DEFAULT_SLIPPAGE: process.env.DEFAULT_SLIPPAGE || '7', // 7% фиксированный
  MAX_SLIPPAGE: process.env.MAX_SLIPPAGE || '50', // 50% максимум
  MIN_SLIPPAGE: process.env.MIN_SLIPPAGE || '0.1', // 0.1% минимум
  
  // MultiZap Contract ABI Path
  MULTIZAP_ABI_PATH: '../artifacts/contracts/MultiZap.sol/MultiZap.json',
  
  // Helper function to get network config
  getNetworkConfig: (networkName) => {
    return NETWORKS[networkName.toUpperCase()] || NETWORKS[module.exports.DEFAULT_NETWORK];
  },
  
  // Helper function to get explorer URL
  getExplorerUrl: (networkName) => {
    const network = NETWORKS[networkName.toUpperCase()] || NETWORKS[module.exports.DEFAULT_NETWORK];
    return network.explorerUrl;
  }
};
