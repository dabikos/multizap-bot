const readline = require('readline');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getPrivateKeyInteractive } = require('./util-session');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getContractInterface() {
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'MultiZap.sol', 'MultiZap.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return { abi: artifact.abi };
}

async function main() {
  const rpcUrl = process.env.ETH_RPC_URL || process.env.RPC_URL || 'https://eth.llamarpc.com';
  const { abi } = getContractInterface();

  const privateKey = await getPrivateKeyInteractive();
  const multiZapAddress = await prompt('MultiZap contract address: ');

  if (!privateKey || !multiZapAddress) {
    console.error('Error: private key and contract address are required');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const multiZap = new ethers.Contract(multiZapAddress, abi, wallet);

  while (true) {
    console.log('\n=== MultiZap token management ===');
    console.log('1. Remove token');
    console.log('2. Show all tokens');
    console.log('3. Show token info');
    console.log('4. Show balances');
    console.log('0. Exit');

    const choice = await prompt('Choose action (0-4): ');

    switch (choice) {
      case '1':
        await removeToken(multiZap);
        break;
      case '2':
        await showAllTokens(multiZap);
        break;
      case '3':
        await showTokenInfo(multiZap);
        break;
      case '4':
        await showBalances(multiZap);
        break;
      case '0':
        console.log('Exit...');
        process.exit(0);
      default:
        console.log('Invalid choice');
    }
  }
}

async function removeToken(multiZap) {
  try {
    const token = await prompt('Token address to remove: ');

    if (!token) {
      console.error('Error: token address is required');
      return;
    }

    const tx = await multiZap.removeToken(token);
    console.log('Transaction sent:', tx.hash);
    await tx.wait();
    console.log('Success: token removed');
  } catch (error) {
    console.error('Remove token error:', error.message);
  }
}

async function showAllTokens(multiZap) {
  try {
    const tokens = await multiZap.getAllTokens();
    console.log(`\nTotal tokens: ${tokens.length}`);

    for (let i = 0; i < tokens.length; i++) {
      const tokenInfo = await multiZap.getTokenInfo(tokens[i]);
      console.log(`${i + 1}. Token: ${tokens[i]}`);
      console.log(`   LP token: ${tokenInfo.lpToken}`);
      console.log(`   Status: ${tokenInfo.isActive ? 'Active' : 'Inactive'}`);
      console.log('');
    }
  } catch (error) {
    console.error('Show tokens error:', error.message);
  }
}

async function showTokenInfo(multiZap) {
  try {
    const token = await prompt('Token address: ');

    if (!token) {
      console.error('Error: token address is required');
      return;
    }

    const tokenInfo = await multiZap.getTokenInfo(token);
    if (tokenInfo.token === ethers.ZeroAddress) {
      console.log('Token not found');
      return;
    }

    console.log(`\nToken info for ${token}:`);
    console.log(`LP token: ${tokenInfo.lpToken}`);
    console.log(`Status: ${tokenInfo.isActive ? 'Active' : 'Inactive'}`);
  } catch (error) {
    console.error('Show token info error:', error.message);
  }
}

async function showBalances(multiZap) {
  try {
    const tokens = await multiZap.getAllTokens();
    console.log('\nBalances:');

    for (const token of tokens) {
      const lpBalance = await multiZap.getLpBalance(token);
      const tokenBalance = await multiZap.getTokenBalance(token);

      console.log(`\nToken: ${token}`);
      console.log(`  LP balance: ${ethers.formatEther(lpBalance)} LP`);
      console.log(`  Token balance: ${ethers.formatEther(tokenBalance)}`);
    }

    const ethBalance = await multiZap.runner.provider.getBalance(await multiZap.getAddress());
    console.log(`\nContract ETH balance: ${ethers.formatEther(ethBalance)} ETH`);
  } catch (error) {
    console.error('Show balances error:', error.message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
