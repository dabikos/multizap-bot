const readline = require('readline');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getPrivateKeyInteractive } = require('./util-session');

const RPC_URL = process.env.ETH_RPC_URL || process.env.RPC_URL || 'https://eth.llamarpc.com';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

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

async function main() {
  console.log('🎯 Создание лимитного ордера');
  console.log('================================\n');
  
  // Получаем параметры от пользователя
  const token = await prompt('Адрес токена: ');
  const lpPair = await prompt('Адрес LP пары (WETH/Токен): ');
  const zapAddress = await prompt('Адрес Zap контракта: ');
  
  const privateKey = await getPrivateKeyInteractive();
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  
  console.log(`\n👤 Кошелек: ${wallet.address}`);
  
  // Показываем текущую цену
  try {
    const currentPrice = await getCurrentPrice(provider, lpPair, token);
    console.log(`💰 Текущая цена токена: ${currentPrice.toFixed(8)} ETH\n`);
  } catch (error) {
    console.log('⚠️  Не удалось получить текущую цену\n');
  }
  
  // Выбираем тип ордера
  console.log('Выберите тип ордера:');
  console.log('1. Лимит на покупку (покупать при цене ≤ X)');
  console.log('2. Лимит на продажу (продавать при цене ≥ Y)');
  console.log('3. Оба ордера (покупка + продажа)');
  
  const orderType = await prompt('\nВведите номер (1-3): ');
  
  let buyPrice = null, sellPrice = null, buyAmount = null;
  
  if (orderType === '1' || orderType === '3') {
    buyPrice = await prompt('Цена покупки (≤ X ETH): ');
    buyAmount = await prompt('Сумма ETH для покупки: ');
  }
  
  if (orderType === '2' || orderType === '3') {
    sellPrice = await prompt('Цена продажи (≥ Y ETH): ');
  }
  
  const checkInterval = await prompt('Интервал проверки в секундах (по умолчанию 5): ') || '5';
  const maxGasPrice = await prompt('Максимальная цена газа в gwei (по умолчанию 50): ') || '50';
  
  console.log('\n🚀 Запускаю мониторинг...\n');
  
  let lastAction = null;
  const cooldown = 15000; // 15 сек между действиями
  
  while (true) {
    try {
      const currentPrice = await getCurrentPrice(provider, lpPair, token);
      const now = Date.now();
      
      console.log(`💰 Цена: ${currentPrice.toFixed(8)} ETH (${new Date().toLocaleTimeString()})`);
      
      // Проверяем cooldown
      if (lastAction && (now - lastAction) < cooldown) {
        console.log(`⏳ Cooldown: ${Math.ceil((cooldown - (now - lastAction)) / 1000)}с`);
        await new Promise(resolve => setTimeout(resolve, parseInt(checkInterval) * 1000));
        continue;
      }
      
      // Проверяем цену газа
      const feeData = await provider.getFeeData();
      const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
      
      if (gasPriceGwei > parseFloat(maxGasPrice)) {
        console.log(`⚠️  Высокий газ: ${gasPriceGwei.toFixed(2)} gwei (лимит: ${maxGasPrice} gwei)`);
        await new Promise(resolve => setTimeout(resolve, parseInt(checkInterval) * 1000));
        continue;
      }
      
      // Логика торговли
      if (buyPrice && currentPrice <= parseFloat(buyPrice)) {
        console.log(`🟢 Цена ${currentPrice.toFixed(8)} <= ${buyPrice} - ПОКУПКА!`);
        await executeZapIn(wallet, zapAddress, buyAmount);
        lastAction = now;
      } else if (sellPrice && currentPrice >= parseFloat(sellPrice)) {
        console.log(`🔴 Цена ${currentPrice.toFixed(8)} >= ${sellPrice} - ПРОДАЖА!`);
        await executeExit(wallet, zapAddress);
        lastAction = now;
      } else {
        console.log(`⚪ Ожидание...`);
      }
      
    } catch (error) {
      console.error('❌ Ошибка:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, parseInt(checkInterval) * 1000));
  }
}

main().catch((error) => {
  console.error('💥 Критическая ошибка:', error);
  process.exit(1);
});










