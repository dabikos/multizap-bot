const { ethers } = require('ethers');
const Web3Manager = require('./web3Manager');
const config = require('./config');

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
];

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];

class SniperMonitor {
  constructor(telegramBot, sniperManager) {
    this.telegramBot = telegramBot;
    this.sniperManager = sniperManager;
    this.userManager = telegramBot.userManager;
    this.interval = null;
    this.isRunning = false;
    this.checkIntervalMs = 3000;
    this.processing = false;
  }

  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.interval = setInterval(() => this.checkSnipers(), this.checkIntervalMs);
    this.checkSnipers();
    console.log('Sniper monitor started');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
  }

  getNetworkBuckets() {
    const buckets = new Map();
    for (const item of this.sniperManager.getActiveSnipers()) {
      const network = item.sniper.network || config.DEFAULT_NETWORK;
      if (!buckets.has(network)) {
        buckets.set(network, []);
      }
      buckets.get(network).push(item);
    }
    return buckets;
  }

  async checkSnipers() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      const buckets = this.getNetworkBuckets();
      for (const [network, items] of buckets.entries()) {
        await this.checkNetwork(network, items);
      }
    } catch (error) {
      console.error('Sniper monitor error:', error.message);
    } finally {
      this.processing = false;
    }
  }

  async checkNetwork(network, items) {
    const web3Manager = new Web3Manager(network);
    const provider = web3Manager.provider;
    const latestBlock = await provider.getBlockNumber();

    for (const { chatId, sniper } of items) {
      try {
        if (sniper.status === 'watching_liquidity' && sniper.detectedToken) {
          const liquidity = await this.getPairLiquidity(web3Manager, sniper.detectedToken);
          if (liquidity.hasLiquidity) {
            await this.executeBuy(chatId, sniper, sniper.detectedToken, liquidity.pair);
          } else {
            this.sniperManager.updateSniper(chatId, sniper.id, { lastCheckedBlock: latestBlock });
          }
          continue;
        }

        const previousBlock = Number(sniper.lastCheckedBlock || sniper.startBlock || latestBlock);
        const fromBlock = Math.max(previousBlock, latestBlock - 20);
        for (let blockNumber = fromBlock + 1; blockNumber <= latestBlock; blockNumber++) {
          const foundToken = await this.findCreatedTokenInBlock(provider, sniper.deployer, blockNumber);
          this.sniperManager.updateSniper(chatId, sniper.id, { lastCheckedBlock: blockNumber });

          if (!foundToken) {
            continue;
          }

          const isErc20 = await this.isErc20(provider, foundToken.tokenAddress);
          if (!isErc20) {
            continue;
          }

          this.sniperManager.updateSniper(chatId, sniper.id, {
            status: 'watching_liquidity',
            detectedToken: foundToken.tokenAddress,
            detectedTx: foundToken.txHash
          });

          await this.telegramBot.bot.sendMessage(
            chatId,
            `Sniper found new token\n\nToken: \`${foundToken.tokenAddress}\`\nDeploy tx: ${config.getExplorerUrl(network)}/tx/${foundToken.txHash}\n\nWaiting for pair liquidity...`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});

          const liquidity = await this.getPairLiquidity(web3Manager, foundToken.tokenAddress);
          if (liquidity.hasLiquidity) {
            await this.executeBuy(chatId, sniper, foundToken.tokenAddress, liquidity.pair);
          }
          break;
        }
      } catch (error) {
        if (this.isTransientRpcError(error)) {
          console.warn(`Sniper ${sniper.id} transient RPC error:`, error.message);
          continue;
        }

        console.error(`Sniper ${sniper.id} error:`, error.message);
        this.sniperManager.updateSniper(chatId, sniper.id, {
          status: 'failed',
          error: error.message
        });
        await this.telegramBot.bot.sendMessage(chatId, `Sniper failed #${sniper.id}: ${error.message}`).catch(() => {});
      }
    }
  }

  isTransientRpcError(error) {
    const message = error.message || '';
    return error.code === 'SERVER_ERROR' ||
      error.code === 'TIMEOUT' ||
      error.code === 'NETWORK_ERROR' ||
      message.includes('503') ||
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('timeout');
  }

  async findCreatedTokenInBlock(provider, deployer, blockNumber) {
    const block = await provider.getBlock(blockNumber, true);
    if (!block) {
      return null;
    }

    const transactions = block.prefetchedTransactions || block.transactions || [];
    for (const txItem of transactions) {
      const tx = typeof txItem === 'string' ? await provider.getTransaction(txItem) : txItem;
      if (!tx || tx.to || !tx.from || tx.from.toLowerCase() !== deployer.toLowerCase()) {
        continue;
      }

      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (receipt?.contractAddress) {
        return {
          txHash: tx.hash,
          tokenAddress: receipt.contractAddress
        };
      }
    }

    return null;
  }

  async isErc20(provider, tokenAddress) {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [decimals, totalSupply] = await Promise.all([
        token.decimals(),
        token.totalSupply()
      ]);
      return Number(decimals) >= 0 && totalSupply > 0n;
    } catch (error) {
      return false;
    }
  }

  async getPairLiquidity(web3Manager, tokenAddress) {
    const wethAddress = await web3Manager.getWethAddress();
    const factory = new ethers.Contract(web3Manager.networkConfig.factoryAddress, FACTORY_ABI, web3Manager.provider);
    const pair = await factory.getPair(tokenAddress, wethAddress);

    if (!pair || pair === ethers.ZeroAddress) {
      return { hasLiquidity: false, pair: ethers.ZeroAddress };
    }

    const pairContract = new ethers.Contract(pair, PAIR_ABI, web3Manager.provider);
    const [reserve0, reserve1] = await pairContract.getReserves();
    return {
      hasLiquidity: reserve0 > 0n && reserve1 > 0n,
      pair
    };
  }

  async executeBuy(chatId, sniper, tokenAddress, pairAddress) {
    const user = this.userManager.getUser(chatId);
    const userContract = user ? this.userManager.getUserContract(chatId, sniper.network) : null;
    if (!user || !userContract) {
      throw new Error('Deploy the contract first with /deploy');
    }

    this.sniperManager.updateSniper(chatId, sniper.id, { status: 'buying' });

    const web3Manager = new Web3Manager(sniper.network);
    web3Manager.setPrivateKey(user.privateKey);
    web3Manager.setContractAddress(userContract);

    const buyResult = await this.telegramBot.runTokenAction(chatId, 'sniper_buy', tokenAddress, () =>
      this.telegramBot.autoAddAndZapIn(chatId, web3Manager, tokenAddress, Number(sniper.amount))
    );

    this.userManager.unhideToken(chatId, tokenAddress, sniper.network);
    this.sniperManager.updateSniper(chatId, sniper.id, {
      status: 'completed',
      detectedToken: tokenAddress,
      pairAddress,
      buyTx: buyResult.txHash
    });

    const explorerUrl = config.getExplorerUrl(sniper.network);
    await this.telegramBot.bot.sendMessage(
      chatId,
      `Sniper buy completed\n\nToken: \`${tokenAddress}\`\nPair: \`${pairAddress}\`\nAmount: ${sniper.amount} ${config.getNetworkConfig(sniper.network).nativeCurrency}\nTx: ${explorerUrl}/tx/${buyResult.txHash}`,
      { parse_mode: 'Markdown' }
    );

    await this.telegramBot.showTokenPosition(chatId, tokenAddress).catch(() => {});
  }
}

module.exports = SniperMonitor;
