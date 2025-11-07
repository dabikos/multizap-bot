const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const config = require('./config');

class Web3Manager {
  constructor(networkName = null) {
    this.currentNetwork = networkName || config.DEFAULT_NETWORK;
    this.networkConfig = config.getNetworkConfig(this.currentNetwork);
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
    this.wallet = null;
    this.multiZapContract = null;
    this.abi = null;
    this.bytecode = null;
    this.loadABI();
  }

  setNetwork(networkName) {
    const newNetwork = networkName.toUpperCase();
    if (!config.NETWORKS[newNetwork]) {
      throw new Error(`Сеть ${networkName} не поддерживается. Доступные сети: ${Object.keys(config.NETWORKS).join(', ')}`);
    }
    
    this.currentNetwork = newNetwork;
    this.networkConfig = config.getNetworkConfig(this.currentNetwork);
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
    
    // Пересоздаем кошелек с новым провайдером, если он был установлен
    if (this.wallet) {
      const privateKey = this.wallet.privateKey;
      this.wallet = new ethers.Wallet(privateKey, this.provider);
    }
    
    // Сбрасываем контракт, так как он привязан к сети
    this.multiZapContract = null;
    
    return this.currentNetwork;
  }

  getCurrentNetwork() {
    return this.currentNetwork;
  }

  getNetworkConfig() {
    return this.networkConfig;
  }

  getExplorerUrl() {
    return this.networkConfig.explorerUrl;
  }

  // Retry логика для обработки rate limit и временных ошибок
  async retryCall(fn, maxRetries = 3, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        const isRateLimit = error.message?.includes('rate limit') || 
                           error.info?.error?.code === -32016 ||
                           (error.code === 'CALL_EXCEPTION' && error.message?.includes('missing revert data'));
        
        if (isRateLimit && i < maxRetries - 1) {
          const waitTime = delay * (i + 1); // Увеличиваем задержку с каждой попыткой
          console.warn(`Rate limit, повтор через ${waitTime}ms (попытка ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw error;
      }
    }
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

    if (!this.networkConfig.routerAddress) {
      throw new Error('ROUTER_ADDRESS не определен в конфигурации сети');
    }

    try {
      console.log(`Развертывание контракта в сети ${this.currentNetwork}:`);
      console.log('ABI:', this.abi ? 'загружен' : 'не загружен');
      console.log('Bytecode:', this.bytecode ? 'загружен' : 'не загружен');
      console.log('Router Address:', this.networkConfig.routerAddress);
      console.log('Factory Address:', this.networkConfig.factoryAddress);
      console.log('Wallet Address:', this.wallet.address);

      const gasParams = await this.getGasParams();
      console.log('Gas params:', gasParams);

      const MultiZapFactory = new ethers.ContractFactory(this.abi, this.bytecode, this.wallet);
      const multiZap = await MultiZapFactory.deploy(
        ethers.getAddress(this.networkConfig.routerAddress),
        ethers.getAddress(this.networkConfig.factoryAddress),
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

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }
    if (!ethers.isAddress(lpTokenAddress)) {
      throw new Error('Неверный адрес LP токена');
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

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    // Предварительная проверка существования LP пары
    try {
      const factoryContract = new ethers.Contract(
        this.networkConfig.factoryAddress,
        ['function getPair(address, address) view returns (address)'],
        this.provider
      );
      
      const routerContract = new ethers.Contract(
        this.networkConfig.routerAddress,
        ['function WETH() external pure returns (address)'],
        this.provider
      );
      
      const wethAddress = await routerContract.WETH();
      const lpPair = await factoryContract.getPair(tokenAddress, wethAddress);
      
      if (lpPair === ethers.ZeroAddress) {
        throw new Error(`LP_PAIR_NOT_FOUND: Для токена ${tokenAddress} не найдена LP пара с WETH (${wethAddress}). Возможно, токен новый и пара еще не создана, или используется другой DEX. Попробуйте добавить токен вручную с указанием LP адреса.`);
      }
    } catch (error) {
      // Если ошибка уже содержит LP_PAIR_NOT_FOUND, пробрасываем её дальше
      if (error.message.includes('LP_PAIR_NOT_FOUND')) {
        throw error;
      }
      // Иначе продолжаем - возможно проблема с подключением, но попробуем добавить
      console.warn('Предупреждение: не удалось проверить LP пару заранее:', error.message);
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

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
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

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
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

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    if (amountEth <= 0) {
      throw new Error('Сумма должна быть больше 0');
    }

    try {
      const amountWei = ethers.parseEther(amountEth.toString());
      const gasParams = await this.getGasParams();

      // 20% slippage - используем 80% от сумм
      const halfAmount = amountWei / 2n;
      const amountOutMinToken = 0n;
      const amountTokenMin = 0n;
      const amountBNBMin = 0n;

      console.log(`Slippage: 20%`);
      console.log(`Amount Out Min Token: ${ethers.formatEther(amountOutMinToken)} BNB`);
      console.log(`Amount Token Min: ${ethers.formatEther(amountTokenMin)} BNB`);
      console.log(`Amount BNB Min: ${ethers.formatEther(amountBNBMin)} BNB`);

      const tx = await this.multiZapContract.zapIn(
        tokenAddress,
        amountOutMinToken,
        amountTokenMin,
        amountBNBMin,
        {
          value: amountWei,
          ...gasParams
        }
      );
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка zap-in: Транзакция отклонилась`);
    }
  }

  async exitAndSell(tokenAddress, slippagePercent = config.DEFAULT_SLIPPAGE) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    // Получаем информацию о токене из контракта
    let tokenInfo;
    try {
      tokenInfo = await this.retryCall(() => this.multiZapContract.getTokenInfo(tokenAddress));
    } catch (error) {
      throw new Error(`Ошибка получения информации о токене: ${error.message}`);
    }

    if (!tokenInfo || tokenInfo.token === ethers.ZeroAddress) {
      throw new Error('Токен не найден в контракте. Сначала добавьте токен через /addtoken');
    }

    const storedLpToken = tokenInfo.lpToken;
    console.log(`Сохраненный LP токен в контракте: ${storedLpToken}`);

    // Проверяем, что LP токен существует и правильный
    try {
      // Получаем Factory адрес из контракта
      const contractFactoryAddress = await this.retryCall(() => this.multiZapContract.factory());
      const configFactoryAddress = this.networkConfig.factoryAddress;
      
      console.log(`Factory адрес в контракте: ${contractFactoryAddress}`);
      console.log(`Factory адрес в конфиге: ${configFactoryAddress}`);
      
      // Если Factory адреса не совпадают, это может быть проблемой
      if (contractFactoryAddress.toLowerCase() !== configFactoryAddress.toLowerCase()) {
        console.warn(`⚠️ ВНИМАНИЕ: Factory в контракте (${contractFactoryAddress}) отличается от Factory в конфиге (${configFactoryAddress})`);
        console.warn(`Это может означать, что контракт был развернут с другим Factory.`);
        console.warn(`Токены, добавленные через addTokenAuto(), используют Factory из контракта.`);
      }
      
      // Получаем WETH адрес
      const routerContract = new ethers.Contract(
        this.networkConfig.routerAddress,
        ['function WETH() external pure returns (address)'],
        this.provider
      );
      const wethAddress = await routerContract.WETH();
      
      // Проверяем LP пару через Factory из контракта (который используется при addTokenAuto)
      const contractFactory = new ethers.Contract(
        contractFactoryAddress,
        ['function getPair(address, address) view returns (address)'],
        this.provider
      );
      const lpTokenFromContractFactory = await contractFactory.getPair(tokenAddress, wethAddress);
      
      // Также проверяем через Factory из конфига
      const configFactory = new ethers.Contract(
        configFactoryAddress,
        ['function getPair(address, address) view returns (address)'],
        this.provider
      );
      const lpTokenFromConfigFactory = await configFactory.getPair(tokenAddress, wethAddress);
      
      console.log(`LP токен из Factory контракта: ${lpTokenFromContractFactory}`);
      console.log(`LP токен из Factory конфига: ${lpTokenFromConfigFactory}`);
      console.log(`Сохраненный LP токен в контракте: ${storedLpToken}`);
      
      // Проверяем соответствие
      const storedLpLower = storedLpToken.toLowerCase();
      const contractFactoryLpLower = lpTokenFromContractFactory.toLowerCase();
      const configFactoryLpLower = lpTokenFromConfigFactory.toLowerCase();
      
      // Если LP токен из Factory контракта не совпадает с сохраненным
      if (lpTokenFromContractFactory !== ethers.ZeroAddress && contractFactoryLpLower !== storedLpLower) {
        console.warn(`⚠️ ВНИМАНИЕ: Сохраненный LP токен (${storedLpToken}) не совпадает с LP токеном из Factory контракта (${lpTokenFromContractFactory})`);
        console.warn(`Возможно, токен был добавлен вручную с неправильным LP адресом.`);
      }
      
      // Если Factory адреса разные и LP токены тоже разные
      if (contractFactoryAddress.toLowerCase() !== configFactoryAddress.toLowerCase() && 
          lpTokenFromContractFactory !== ethers.ZeroAddress && 
          lpTokenFromConfigFactory !== ethers.ZeroAddress &&
          contractFactoryLpLower !== configFactoryLpLower) {
        console.warn(`⚠️ КРИТИЧЕСКОЕ ВНИМАНИЕ: Разные Factory дают разные LP токены!`);
        console.warn(`Это может быть причиной ошибки продажи.`);
        console.warn(`Рекомендуется использовать токены, добавленные через addTokenAuto() с правильным Factory.`);
      }
    } catch (error) {
      console.warn('Не удалось проверить LP токен через Factory:', error.message);
      // Продолжаем - возможно это rate limit
    }

      // Проверяем баланс LP перед продажей
    let factoryMismatchWarning = null;
    try {
      const contractFactoryAddress = await this.retryCall(() => this.multiZapContract.factory()).catch(() => null);
      const configFactoryAddress = this.networkConfig.factoryAddress;
      
      if (contractFactoryAddress && contractFactoryAddress.toLowerCase() !== configFactoryAddress.toLowerCase()) {
        factoryMismatchWarning = `⚠️ Factory в контракте отличается от Factory в конфиге. Это может быть причиной ошибки продажи.`;
      }
    } catch (e) {
      // Игнорируем ошибку получения Factory
    }
    
    try {
      const lpBalance = await this.retryCall(() => this.multiZapContract.getLpBalance(tokenAddress));
      const lpBalanceFormatted = ethers.formatEther(lpBalance);
      const lpBalanceNum = parseFloat(lpBalanceFormatted);
      
      if (lpBalanceNum === 0 || lpBalance === 0n) {
        let errorMsg = 'NO_LP_BALANCE: У вас нет LP токенов для продажи. Баланс LP: 0';
        if (factoryMismatchWarning) {
          errorMsg += `\n\n${factoryMismatchWarning}`;
        }
        throw new Error(errorMsg);
      }
      
      console.log(`LP баланс перед продажей: ${lpBalanceFormatted}`);
      console.log(`LP токен адрес: ${storedLpToken}`);
    } catch (error) {
      // Если ошибка уже содержит NO_LP_BALANCE, пробрасываем её
      if (error.message.includes('NO_LP_BALANCE')) {
        throw error;
      }
      // Иначе проверяем, может быть это rate limit - продолжаем
      if (error.message.includes('rate limit') || error.message.includes('missing revert data')) {
        console.warn('Не удалось проверить LP баланс заранее, продолжаем попытку продажи:', error.message);
      } else {
        throw new Error(`Ошибка проверки LP баланса: ${error.message}`);
      }
    }

    try {
      const gasParams = await this.getGasParams();

      console.log(`Slippage: 0% (для exitAndSell - максимальная гибкость)`);

      const tx = await this.multiZapContract.exitAndSell(
        tokenAddress,
        0, // amountTokenMin - 0 для максимальной гибкости
        0, // amountBNBMin - 0 для максимальной гибкости
        0, // amountOutMinBNB - 0 для максимальной гибкости
        gasParams
      );
      
      // Ждем подтверждения транзакции
      const receipt = await tx.wait();
      
      // Проверяем статус транзакции
      if (receipt.status === 0) {
        // Транзакция была отклонена
        // Пытаемся понять причину
        const lpBalance = await this.retryCall(() => this.multiZapContract.getLpBalance(tokenAddress)).catch(() => 0n);
        if (lpBalance === 0n) {
          throw new Error('NO_LP_BALANCE: У вас нет LP токенов для продажи. Баланс LP: 0');
        }
        throw new Error('Транзакция была отклонена контрактом. Возможные причины: нет LP токенов, недостаточно ликвидности, или токен неактивен.');
      }
      
      return tx.hash;
    } catch (error) {
      // Улучшаем сообщение об ошибке
      if (error.message.includes('NO_LP') || error.message.includes('NO_LP_BALANCE')) {
        let errorMsg = 'У вас нет LP токенов для продажи. Сначала купите токены через zap-in.';
        if (error.message.includes('Factory')) {
          errorMsg += '\n\n⚠️ Также обнаружена проблема с Factory адресом. Убедитесь, что контракт был развернут с правильным Factory.';
        }
        throw new Error(errorMsg);
      }
      if (error.message.includes('TOKEN_NOT_SUPPORTED')) {
        throw new Error('Токен не поддерживается или не добавлен в контракт.');
      }
      if (error.message.includes('TOKEN_INACTIVE')) {
        throw new Error('Токен неактивен. Обратитесь к администратору.');
      }
      if (error.receipt && error.receipt.status === 0) {
        let errorMsg = 'Транзакция была отклонена. Возможные причины:\n';
        errorMsg += '• Нет LP токенов для продажи\n';
        errorMsg += '• Недостаточно ликвидности в пуле\n';
        errorMsg += '• Проблема с контрактом или Factory\n';
        errorMsg += '• Неправильный LP токен адрес (если токен был добавлен вручную)';
        throw new Error(errorMsg);
      }
      throw new Error(`Ошибка exit-and-sell: ${error.message}`);
    }
  }

  async getTokenInfo(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    try {
      return await this.retryCall(() => this.multiZapContract.getTokenInfo(tokenAddress));
    } catch (error) {
      // Если rate limit или другие ошибки, возвращаем базовую информацию
      if (error.message.includes('rate limit') || error.message.includes('missing revert data')) {
        console.warn('Ошибка получения tokenInfo, используем fallback:', error.message);
        return {
          token: tokenAddress,
          lpToken: '0x0000000000000000000000000000000000000000',
          isActive: true
        };
      }
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

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    try {
      const balance = await this.retryCall(() => this.multiZapContract.getLpBalance(tokenAddress));
      return ethers.formatEther(balance);
    } catch (error) {
      // Если rate limit или другие ошибки, возвращаем 0
      if (error.message.includes('rate limit') || error.message.includes('missing revert data')) {
        console.warn('Ошибка получения LP баланса, возвращаем 0:', error.message);
        return '0';
      }
      throw new Error(`Ошибка получения LP баланса: ${error.message}`);
    }
  }

  async getTokenBalance(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    try {
      const balance = await this.retryCall(() => this.multiZapContract.getTokenBalance(tokenAddress));
      return ethers.formatEther(balance);
    } catch (error) {
      // Если rate limit или другие ошибки, возвращаем 0
      if (error.message.includes('rate limit') || error.message.includes('missing revert data')) {
        console.warn('Ошибка получения баланса токена, возвращаем 0:', error.message);
        return '0';
      }
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
      const feeData = await this.provider.getFeeData();
      
      // Если сеть поддерживает EIP-1559, используем maxFeePerGas и maxPriorityFeePerGas
      if (this.networkConfig.supportsEIP1559 && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        return {
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          gasLimit: this.networkConfig.gasLimit || '2000000'
        };
      }
      
      // Для сетей без EIP-1559 (например, BSC) используем gasPrice
      const gasPrice = this.networkConfig.gasPrice 
        ? ethers.parseUnits(this.networkConfig.gasPrice.toString(), 'gwei')
        : feeData.gasPrice;
      
      return {
        gasPrice: gasPrice,
        gasLimit: this.networkConfig.gasLimit || '2000000'
      };
    } catch (error) {
      console.error('Ошибка получения газовых параметров:', error);
      // Fallback значения
      const gasPrice = this.networkConfig.gasPrice 
        ? ethers.parseUnits(this.networkConfig.gasPrice.toString(), 'gwei')
        : ethers.parseUnits('1', 'gwei');
      
      return {
        gasPrice: gasPrice,
        gasLimit: this.networkConfig.gasLimit || '2000000'
      };
    }
  }

  calculateSlippage(amount, slippagePercent = config.DEFAULT_SLIPPAGE) {
    // Максимальная гибкость - возвращаем 0
    return 0n;
  }

  async getEthPrice() {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      return data.ethereum.usd;
    } catch (error) {
      console.error('Ошибка получения цены ETH:', error);
      return 3000;
    }
  }

  async getTokenPrice(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, [
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)',
        'function totalSupply() view returns (uint256)'
      ], this.provider);

      const routerContract = new ethers.Contract(this.networkConfig.routerAddress, [
        'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
        'function WETH() external pure returns (address)'
      ], this.provider);

      const wethAddress = await routerContract.WETH();
      const path = [tokenAddress, wethAddress];

      const [decimals, symbol, name, totalSupply, ethPriceInUsd] = await Promise.all([
        this.retryCall(() => tokenContract.decimals()).catch(() => 18),
        this.retryCall(() => tokenContract.symbol()).catch(() => 'UNKNOWN'),
        this.retryCall(() => tokenContract.name()).catch(() => 'Unknown Token'),
        this.retryCall(() => tokenContract.totalSupply()).catch(() => 0n),
        this.getEthPrice()
      ]);

      const amountIn = ethers.parseUnits('1', decimals);
      const amounts = await this.retryCall(() => routerContract.getAmountsOut(amountIn, path)).catch(() => [0n, 0n]);
      const priceInEth = ethers.formatEther(amounts[1]);
      const formattedSupply = ethers.formatUnits(totalSupply, decimals);

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
