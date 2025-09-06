const readline = require('readline');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getPrivateKeyInteractive } = require('./util-session');

function prompt(question, { mask = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (!mask) {
      rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
    } else {
      process.stdout.write(question);
      let input = '';
      const onData = (char) => {
        char = char + '';
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdout.write('\n');
            process.stdin.removeListener('data', onData);
            rl.close();
            resolve(input.trim());
            break;
          default:
            process.stdout.write('*');
            input += char;
            break;
        }
      };
      process.stdin.on('data', onData);
    }
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
  const tokenAddress = await prompt('Адрес токена для zap-in: ');
  const amountEthStr = await prompt('Сумма ETH для zap-in (например 0.01): ');

  if (!privateKey || !multiZapAddress || !tokenAddress || !amountEthStr) {
    console.error('Ошибка: все поля обязательны');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const multiZap = new ethers.Contract(multiZapAddress, abi, wallet);

  // Проверяем, поддерживается ли токен
  try {
    const tokenInfo = await multiZap.getTokenInfo(tokenAddress);
    if (tokenInfo.token === ethers.ZeroAddress) {
      console.error('Ошибка: токен не поддерживается. Добавьте его сначала через manage-tokens.js');
      process.exit(1);
    }
    if (!tokenInfo.isActive) {
      console.error('Ошибка: токен неактивен');
      process.exit(1);
    }
    console.log(`Токен найден: ${tokenInfo.token}, LP: ${tokenInfo.lpToken}`);
  } catch (error) {
    console.error('Ошибка при проверке токена:', error.message);
    process.exit(1);
  }

  const amountWei = ethers.parseEther(amountEthStr);

  // Для стабильной работы ликвидности ставим минимумы = 0 на этапе addLiquidity.
  // Слиппейдж 4% применяем только к свопу, но без оффчейн-квоты оставляем 0.
  const amountOutMinToken = 0n;
  const amountTokenMin = 0n;
  const amountETHMin = 0n;

  try {
    const tx = await multiZap.zapIn(
      tokenAddress,
      amountOutMinToken,
      amountTokenMin,
      amountETHMin,
      { value: amountWei }
    );
    console.log('Транзакция отправлена:', tx.hash);
    await tx.wait();
    console.log('УСПЕШНО: zap-in выполнен');
  } catch (error) {
    console.error('Ошибка при выполнении zap-in:', error.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


