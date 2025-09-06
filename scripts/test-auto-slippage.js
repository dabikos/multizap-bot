const { ethers } = require('ethers');
const Web3Manager = require('../bot/web3Manager');
const config = require('../bot/config');

async function testAutoSlippage() {
  try {
    const web3Manager = new Web3Manager();
    web3Manager.setPrivateKey(config.PRIVATE_KEY);
    
    console.log('=== Тест автоматического slippage ===\n');
    
    // Тестовые токены с разными характеристиками
    const testTokens = [
      {
        address: '0xA0b86a33E6441c8C06DDD4e4a4F8b8c8c8c8c8c8', // Фиктивный адрес
        name: 'USDC (стабильный)',
        marketCap: 50000000000, // $50B
        price: 1.0
      },
      {
        address: '0xB0b86a33E6441c8C06DDD4e4a4F8b8c8c8c8c8c8', // Фиктивный адрес
        name: 'ETH (популярный)',
        marketCap: 400000000000, // $400B
        price: 3000.0
      },
      {
        address: '0xC0b86a33E6441c8C06DDD4e4a4F8b8c8c8c8c8c8', // Фиктивный адрес
        name: 'Новый токен (маленький)',
        marketCap: 500000, // $500K
        price: 0.0001
      },
      {
        address: '0xD0b86a33E6441c8C06DDD4e4a4F8b8c8c8c8c8c8', // Фиктивный адрес
        name: 'Мем токен (очень маленький)',
        marketCap: 100000, // $100K
        price: 0.000001
      }
    ];
    
    console.log('Тестируем автоматический подбор slippage для разных токенов:\n');
    
    for (const token of testTokens) {
      console.log(`--- ${token.name} ---`);
      console.log(`Market Cap: $${token.marketCap.toLocaleString()}`);
      console.log(`Price: $${token.price.toFixed(6)}`);
      
      // Симулируем расчет slippage
      let recommendedSlippage = parseFloat(config.DEFAULT_SLIPPAGE);
      
      if (token.marketCap < 1000000) {
        recommendedSlippage = 15;
      } else if (token.marketCap < 10000000) {
        recommendedSlippage = 10;
      } else if (token.marketCap < 100000000) {
        recommendedSlippage = 5;
      } else if (token.marketCap < 1000000000) {
        recommendedSlippage = 2;
      } else {
        recommendedSlippage = 1;
      }
      
      if (token.price < 0.001) {
        recommendedSlippage += 5;
      } else if (token.price > 1000) {
        recommendedSlippage = Math.max(recommendedSlippage - 1, 0.5);
      }
      
      console.log(`Рекомендуемый slippage: ${recommendedSlippage}%`);
      console.log(`Защита: ${recommendedSlippage < 5 ? 'Низкая' : recommendedSlippage < 10 ? 'Средняя' : 'Высокая'}`);
      console.log('');
    }
    
    console.log('=== Рекомендации ===');
    console.log('• 1-2%   - Крупные стабильные токены (USDC, USDT, ETH)');
    console.log('• 5%     - Популярные токены (WBTC, LINK)');
    console.log('• 10%    - Новые токены с хорошей ликвидностью');
    console.log('• 15%+   - Маленькие/мем токены');
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

testAutoSlippage();
