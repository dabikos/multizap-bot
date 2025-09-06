const readline = require('readline');
const { ethers } = require('hardhat');
const { getPrivateKeyInteractive } = require('./util-session');

async function main() {
  const rpcUrl = 'https://eth-mainnet.g.alchemy.com/v2/x3twrYyq0NHf4x7oZSKKcQl9ehTwS4l9';
  const privateKey = await getPrivateKeyInteractive();
  const token = await prompt('Адрес токена: ');
  const lpToken = await prompt('Адрес LP токена: ');
  const router = await prompt('Адрес роутера: ');

  if (!privateKey || !token || !lpToken || !router) {
    console.error('Ошибка: все поля обязательны');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const ZapFactory = await ethers.getContractFactory('Zap', wallet);
  const zap = await ZapFactory.deploy(token, lpToken, router);
  await zap.waitForDeployment();
  const address = await zap.getAddress();

  console.log('УСПЕШНО: контракт Zap задеплоен по адресу:', address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


