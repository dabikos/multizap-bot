const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getPrivateKeyInteractive } = require('./util-session');

// Конфигурация - ИЗМЕНИТЕ НА СВОИ ЗНАЧЕНИЯ
const CONFIG = {
  // Адреса
  token: '0x...', // Адрес токена
  lpPair: '0x...', // Адрес LP пары (для чтения цены)
  zapAddress: '0x...', // Адрес развернутого Zap контракта
  router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // UniswapV2 Router
  
  // Пороги для торговли
  buyPrice: '0.0001', // Покупать когда цена <= X ETH
  sellPrice: '0.0002', // Продавать когда цена >= Y ETH
  buyAmount: '0.01', // Сколько ETH тратить на покупку
  
  // Настройки мониторинга
  checkInterval: 5000, // Интервал проверки в мс (5 сек)
  maxGasPrice: '50', // Максимальная цена газа в gwei
};

const RPC_URL = 'https://eth-mainnet.g.alchemy.com/v2/x3twrYyq0NHf4x7oZSKKcQl9ehTwS4l9';

// ABI для UniswapV2Pair
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

// ABI для Zap контракта
function getZapABI() {
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'Zap.sol', 'Zap.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
}

function getTokenPriceInETH(reserve0, reserve1, token0, token1, tokenAddress) {
  // WETH адрес на mainnet
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  
  let tokenReserve, ethReserve;
  
  if (token0.toLowerCase() === tokenAddress.toLowerCase()) {
    tokenReserve = reserve0;
    ethReserve = reserve1;
  } else if (token1.toLowerCase() === tokenAddress.toLowerCase()) {
    tokenReserve = reserve1;
    ethReserve = reserve0;
  } else {
    throw new Error('Токен не найден в паре');
  }
  
  // Цена токена в ETH = ETH резерв / токен резерв
  return Number(ethReserve) / Number(tokenReserve);
}

async function getCurrentPrice(provider, pairAddress, tokenAddress) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  
  const [reserves, token0, token1] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
    pair.token1()
  ]);
  
  return getTokenPriceInETH(reserves[0], reserves[1], token0, token1, tokenAddress);
}

async function executeZapIn(wallet, zapAddress, amountETH) {
  const zap = new ethers.Contract(zapAddress, getZapABI(), wallet);
  
  const amountWei = ethers.parseEther(amountETH);
  const amountOutMinToken = 0n;
  const amountTokenMin = 0n;
  const amountETHMin = 0n;
  
  const tx = await zap.zapIn(
    amountOutMinToken,
    amountTokenMin,
    amountETHMin,
    { value: amountWei }
  );
  
  console.log('Транзакция zapIn отправлена:', tx.hash);
  await tx.wait();
  console.log('УСПЕШНО: zap-in выполнен');
}

async function executeExit(wallet, zapAddress) {
  const zap = new ethers.Contract(zapAddress, getZapABI(), wallet);
  
  const amountTokenMin = 0n;
  const amountETHMin = 0n;
  const amountOutMinETH = 0n;
  
  const tx = await zap.exitAndSell(
    amountTokenMin,
    amountETHMin,
    amountOutMinETH
  );
  
  console.log('Транзакция exitAndSell отправлена:', tx.hash);
  await tx.wait();
  console.log('УСПЕШНО: выход и продажа выполнены');
}

async function checkGasPrice(provider) {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));
  
  if (gasPriceGwei > parseFloat(CONFIG.maxGasPrice)) {
    console.log(`⚠️  Высокая цена газа: ${gasPriceGwei.toFixed(2)} gwei (лимит: ${CONFIG.maxGasPrice} gwei)`);
    return false;
  }
  return true;
}

async function main() {
  console.log('🚀 Запуск мониторинга цены токена...');
  console.log('📊 Конфигурация:');
  console.log(`   Токен: ${CONFIG.token}`);
  console.log(`   LP пара: ${CONFIG.lpPair}`);
  console.log(`   Zap контракт: ${CONFIG.zapAddress}`);
  console.log(`   Покупка при цене <= ${CONFIG.buyPrice} ETH`);
  console.log(`   Продажа при цене >= ${CONFIG.sellPrice} ETH`);
  console.log(`   Сумма покупки: ${CONFIG.buyAmount} ETH`);
  console.log(`   Интервал проверки: ${CONFIG.checkInterval}мс`);
  console.log('');
  
  // Проверяем конфигурацию
  if (CONFIG.token === '0x...' || CONFIG.lpPair === '0x...' || CONFIG.zapAddress === '0x...') {
    console.error('❌ Ошибка: Необходимо указать реальные адреса в CONFIG');
    process.exit(1);
  }
  
  const privateKey = await getPrivateKeyInteractive();
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log(`👤 Кошелек: ${wallet.address}`);
  console.log('⏰ Начинаю мониторинг...\n');
  
  let lastAction = null;
  const cooldown = 15000; // 15 сек между действиями
  
  while (true) {
    try {
      const currentPrice = await getCurrentPrice(provider, CONFIG.lpPair, CONFIG.token);
      const now = Date.now();
      
      console.log(`💰 Текущая цена: ${currentPrice.toFixed(8)} ETH (${new Date().toLocaleTimeString()})`);
      
      // Проверяем cooldown
      if (lastAction && (now - lastAction) < cooldown) {
        console.log(`⏳ Cooldown: ${Math.ceil((cooldown - (now - lastAction)) / 1000)}с до следующего действия`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval));
        continue;
      }
      
      // Проверяем цену газа
      const gasOk = await checkGasPrice(provider);
      if (!gasOk) {
        console.log('⏳ Ждем снижения цены газа...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval));
        continue;
      }
      
      // Логика торговли
      if (currentPrice <= parseFloat(CONFIG.buyPrice)) {
        console.log(`🟢 Цена ${currentPrice.toFixed(8)} <= ${CONFIG.buyPrice} - ВЫПОЛНЯЮ ПОКУПКУ`);
        await executeZapIn(wallet, CONFIG.zapAddress, CONFIG.buyAmount);
        lastAction = now;
      } else if (currentPrice >= parseFloat(CONFIG.sellPrice)) {
        console.log(`🔴 Цена ${currentPrice.toFixed(8)} >= ${CONFIG.sellPrice} - ВЫПОЛНЯЮ ПРОДАЖУ`);
        await executeExit(wallet, CONFIG.zapAddress);
        lastAction = now;
      } else {
        console.log(`⚪ Цена в диапазоне ${CONFIG.buyPrice} - ${CONFIG.sellPrice} ETH`);
      }
      
    } catch (error) {
      console.error('❌ Ошибка:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, CONFIG.checkInterval));
  }
}

main().catch((error) => {
  console.error('💥 Критическая ошибка:', error);
  process.exit(1);
});
