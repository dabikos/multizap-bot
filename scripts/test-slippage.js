const { ethers } = require('ethers');
const config = require('../bot/config');

function calculateSlippage(amount, slippagePercent = config.DEFAULT_SLIPPAGE) {
  const slippage = parseFloat(slippagePercent);
  return (amount * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;
}

async function testSlippage() {
  try {
    console.log('=== Тест Slippage ===\n');
    
    // Тестовые значения
    const testAmount = ethers.parseEther('1.0'); // 1 ETH
    const slippageValues = [0.1, 1, 5, 10, 20, 50];
    
    console.log('Тестовая сумма:', ethers.formatEther(testAmount), 'ETH');
    console.log('Настройки slippage:');
    console.log('- По умолчанию:', config.DEFAULT_SLIPPAGE, '%');
    console.log('- Минимум:', config.MIN_SLIPPAGE, '%');
    console.log('- Максимум:', config.MAX_SLIPPAGE, '%\n');
    
    console.log('=== Расчеты ===');
    console.log('Slippage | Минимальная сумма | Потеря');
    console.log('---------|-------------------|--------');
    
    slippageValues.forEach(slippage => {
      const minAmount = calculateSlippage(testAmount, slippage);
      const loss = testAmount - minAmount;
      const lossPercent = Number(loss * 10000n / testAmount) / 100;
      
      console.log(
        `${slippage.toString().padStart(8)}% | ${ethers.formatEther(minAmount).padStart(17)} ETH | ${ethers.formatEther(loss).padStart(6)} ETH (${lossPercent.toFixed(2)}%)`
      );
    });
    
    console.log('\n=== Рекомендации ===');
    console.log('• 0.1-1%   - Для стабильных токенов (USDC, USDT)');
    console.log('• 2-5%     - Для популярных токенов (ETH, WBTC)');
    console.log('• 5-10%    - Для новых/малоизвестных токенов');
    console.log('• 10-20%   - Для очень волатильных токенов');
    console.log('• 20%+     - Только для экстремальных случаев');
    
    console.log('\n=== Текущие настройки бота ===');
    console.log('По умолчанию используется:', config.DEFAULT_SLIPPAGE, '% slippage');
    console.log('Это означает, что при покупке на 1 ETH вы получите минимум:', 
                ethers.formatEther(calculateSlippage(testAmount)), 'ETH');
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

testSlippage();
