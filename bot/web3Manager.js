const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class Web3Manager {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.RPC_URL);
    this.wallet = null;
    this.multiZapContract = null;
    this.abi = null;
    this.bytecode = null;
    this.loadABI();
  }

  loadABI() {
    try {
      const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'MultiZap.sol', 'MultiZap.json');
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      this.abi = artifact.abi;
      this.bytecode = artifact.bytecode;
    } catch (error) {
      console.error('Ошибка загрузки ABI:', error.message);
    }
  }

  setPrivateKey(privateKey) {
    try {
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      return true;
    } catch (error) {
      console.error('Ошибка установки приватного ключа:', error.message);
      return false;
    }
  }

  async deployMultiZap() {
    if (!this.wallet) {
      throw new Error('Приватный ключ не установлен');
    }

    if (!this.abi) {
      throw new Error('ABI не загружен. Убедитесь, что контракт скомпилирован');
    }

    if (!this.bytecode) {
      throw new Error('Bytecode не загружен. Убедитесь, что контракт скомпилирован');
    }

    if (!config.ROUTER_ADDRESS) {
      throw new Error('ROUTER_ADDRESS не определен в конфигурации');
    }

    try {
      console.log('Развертывание контракта с параметрами:');
      console.log('ABI:', this.abi ? 'загружен' : 'не загружен');
      console.log('Bytecode:', this.bytecode ? 'загружен' : 'не загружен');
      console.log('Router Address:', config.ROUTER_ADDRESS);
      console.log('Factory Address:', config.FACTORY_ADDRESS);
      console.log('Wallet Address:', this.wallet.address);
      
      const gasParams = await this.getGasParams();
      console.log('Gas params:', gasParams);
      
      const MultiZapFactory = new ethers.ContractFactory(this.abi, this.bytecode, this.wallet);
      const multiZap = await MultiZapFactory.deploy(
        config.ROUTER_ADDRESS, 
        config.FACTORY_ADDRESS,
        gasParams
      );
      await multiZap.waitForDeployment();
      const address = await multiZap.getAddress();
      
      this.multiZapContract = multiZap;
      return address;
    } catch (error) {
      console.error('Детали ошибки развертывания:', error);
      throw new Error(`Ошибка развертывания контракта: ${error.message}`);
    }
  }

  setContractAddress(address) {
    if (!this.wallet) {
      throw new Error('Приватный ключ не установлен');
    }

    if (!this.abi) {
      throw new Error('ABI не загружен. Убедитесь, что контракт скомпилирован');
    }

    try {
      this.multiZapContract = new ethers.Contract(address, this.abi, this.wallet);
      return true;
    } catch (error) {
      throw new Error(`Ошибка подключения к контракту: ${error.message}`);
    }
  }

  async addToken(tokenAddress, lpTokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const gasParams = await this.getGasParams();
      const tx = await this.multiZapContract.addToken(tokenAddress, lpTokenAddress, gasParams);
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка добавления токена: ${error.message}`);
    }
  }

  async addTokenAuto(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const tx = await this.multiZapContract.addTokenAuto(tokenAddress);
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка автоматического добавления токена: ${error.message}`);
    }
  }

  async removeToken(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const tx = await this.multiZapContract.removeToken(tokenAddress);
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка удаления токена: ${error.message}`);
    }
  }

  async setTokenStatus(tokenAddress, isActive) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const tx = await this.multiZapContract.setTokenStatus(tokenAddress, isActive);
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка изменения статуса токена: ${error.message}`);
    }
  }

  async zapIn(tokenAddress, amountEth, slippagePercent = config.DEFAULT_SLIPPAGE) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const amountWei = ethers.parseEther(amountEth.toString());
      const gasParams = await this.getGasParams();
      
      // Используем фиксированный slippage 7%
      const finalSlippage = parseFloat(slippagePercent);
      
      // Рассчитываем минимальные количества с учетом slippage
      const halfAmount = amountWei / 2n;
      const amountOutMinToken = this.calculateSlippage(halfAmount, finalSlippage);
      const amountTokenMin = this.calculateSlippage(halfAmount, finalSlippage);
      const amountETHMin = this.calculateSlippage(halfAmount, finalSlippage);
      
      console.log(`Slippage: ${finalSlippage}% (фиксированный)`);
      console.log(`Amount Out Min Token: ${ethers.formatEther(amountOutMinToken)} ETH`);
      console.log(`Amount Token Min: ${ethers.formatEther(amountTokenMin)} ETH`);
      console.log(`Amount ETH Min: ${ethers.formatEther(amountETHMin)} ETH`);
      
      const tx = await this.multiZapContract.zapIn(
        tokenAddress,
        amountOutMinToken,
        amountTokenMin,
        amountETHMin,
        { 
          value: amountWei,
          ...gasParams
        }
      );
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка zap-in: ${error.message}`);
    }
  }

  async exitAndSell(tokenAddress, slippagePercent = config.DEFAULT_SLIPPAGE) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const gasParams = await this.getGasParams();
      
      // Для exitAndSell используем 0% slippage для максимальной гибкости
      console.log(`Slippage: 0% (для exitAndSell - максимальная гибкость)`);
      
      const tx = await this.multiZapContract.exitAndSell(
        tokenAddress,
        0, // amountTokenMin - 0 для максимальной гибкости
        0, // amountETHMin - 0 для максимальной гибкости  
        0, // amountOutMinETH - 0 для максимальной гибкости
        gasParams
      );
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка exit-and-sell: ${error.message}`);
    }
  }


  async getTokenInfo(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      return await this.multiZapContract.getTokenInfo(tokenAddress);
    } catch (error) {
      throw new Error(`Ошибка получения информации о токене: ${error.message}`);
    }
  }

  async getAllTokens() {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      return await this.multiZapContract.getAllTokens();
    } catch (error) {
      throw new Error(`Ошибка получения списка токенов: ${error.message}`);
    }
  }

  async getLpBalance(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const balance = await this.multiZapContract.getLpBalance(tokenAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      throw new Error(`Ошибка получения LP баланса: ${error.message}`);
    }
  }

  async getTokenBalance(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const balance = await this.multiZapContract.getTokenBalance(tokenAddress);
      return ethers.formatEther(balance);
    } catch (error) {
      throw new Error(`Ошибка получения баланса токена: ${error.message}`);
    }
  }

  async getEthBalance() {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    try {
      const balance = await this.provider.getBalance(await this.multiZapContract.getAddress());
      return ethers.formatEther(balance);
    } catch (error) {
      throw new Error(`Ошибка получения ETH баланса: ${error.message}`);
    }
  }

  async getWalletBalance() {
    if (!this.wallet) {
      throw new Error('Приватный ключ не установлен');
    }

    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return ethers.formatEther(balance);
    } catch (error) {
      throw new Error(`Ошибка получения баланса кошелька: ${error.message}`);
    }
  }

  getWalletAddress() {
    if (!this.wallet) {
      return null;
    }
    return this.wallet.address;
  }

  async getGasParams() {
    try {
      // Получаем текущие газовые параметры
      const feeData = await this.provider.getFeeData();
      
      // Используем EIP-1559 параметры если доступны
      if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        return {
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          gasLimit: config.GAS_LIMIT
        };
      } else {
        // Fallback на gasPrice если EIP-1559 не поддерживается
        return {
          gasPrice: feeData.gasPrice,
          gasLimit: config.GAS_LIMIT
        };
      }
    } catch (error) {
      console.error('Ошибка получения газовых параметров:', error);
      // Fallback значения
      return {
        maxFeePerGas: config.MAX_FEE_PER_GAS,
        maxPriorityFeePerGas: config.MAX_PRIORITY_FEE_PER_GAS,
        gasLimit: config.GAS_LIMIT
      };
    }
  }


  calculateSlippage(amount, slippagePercent = config.DEFAULT_SLIPPAGE) {
    // Конвертируем slippage в число
    const slippage = parseFloat(slippagePercent);
    
    // Проверяем лимиты
    const minSlippage = parseFloat(config.MIN_SLIPPAGE);
    const maxSlippage = parseFloat(config.MAX_SLIPPAGE);
    
    if (slippage < minSlippage) {
      console.warn(`Slippage ${slippage}% меньше минимума ${minSlippage}%, используем минимум`);
      return amount * (100 - minSlippage) / 100;
    }
    
    if (slippage > maxSlippage) {
      console.warn(`Slippage ${slippage}% больше максимума ${maxSlippage}%, используем максимум`);
      return amount * (100 - maxSlippage) / 100;
    }
    
    // Рассчитываем минимальное количество с учетом slippage
    return amount * (100 - slippage) / 100;
  }

  async getEthPrice() {
    try {
      // Получаем цену ETH через CoinGecko API
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      return data.ethereum.usd;
    } catch (error) {
      console.error('Ошибка получения цены ETH:', error);
      return 3000; // Fallback цена
    }
  }

  async getTokenPrice(tokenAddress) {
    try {
      // Получаем цену токена через Uniswap V2
      const tokenContract = new ethers.Contract(tokenAddress, [
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)',
        'function totalSupply() view returns (uint256)'
      ], this.provider);

      const routerContract = new ethers.Contract(config.ROUTER_ADDRESS, [
        'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
        'function WETH() external pure returns (address)'
      ], this.provider);

      const wethAddress = await routerContract.WETH();
      const path = [tokenAddress, wethAddress];
      
      // Сначала получаем decimals токена
      const [decimals, symbol, name, totalSupply, ethPriceInUsd] = await Promise.all([
        tokenContract.decimals(),
        tokenContract.symbol(),
        tokenContract.name(),
        tokenContract.totalSupply(),
        this.getEthPrice()
      ]);

      // Используем правильное количество десятичных знаков для 1 токена
      const amountIn = ethers.parseUnits('1', decimals);
      
      const amounts = await routerContract.getAmountsOut(amountIn, path);
      const priceInEth = ethers.formatEther(amounts[1]);

      const formattedSupply = ethers.formatUnits(totalSupply, decimals);
      
      // Рассчитываем цену в долларах и маркеткап
      const priceInUsd = parseFloat(priceInEth) * ethPriceInUsd;
      const marketCapInUsd = priceInUsd * parseFloat(formattedSupply);
      
      return {
        price: parseFloat(priceInEth),
        priceUsd: priceInUsd,
        symbol,
        name,
        decimals: Number(decimals),
        totalSupply: parseFloat(formattedSupply),
        marketCap: marketCapInUsd,
        ethPrice: ethPriceInUsd
      };
    } catch (error) {
      console.error('Ошибка получения цены токена:', error);
      return {
        price: 0,
        priceUsd: 0,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18,
        totalSupply: 0,
        marketCap: 0,
        ethPrice: 3000
      };
    }
  }
}

module.exports = Web3Manager;
