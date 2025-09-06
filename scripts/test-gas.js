const { ethers } = require('ethers');
const config = require('../bot/config');

async function testGas() {
  try {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    
    console.log('Кошелек:', wallet.address);
    
    // Получаем газовые параметры
    const feeData = await provider.getFeeData();
    console.log('Fee Data:', {
      gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') + ' gwei' : 'null',
      maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') + ' gwei' : 'null',
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') + ' gwei' : 'null'
    });
    
    // Проверяем, поддерживается ли EIP-1559
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      console.log('✅ EIP-1559 поддерживается');
      console.log('Max Fee Per Gas:', ethers.formatUnits(feeData.maxFeePerGas, 'gwei'), 'gwei');
      console.log('Max Priority Fee Per Gas:', ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei'), 'gwei');
    } else {
      console.log('❌ EIP-1559 не поддерживается, используется gasPrice');
      console.log('Gas Price:', ethers.formatUnits(feeData.gasPrice, 'gwei'), 'gwei');
    }
    
    // Проверяем баланс
    const balance = await provider.getBalance(wallet.address);
    console.log('ETH баланс:', ethers.formatEther(balance));
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

testGas();
