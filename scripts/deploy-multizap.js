const readline = require('readline');
const { ethers } = require('hardhat');
const { getPrivateKeyInteractive } = require('./util-session');

async function main() {
  const rpcUrl = 'https://eth-mainnet.g.alchemy.com/v2/x3twrYyq0NHf4x7oZSKKcQl9ehTwS4l9';
  const privateKey = await getPrivateKeyInteractive();
  const router = await prompt('Адрес роутера (например, Uniswap V2): ');

  if (!privateKey || !router) {
    console.error('Ошибка: все поля обязательны');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log('Развертывание контракта MultiZap...');
  const MultiZapFactory = await ethers.getContractFactory('MultiZap', wallet);
  const multiZap = await MultiZapFactory.deploy(router);
  await multiZap.waitForDeployment();
  const address = await multiZap.getAddress();

  console.log('УСПЕШНО: контракт MultiZap задеплоен по адресу:', address);
  console.log('Теперь вы можете добавлять токены с помощью скрипта add-token.js');
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

