const readline = require('readline');
const { ethers } = require('hardhat');
const { getPrivateKeyInteractive } = require('./util-session');

async function main() {
  const rpcUrl = 'https://bsc-dataseed1.binance.org';
  const privateKey = await getPrivateKeyInteractive();
  const router = await prompt('Адрес роутера (например, PancakeSwap V2): ');
  const factory = await prompt('Адрес фабрики (например, PancakeSwap Factory): ');
  const usdtAddress = await prompt('Адрес USDT токена (BSC: 0x55d398326f99059fF775485246999027B3197955): ');

  if (!privateKey || !router || !factory || !usdtAddress) {
    console.error('Ошибка: все поля обязательны');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log('Развертывание контракта MultiZap на BSC...');
  console.log(`Router: ${router}`);
  console.log(`Factory: ${factory}`);
  console.log(`USDT: ${usdtAddress}`);
  
  const MultiZapFactory = await ethers.getContractFactory('MultiZap', wallet);
  const multiZap = await MultiZapFactory.deploy(router, factory, usdtAddress);
  await multiZap.waitForDeployment();
  const address = await multiZap.getAddress();

  console.log('УСПЕШНО: контракт MultiZap задеплоен по адресу:', address);
  console.log('Теперь вы можете добавлять токены с помощью команды /addtoken в боте');
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

