require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Set it in .env or server environment variables.`);
  }
  return value;
}

// Конфигурации сетей
function getAlchemyRpc(networkSubdomain) {
  if (process.env.ALCHEMY_API_KEY) {
    return `https://${networkSubdomain}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
  }

  const ethRpcUrl = process.env.ETH_RPC_URL || process.env.RPC_URL || '';
  const match = ethRpcUrl.match(/^https:\/\/eth-mainnet\.g\.alchemy\.com\/v2\/([^/?#]+)/i);
  return match ? `https://${networkSubdomain}.g.alchemy.com/v2/${match[1]}` : null;
}

const NETWORKS = {
  ETH: {
    name: 'Ethereum',
    chainId: 1,
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    routerAddress: process.env.ETH_ROUTER_ADDRESS || '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
    factoryAddress: process.env.ETH_FACTORY_ADDRESS || '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', // Uniswap V2 Factory
    usdtAddress: process.env.ETH_USDT_ADDRESS || '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT на Ethereum
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
    usdtAddress: process.env.BSC_USDT_ADDRESS || '0x55d398326f99059fF775485246999027B3197955', // USDT на BSC
    explorerUrl: 'https://bscscan.com',
    nativeCurrency: 'BNB',
    gasPrice: process.env.BSC_GAS_PRICE || '0.05', // 0.05 gwei (будет преобразовано в wei)
    gasLimit: process.env.BSC_GAS_LIMIT || '2000000',
    supportsEIP1559: false
  },
  BASE: {
    name: 'Base',
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    routerAddress: process.env.BASE_ROUTER_ADDRESS || '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24', // Uniswap V2 Router on Base
    factoryAddress: process.env.BASE_FACTORY_ADDRESS || '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6', // Uniswap V2 Factory on Base (получен из Router.factory())
    usdtAddress: process.env.BASE_USDT_ADDRESS || '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', // USDC на Base (используем как USDT аналог)
    explorerUrl: 'https://basescan.org',
    nativeCurrency: 'ETH',
    gasPrice: process.env.BASE_GAS_PRICE || null, // null = auto
    gasLimit: process.env.BASE_GAS_LIMIT || '2000000',
    supportsEIP1559: true
  },
  ROBINHOOD: {
    name: 'Robinhood Chain',
    chainId: 4663,
    rpcUrl: process.env.ROBINHOOD_RPC_URL || getAlchemyRpc('robinhood-mainnet') || 'https://robinhood-mainnet.g.alchemy.com/v2/your_api_key_here',
    routerAddress: process.env.ROBINHOOD_ROUTER_ADDRESS || '0x89e5DB8B5aA49aA85AC63f691524311AEB649eba',
    factoryAddress: process.env.ROBINHOOD_FACTORY_ADDRESS || '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f',
    usdtAddress: process.env.ROBINHOOD_USDT_ADDRESS || '0x0000000000000000000000000000000000000000',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
    nativeCurrency: 'ETH',
    gasPrice: process.env.ROBINHOOD_GAS_PRICE || null,
    gasLimit: process.env.ROBINHOOD_GAS_LIMIT || '2000000',
    supportsEIP1559: true
  },
  MONAD: {
    name: 'Monad',
    chainId: 143,
    rpcUrl: process.env.MONAD_RPC_URL || 'https://rpc-mainnet.monadinfra.com',
    routerAddress: process.env.MONAD_ROUTER_ADDRESS || '0x4B2ab38DBF28D31D467aA8993f6c2585981D6804', // Uniswap Router on Monad
    factoryAddress: process.env.MONAD_FACTORY_ADDRESS || '0x182a927119D56008d921126764bF884221b10f59', // Uniswap Factory on Monad
    usdtAddress: process.env.MONAD_USDT_ADDRESS || '0x0000000000000000000000000000000000000000', // Замените на реальный USDT адрес на Monad, если есть
    explorerUrl: 'https://monadscan.com',
    nativeCurrency: 'MON',
    gasPrice: process.env.MONAD_GAS_PRICE || '100', // 100 gwei (используется как maxFeePerGas для EIP-1559)
    gasLimit: process.env.MONAD_GAS_LIMIT || '2000000',
    supportsEIP1559: true
  },
  MEGAETH: {
    name: 'MegaETH',
    chainId: 4326,
    rpcUrl: process.env.MEGAETH_RPC_URL || 'https://mainnet.megaeth.com/rpc',
    routerAddress: process.env.MEGAETH_ROUTER_ADDRESS || '0xE5BbEF8De2DB447a7432A47EBa58924d94eE470e', // Kumbaya Router on MegaETH
    factoryAddress: process.env.MEGAETH_FACTORY_ADDRESS || '0x68b34591f662508076927803c567Cc8006988a09', // Kumbaya Factory on MegaETH
    usdtAddress: process.env.MEGAETH_USDT_ADDRESS || '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USDT0 на MegaETH
    explorerUrl: 'https://mega.etherscan.io',
    nativeCurrency: 'ETH',
    gasPrice: process.env.MEGAETH_GAS_PRICE || null, // null = auto
    gasLimit: process.env.MEGAETH_GAS_LIMIT || '2000000',
    supportsEIP1559: true
  }
};

module.exports = {
  // Telegram Bot Configuration
  TELEGRAM_BOT_TOKEN: requireEnv('TELEGRAM_BOT_TOKEN'),
  
  // Networks Configuration
  NETWORKS: NETWORKS,
  
  // Default Network (для обратной совместимости)
  DEFAULT_NETWORK: process.env.DEFAULT_NETWORK || 'ETH',
  
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
