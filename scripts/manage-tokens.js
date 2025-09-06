const readline = require('readline');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getPrivateKeyInteractive } = require('./util-session');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function getContractInterface() {
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'MultiZap.sol', 'MultiZap.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return { abi: artifact.abi };
}

async function main() {
  const rpcUrl = 'https://eth-mainnet.g.alchemy.com/v2/x3twrYyq0NHf4x7oZSKKcQl9ehTwS4l9';
  const { abi } = getContractInterface();

  const privateKey = await getPrivateKeyInteractive();
  const multiZapAddress = await prompt('Адрес развернутого MultiZap: ');

  if (!privateKey || !multiZapAddress) {
    console.error('Ошибка: все поля обязательны');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const multiZap = new ethers.Contract(multiZapAddress, abi, wallet);

  while (true) {
    console.log('\n=== Управление токенами MultiZap ===');
    console.log('1. Добавить токен');
    console.log('2. Удалить токен');
    console.log('3. Изменить статус токена');
    console.log('4. Показать все токены');
    console.log('5. Показать информацию о токене');
    console.log('6. Показать балансы');
    console.log('0. Выход');

    const choice = await prompt('Выберите действие (0-6): ');

    switch (choice) {
      case '1':
        await addToken(multiZap);
        break;
      case '2':
        await removeToken(multiZap);
        break;
      case '3':
        await changeTokenStatus(multiZap);
        break;
      case '4':
        await showAllTokens(multiZap);
        break;
      case '5':
        await showTokenInfo(multiZap);
        break;
      case '6':
        await showBalances(multiZap);
        break;
      case '0':
        console.log('Выход...');
        process.exit(0);
      default:
        console.log('Неверный выбор');
    }
  }
}

async function addToken(multiZap) {
  try {
    const token = await prompt('Адрес токена: ');
    const lpToken = await prompt('Адрес LP токена: ');

    if (!token || !lpToken) {
      console.error('Ошибка: все поля обязательны');
      return;
    }

    const tx = await multiZap.addToken(token, lpToken);
    console.log('Транзакция отправлена:', tx.hash);
    await tx.wait();
    console.log('УСПЕШНО: токен добавлен');
  } catch (error) {
    console.error('Ошибка при добавлении токена:', error.message);
  }
}

async function removeToken(multiZap) {
  try {
    const token = await prompt('Адрес токена для удаления: ');

    if (!token) {
      console.error('Ошибка: адрес токена обязателен');
      return;
    }

    const tx = await multiZap.removeToken(token);
    console.log('Транзакция отправлена:', tx.hash);
    await tx.wait();
    console.log('УСПЕШНО: токен удален');
  } catch (error) {
    console.error('Ошибка при удалении токена:', error.message);
  }
}

async function changeTokenStatus(multiZap) {
  try {
    const token = await prompt('Адрес токена: ');
    const status = await prompt('Новый статус (true/false): ');

    if (!token || !status) {
      console.error('Ошибка: все поля обязательны');
      return;
    }

    const isActive = status.toLowerCase() === 'true';
    const tx = await multiZap.setTokenStatus(token, isActive);
    console.log('Транзакция отправлена:', tx.hash);
    await tx.wait();
    console.log(`УСПЕШНО: статус токена изменен на ${isActive ? 'активен' : 'неактивен'}`);
  } catch (error) {
    console.error('Ошибка при изменении статуса токена:', error.message);
  }
}

async function showAllTokens(multiZap) {
  try {
    const tokens = await multiZap.getAllTokens();
    console.log(`\nВсего токенов: ${tokens.length}`);
    
    for (let i = 0; i < tokens.length; i++) {
      const tokenInfo = await multiZap.getTokenInfo(tokens[i]);
      console.log(`${i + 1}. Токен: ${tokens[i]}`);
      console.log(`   LP токен: ${tokenInfo.lpToken}`);
      console.log(`   Статус: ${tokenInfo.isActive ? 'Активен' : 'Неактивен'}`);
      console.log('');
    }
  } catch (error) {
    console.error('Ошибка при получении списка токенов:', error.message);
  }
}

async function showTokenInfo(multiZap) {
  try {
    const token = await prompt('Адрес токена: ');

    if (!token) {
      console.error('Ошибка: адрес токена обязателен');
      return;
    }

    const tokenInfo = await multiZap.getTokenInfo(token);
    
    if (tokenInfo.token === ethers.ZeroAddress) {
      console.log('Токен не найден');
      return;
    }

    console.log(`\nИнформация о токене ${token}:`);
    console.log(`LP токен: ${tokenInfo.lpToken}`);
    console.log(`Статус: ${tokenInfo.isActive ? 'Активен' : 'Неактивен'}`);
  } catch (error) {
    console.error('Ошибка при получении информации о токене:', error.message);
  }
}

async function showBalances(multiZap) {
  try {
    const tokens = await multiZap.getAllTokens();
    console.log('\nБалансы:');
    
    for (const token of tokens) {
      const tokenInfo = await multiZap.getTokenInfo(token);
      const lpBalance = await multiZap.getLpBalance(token);
      const tokenBalance = await multiZap.getTokenBalance(token);
      
      console.log(`\nТокен: ${token}`);
      console.log(`  LP баланс: ${ethers.formatEther(lpBalance)} LP`);
      console.log(`  Токен баланс: ${ethers.formatEther(tokenBalance)} токенов`);
    }
    
    const ethBalance = await multiZap.runner.provider.getBalance(await multiZap.getAddress());
    console.log(`\nETH баланс контракта: ${ethers.formatEther(ethBalance)} ETH`);
  } catch (error) {
    console.error('Ошибка при получении балансов:', error.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


