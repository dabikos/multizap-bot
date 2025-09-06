const { ethers } = require('ethers');
const config = require('../bot/config');

async function transferTokensToNewContract() {
  try {
    // Подключаемся к сети
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    
    console.log('Кошелек:', wallet.address);
    
    // Адреса контрактов
    const oldContractAddress = '0x49Ef3B442f596bf99d98f5E931ccbd8C3CB1A9f2';
    const marieAddress = '0xFfADDB760c06876588EAA259e34767a99A6b6016';
    
    // ABI для токена MARIE
    const tokenABI = [
      'function balanceOf(address account) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function transferFrom(address from, address to, uint256 amount) returns (bool)'
    ];
    
    const token = new ethers.Contract(marieAddress, tokenABI, wallet);
    
    // Проверяем баланс в старом контракте
    const oldBalance = await token.balanceOf(oldContractAddress);
    console.log('Баланс MARIE в старом контракте:', ethers.formatEther(oldBalance));
    
    if (oldBalance > 0) {
      console.log('Попытка перевести токены из старого контракта...');
      
      // Попробуем перевести токены напрямую
      try {
        const transferTx = await token.transferFrom(oldContractAddress, wallet.address, oldBalance);
        console.log('Транзакция перевода отправлена:', transferTx.hash);
        await transferTx.wait();
        console.log('✅ Токены переведены в кошелек!');
        
        // Проверяем баланс в кошельке
        const walletBalance = await token.balanceOf(wallet.address);
        console.log('Баланс MARIE в кошельке:', ethers.formatEther(walletBalance));
        
      } catch (error) {
        console.log('❌ Не удалось перевести токены:', error.message);
        console.log('💡 Токен MARIE имеет ограничения на трансферы');
        console.log('💡 Нужно использовать новый контракт с функцией sellTokensOnly');
      }
    } else {
      console.log('❌ В старом контракте нет токенов MARIE');
    }
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

transferTokensToNewContract();

