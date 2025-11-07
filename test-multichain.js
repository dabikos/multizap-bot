const config = require('./bot/config');
const Web3Manager = require('./bot/web3Manager');
const UserManager = require('./bot/userManager');

console.log('🧪 Тестирование мультичейн функциональности\n');

// Тест 1: Проверка конфигурации сетей
console.log('1️⃣ Тест конфигурации сетей:');
const networks = ['ETH', 'BSC', 'BASE'];
networks.forEach(network => {
  const netConfig = config.getNetworkConfig(network);
  console.log(`   ✅ ${network}: ${netConfig.name}`);
  console.log(`      RPC: ${netConfig.rpcUrl}`);
  console.log(`      Chain ID: ${netConfig.chainId}`);
  console.log(`      Router: ${netConfig.routerAddress.slice(0, 10)}...`);
  console.log(`      Explorer: ${netConfig.explorerUrl}`);
  console.log(`      Native: ${netConfig.nativeCurrency}`);
  console.log(`      EIP-1559: ${netConfig.supportsEIP1559 ? 'Да' : 'Нет'}`);
  console.log('');
});

// Тест 2: Проверка Web3Manager
console.log('2️⃣ Тест Web3Manager:');
try {
  const web3Manager = new Web3Manager('BSC');
  console.log(`   ✅ Web3Manager создан для сети: ${web3Manager.getCurrentNetwork()}`);
  
  // Тест переключения сетей
  networks.forEach(network => {
    try {
      web3Manager.setNetwork(network);
      console.log(`   ✅ Переключение на ${network}: успешно`);
      const netConfig = web3Manager.getNetworkConfig();
      console.log(`      Текущая сеть: ${netConfig.name}`);
    } catch (error) {
      console.log(`   ❌ Ошибка переключения на ${network}: ${error.message}`);
    }
  });
  
  console.log('');
} catch (error) {
  console.log(`   ❌ Ошибка создания Web3Manager: ${error.message}\n`);
}

// Тест 3: Проверка UserManager
console.log('3️⃣ Тест UserManager:');
try {
  const userManager = new UserManager();
  const testUserId = 123456789;
  
  // Добавление тестового пользователя
  const privateKey = '0x' + '1'.repeat(64); // Тестовый ключ
  userManager.addUser(testUserId, privateKey);
  console.log('   ✅ Пользователь добавлен');
  
  // Проверка сетей
  networks.forEach(network => {
    userManager.setUserNetwork(testUserId, network);
    const currentNetwork = userManager.getUserNetwork(testUserId);
    console.log(`   ✅ Сеть пользователя установлена: ${currentNetwork}`);
    
    // Симуляция контракта
    const testContract = `0x${network}${'0'.repeat(38)}`;
    userManager.updateUserContract(testUserId, testContract, network);
    const contract = userManager.getUserContract(testUserId, network);
    console.log(`   ✅ Контракт для ${network}: ${contract ? contract.slice(0, 10) + '...' : 'не установлен'}`);
  });
  
  console.log('');
} catch (error) {
  console.log(`   ❌ Ошибка UserManager: ${error.message}\n`);
}

// Тест 4: Проверка helper функций
console.log('4️⃣ Тест helper функций:');
try {
  networks.forEach(network => {
    const explorerUrl = config.getExplorerUrl(network);
    console.log(`   ✅ Explorer URL для ${network}: ${explorerUrl}`);
  });
  console.log('');
} catch (error) {
  console.log(`   ❌ Ошибка helper функций: ${error.message}\n`);
}

// Тест 5: Проверка подключения к RPC
console.log('5️⃣ Тест подключения к RPC (может занять время):');
async function testRPC() {
  for (const network of networks) {
    try {
      const web3Manager = new Web3Manager(network);
      const provider = web3Manager.provider;
      const blockNumber = await provider.getBlockNumber();
      console.log(`   ✅ ${network}: подключено, блок #${blockNumber}`);
    } catch (error) {
      console.log(`   ⚠️  ${network}: ошибка подключения - ${error.message}`);
    }
  }
  console.log('');
}

// Запуск асинхронного теста
testRPC().then(() => {
  console.log('✅ Все тесты завершены!');
  console.log('\n📋 Следующие шаги для тестирования бота:');
  console.log('   1. Запустите бота: npm run bot (или node bot/telegram-bot.js)');
  console.log('   2. Откройте Telegram и найдите вашего бота');
  console.log('   3. Отправьте команду /start');
  console.log('   4. Попробуйте команду /network для переключения сетей');
  console.log('   5. Проверьте команду /home - должна показывать текущую сеть');
  console.log('   6. Зарегистрируйтесь через /register');
  console.log('   7. Попробуйте развернуть контракт в разных сетях');
  process.exit(0);
}).catch(error => {
  console.error('❌ Ошибка при тестировании:', error);
  process.exit(1);
});

