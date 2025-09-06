const { ethers } = require('ethers');
const config = require('../bot/config');

async function testRealGasCost() {
  try {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    
    console.log('Кошелек:', wallet.address);
    
    // Получаем текущие газовые параметры
    const feeData = await provider.getFeeData();
    console.log('\n=== Газовые параметры ===');
    console.log('Max Fee Per Gas:', ethers.formatUnits(feeData.maxFeePerGas, 'gwei'), 'gwei');
    console.log('Max Priority Fee Per Gas:', ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei'), 'gwei');
    console.log('Gas Price:', ethers.formatUnits(feeData.gasPrice, 'gwei'), 'gwei');
    
    // Рассчитываем максимальную стоимость
    const gasLimit = 500000;
    const maxCost = BigInt(gasLimit) * feeData.maxFeePerGas;
    console.log('\n=== Расчет стоимости ===');
    console.log('Gas Limit:', gasLimit);
    console.log('Максимальная стоимость (maxFeePerGas * gasLimit):', ethers.formatEther(maxCost), 'ETH');
    
    // Получаем баланс до
    const balanceBefore = await provider.getBalance(wallet.address);
    console.log('\n=== Баланс ===');
    console.log('Баланс до:', ethers.formatEther(balanceBefore), 'ETH');
    
    // Отправляем тестовую транзакцию (перевод самому себе)
    console.log('\n=== Отправка тестовой транзакции ===');
    const tx = await wallet.sendTransaction({
      to: wallet.address,
      value: ethers.parseEther('0.001'),
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      gasLimit: gasLimit
    });
    
    console.log('Транзакция отправлена:', tx.hash);
    console.log('Ожидание подтверждения...');
    
    const receipt = await tx.wait();
    console.log('Транзакция подтверждена в блоке:', receipt.blockNumber);
    
    // Получаем баланс после
    const balanceAfter = await provider.getBalance(wallet.address);
    console.log('Баланс после:', ethers.formatEther(balanceAfter), 'ETH');
    
    // Рассчитываем реальную стоимость
    const realCost = balanceBefore - balanceAfter;
    const realCostEth = ethers.formatEther(realCost);
    console.log('\n=== Реальная стоимость ===');
    console.log('Реально списано:', realCostEth, 'ETH');
    console.log('Gas Used:', receipt.gasUsed.toString());
    console.log('Effective Gas Price:', ethers.formatUnits(receipt.gasPrice, 'gwei'), 'gwei');
    
    // Сравниваем
    const maxCostEth = ethers.formatEther(maxCost);
    console.log('\n=== Сравнение ===');
    console.log('Максимальная стоимость:', maxCostEth, 'ETH');
    console.log('Реальная стоимость:', realCostEth, 'ETH');
    console.log('Экономия:', (parseFloat(maxCostEth) - parseFloat(realCostEth)).toFixed(6), 'ETH');
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

testRealGasCost();
