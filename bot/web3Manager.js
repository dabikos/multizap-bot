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
    // Кэш для цены нативной валюты (храним 10 минут)
    this.nativePriceCache = {
      price: null,
      timestamp: 0,
      ttl: 10 * 60 * 1000 // 10 минут
    };
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

    if (!this.networkConfig.factoryAddress) {
      throw new Error('FACTORY_ADDRESS не определен в конфигурации сети');
    }

    if (!this.networkConfig.usdtAddress) {
      throw new Error('USDT_ADDRESS не определен в конфигурации сети');
    }

    try {
      console.log(`Развертывание контракта в сети ${this.currentNetwork}:`);
      console.log('ABI:', this.abi ? 'загружен' : 'не загружен');
      console.log('Bytecode:', this.bytecode ? 'загружен' : 'не загружен');
      console.log('Router Address:', this.networkConfig.routerAddress);
      console.log('Factory Address:', this.networkConfig.factoryAddress);
      console.log('USDT Address:', this.networkConfig.usdtAddress);
      console.log('Wallet Address:', this.wallet.address);

      const gasParams = await this.getGasParams();
      console.log('Gas params (raw):', gasParams);

      // Для Ethereum хотим жестко ограничить стоимость газа (дешевле деплой)
      // Устанавливаем очень низкие значения: 0.1 gwei maxFeePerGas и 0.05 gwei maxPriorityFeePerGas
      const deployOptions = { ...gasParams };
      if (this.currentNetwork === 'ETH') {
        // Используем очень низкие значения для экономии
        const maxFee = ethers.parseUnits('0.1', 'gwei');
        const maxPriority = ethers.parseUnits('0.05', 'gwei');
        deployOptions.maxFeePerGas = maxFee;
        deployOptions.maxPriorityFeePerGas = maxPriority;
        // Убираем gasPrice, чтобы не мешал EIP-1559
        if (deployOptions.gasPrice) {
          delete deployOptions.gasPrice;
        }
        console.log('Override gas for ETH deploy (low cost):', {
          maxFeePerGas: `${ethers.formatUnits(maxFee, 'gwei')} gwei`,
          maxPriorityFeePerGas: `${ethers.formatUnits(maxPriority, 'gwei')} gwei`
        });
      }

      // Для Ethereum используем меньший gasLimit для экономии
      // Для других сетей увеличиваем gasLimit для деплоя (контракт большой из-за viaIR)
      let baseGasLimit;
      if (this.currentNetwork === 'ETH') {
        // Для Ethereum используем минимально необходимый gasLimit (контракт использует ~2.9M)
        baseGasLimit = BigInt(3000000); // Немного больше реального использования (2.9M)
      } else {
        // Пробуем estimateGas для точного расчёта (особенно важно для L2 сетей как MegaETH)
        try {
          const MultiZapFactory = new ethers.ContractFactory(this.abi, this.bytecode, this.wallet);
          const deployTx = await MultiZapFactory.getDeployTransaction(
            ethers.getAddress(this.networkConfig.routerAddress),
            ethers.getAddress(this.networkConfig.factoryAddress),
            ethers.getAddress(this.networkConfig.usdtAddress)
          );
          const estimated = await this.provider.estimateGas({
            from: this.wallet.address,
            data: deployTx.data
          });
          // Добавляем 20% запас
          baseGasLimit = estimated + (estimated / 5n);
          console.log(`EstimateGas для деплоя: ${estimated.toString()}, с запасом: ${baseGasLimit.toString()}`);
        } catch (estError) {
          console.warn('⚠️ Не удалось estimateGas, используем расчётный лимит:', estError.message);
          baseGasLimit = deployOptions.gasLimit 
            ? (typeof deployOptions.gasLimit === 'string' ? BigInt(deployOptions.gasLimit) : deployOptions.gasLimit)
            : BigInt(2000000);
          // Увеличиваем gasLimit в 2 раза для деплоя (для других сетей)
          baseGasLimit = baseGasLimit * 2n;
        }
      }
      
      deployOptions.gasLimit = baseGasLimit;
      console.log(`Gas limit для деплоя: ${deployOptions.gasLimit.toString()}`);

      // Проверяем адреса перед деплоем
      const routerAddr = ethers.getAddress(this.networkConfig.routerAddress);
      const factoryAddr = ethers.getAddress(this.networkConfig.factoryAddress);
      const usdtAddr = ethers.getAddress(this.networkConfig.usdtAddress);
      
      // Определяем WETH адрес (роутеры могут использовать WETH() или WETH9())
      const wethAddr = await this.getWethAddress();
      
      console.log('Проверка адресов:');
      console.log('  Router:', routerAddr);
      console.log('  Factory:', factoryAddr);
      console.log('  USDT:', usdtAddr);
      console.log('  WETH:', wethAddr);

      const MultiZapFactory = new ethers.ContractFactory(this.abi, this.bytecode, this.wallet);
      const multiZap = await MultiZapFactory.deploy(
        routerAddr,
        factoryAddr,
        usdtAddr,
        wethAddr,
        deployOptions  // Опции передаются как 5-й аргумент
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

  async addToken(tokenAddress, lpTokenAddress, baseTokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }
    if (!ethers.isAddress(lpTokenAddress)) {
      throw new Error('Неверный адрес LP токена');
    }
    if (!ethers.isAddress(baseTokenAddress)) {
      throw new Error('Неверный адрес базового токена');
    }

    try {
      const gasParams = await this.getGasParams();
      const tx = await this.multiZapContract.addToken(tokenAddress, lpTokenAddress, baseTokenAddress, gasParams);
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Ошибка добавления токена: ${error.message}`);
    }
  }

  async addTokenAuto(tokenAddress, useUSDT = false) {
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
      
      const wethAddress = await this.getWethAddress();
      const baseTokenAddress = useUSDT ? (this.networkConfig.usdtAddress || ethers.ZeroAddress) : wethAddress;
      
      if (useUSDT && baseTokenAddress === ethers.ZeroAddress) {
        throw new Error('USDT_ADDRESS_NOT_SET: Адрес USDT не настроен в конфигурации сети');
      }
      
      const lpPair = await factoryContract.getPair(tokenAddress, baseTokenAddress);
      const baseTokenName = useUSDT ? 'USDT' : 'WETH/WBNB';
      
      if (lpPair === ethers.ZeroAddress) {
        throw new Error(`LP_PAIR_NOT_FOUND: Для токена ${tokenAddress} не найдена LP пара с ${baseTokenName} (${baseTokenAddress}). Возможно, токен новый и пара еще не создана, или используется другой DEX. Попробуйте добавить токен вручную с указанием LP адреса.`);
      }
    } catch (error) {
      // Если ошибка уже содержит LP_PAIR_NOT_FOUND или USDT_ADDRESS_NOT_SET, пробрасываем её дальше
      if (error.message.includes('LP_PAIR_NOT_FOUND') || error.message.includes('USDT_ADDRESS_NOT_SET')) {
        throw error;
      }
      // Иначе продолжаем - возможно проблема с подключением, но попробуем добавить
      console.warn('Предупреждение: не удалось проверить LP пару заранее:', error.message);
    }

    try {
      const gasParams = await this.getGasParams();
      const tx = await this.multiZapContract.addTokenAuto(tokenAddress, useUSDT, gasParams);
      
      // Для Ethereum и Base используем более быструю проверку (1 подтверждение)
      // Для BSC можно использовать больше подтверждений
      const confirmations = this.networkConfig.supportsEIP1559 ? 1 : 1;
      await tx.wait(confirmations);
      
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

    // Проверяем, что токен добавлен и активен
    let tokenInfo;
    try {
      tokenInfo = await this.retryCall(() => this.multiZapContract.getTokenInfo(tokenAddress));
    } catch (error) {
      if (error.message.includes('rate limit') || error.message.includes('missing revert data')) {
        console.warn('Не удалось проверить токен заранее, продолжаем:', error.message);
      } else {
        throw new Error(`Ошибка получения информации о токене: ${error.message}`);
      }
    }

    if (tokenInfo) {
      if (tokenInfo.token === ethers.ZeroAddress) {
        throw new Error('TOKEN_NOT_SUPPORTED: Токен не добавлен в контракт. Сначала добавьте токен через /addtoken');
      }
      if (!tokenInfo.isActive) {
        throw new Error('TOKEN_INACTIVE: Токен неактивен. Обратитесь к администратору.');
      }
      console.log(`Токен проверен: ${tokenInfo.token}, LP: ${tokenInfo.lpToken}, Активен: ${tokenInfo.isActive}`);
    }

    // Проверяем баланс кошелька
    try {
      const walletBalance = await this.getWalletBalance();
      const walletBalanceNum = parseFloat(walletBalance);
      if (walletBalanceNum < amountEth) {
        throw new Error(`Недостаточно средств. Баланс: ${walletBalance} ${this.networkConfig.nativeCurrency}, требуется: ${amountEth} ${this.networkConfig.nativeCurrency}`);
      }
      console.log(`Баланс кошелька: ${walletBalance} ${this.networkConfig.nativeCurrency}`);
    } catch (error) {
      if (!error.message.includes('Недостаточно средств')) {
        console.warn('Не удалось проверить баланс заранее:', error.message);
      } else {
        throw error;
      }
    }

    try {
      const amountWei = ethers.parseEther(amountEth.toString());
      const gasParams = await this.getGasParams();

      // 20% slippage - используем 80% от сумм
      const halfAmount = amountWei / 2n;
      const amountOutMinToken = 0n;
      const amountTokenMin = 0n;
      const amountBNBMin = 0n;

      console.log(`Slippage: 0% (минимумы установлены в 0 для максимальной гибкости)`);
      console.log(`Amount Out Min Token: ${ethers.formatEther(amountOutMinToken)} ${this.networkConfig.nativeCurrency}`);
      console.log(`Amount Token Min: ${ethers.formatEther(amountTokenMin)} ${this.networkConfig.nativeCurrency}`);
      console.log(`Amount ${this.networkConfig.nativeCurrency} Min: ${ethers.formatEther(amountBNBMin)} ${this.networkConfig.nativeCurrency}`);
      console.log(`Сумма покупки: ${amountEth} ${this.networkConfig.nativeCurrency} (${amountWei.toString()} wei)`);
      console.log(`Адрес контракта: ${await this.multiZapContract.getAddress()}`);
      console.log(`Адрес кошелька: ${this.wallet.address}`);
      console.log(`Адрес токена: ${tokenAddress}`);

      // Проверяем баланс перед отправкой транзакции
      const balance = await this.provider.getBalance(this.wallet.address);
      const estimatedGas = gasParams.gasLimit 
        ? (typeof gasParams.gasLimit === 'string' ? BigInt(gasParams.gasLimit) : BigInt(gasParams.gasLimit))
        : BigInt(500000);
      
      let estimatedGasCost;
      if (this.networkConfig.supportsEIP1559 && gasParams.maxFeePerGas) {
        estimatedGasCost = estimatedGas * gasParams.maxFeePerGas;
      } else if (gasParams.gasPrice) {
        estimatedGasCost = estimatedGas * gasParams.gasPrice;
      } else {
        // Fallback оценка
        estimatedGasCost = estimatedGas * ethers.parseUnits('50', 'gwei');
      }
      
      const totalNeeded = amountWei + estimatedGasCost;
      
      if (balance < totalNeeded) {
        const balanceEth = ethers.formatEther(balance);
        const neededEth = ethers.formatEther(totalNeeded);
        throw new Error(`Недостаточно средств для транзакции. Баланс: ${balanceEth} ${this.networkConfig.nativeCurrency}, требуется: ${neededEth} ${this.networkConfig.nativeCurrency} (включая газ)`);
      }
      
      console.log(`Gas params:`, gasParams);
      console.log(`Estimated gas cost: ${ethers.formatEther(estimatedGasCost)} ${this.networkConfig.nativeCurrency}`);
      console.log(`Total needed: ${ethers.formatEther(totalNeeded)} ${this.networkConfig.nativeCurrency}`);
      
      // Отправляем транзакцию (ethers.js автоматически оценит газ)
      console.log('Отправка транзакции...');
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
      console.log(`Транзакция отправлена: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      // Проверяем статус транзакции
      if (receipt.status === 0) {
        throw new Error('Транзакция была отклонена контрактом. Возможные причины: токен не поддерживается, токен неактивен, недостаточно ликвидности в пуле.');
      }
      
      return tx.hash;
    } catch (error) {
      // Улучшаем сообщение об ошибке
      let errorMessage = error.message || 'Неизвестная ошибка';
      
      console.error('Детали ошибки zap-in:', {
        message: error.message,
        reason: error.reason,
        code: error.code,
        data: error.data,
        error: error
      });
      
      // Обработка специфических ошибок отправки транзакции
      if (error.code === 'UNKNOWN_ERROR' || error.message?.includes('failed to send tx') || error.message?.includes('could not coalesce')) {
        // Проверяем баланс и параметры газа
        try {
          const balance = await this.provider.getBalance(this.wallet.address);
          const balanceEth = ethers.formatEther(balance);
          
          // Получаем текущие параметры газа
          const gasParams = await this.getGasParams();
          console.error('Gas params при ошибке:', gasParams);
          
          if (this.networkConfig.supportsEIP1559) {
            if (!gasParams.maxFeePerGas || !gasParams.maxPriorityFeePerGas) {
              errorMessage = `Ошибка отправки транзакции: параметры газа для EIP-1559 не установлены. Попробуйте позже или проверьте RPC провайдер.`;
            } else {
              const maxFeeGwei = ethers.formatUnits(gasParams.maxFeePerGas, 'gwei');
              const priorityFeeGwei = ethers.formatUnits(gasParams.maxPriorityFeePerGas, 'gwei');
              
              errorMessage = `Ошибка отправки транзакции. Возможные причины:\n` +
                `• Недостаточно средств для оплаты газа (баланс: ${balanceEth} ${this.networkConfig.nativeCurrency})\n` +
                `• Слишком низкий maxFeePerGas (${maxFeeGwei} gwei) - попробуйте позже\n` +
                `• Проблемы с RPC провайдером\n` +
                `• Попробуйте увеличить сумму покупки или подождите`;
            }
          } else {
            if (!gasParams.gasPrice) {
              errorMessage = `Ошибка отправки транзакции: gasPrice не установлен. Попробуйте позже или проверьте RPC провайдер.`;
            } else {
              const gasPriceGwei = ethers.formatUnits(gasParams.gasPrice, 'gwei');
              
              errorMessage = `Ошибка отправки транзакции. Возможные причины:\n` +
                `• Недостаточно средств для оплаты газа (баланс: ${balanceEth} ${this.networkConfig.nativeCurrency})\n` +
                `• Слишком низкий gasPrice (${gasPriceGwei} gwei) - попробуйте позже\n` +
                `• Проблемы с RPC провайдером\n` +
                `• Попробуйте увеличить сумму покупки или подождите`;
            }
          }
        } catch (balanceError) {
          errorMessage = `Ошибка отправки транзакции: ${error.message}. Не удалось проверить баланс: ${balanceError.message}`;
        }
      }
      
      // Парсим ошибки из контракта
      if (errorMessage.includes('TOKEN_NOT_SUPPORTED') || errorMessage.includes('token not supported')) {
        errorMessage = 'Токен не добавлен в контракт. Сначала добавьте токен через /addtoken';
      } else if (errorMessage.includes('TOKEN_INACTIVE') || errorMessage.includes('token inactive')) {
        errorMessage = 'Токен неактивен. Обратитесь к администратору.';
      } else if (errorMessage.includes('NO_BNB') || errorMessage.includes('NO_ETH') || errorMessage.includes('no bnb') || errorMessage.includes('no eth')) {
        errorMessage = 'Недостаточно средств для покупки. Проверьте баланс кошелька.';
      } else if (errorMessage.includes('NO_TOKENS_RECEIVED') || errorMessage.includes('no tokens received')) {
        errorMessage = 'Не удалось получить токены после свопа. Возможно, недостаточно ликвидности в пуле или проблема с токеном.';
      } else if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
        errorMessage = 'Недостаточно средств для оплаты газа и покупки. Проверьте баланс кошелька.';
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('user denied')) {
        errorMessage = 'Транзакция отклонена пользователем.';
      } else if (errorMessage.includes('replacement fee too low')) {
        errorMessage = 'Комиссия за транзакцию слишком низкая. Попробуйте увеличить gas price.';
      } else if (errorMessage.includes('nonce too low')) {
        errorMessage = 'Ошибка nonce. Попробуйте еще раз через несколько секунд.';
      } else if (errorMessage.includes('execution reverted')) {
        // Пытаемся извлечь причину revert
        const revertMatch = errorMessage.match(/execution reverted:?\s*(.+)/i);
        if (revertMatch) {
          errorMessage = `Транзакция отклонена контрактом: ${revertMatch[1]}`;
        } else {
          errorMessage = 'Транзакция отклонена контрактом. Возможные причины: токен не поддерживается, токен неактивен, недостаточно ликвидности в пуле.';
        }
      } else if (error.reason) {
        // Если есть reason в ошибке, используем его
        errorMessage = error.reason;
      } else if (error.data && error.data.message) {
        // Если есть data.message, используем его
        errorMessage = error.data.message;
      }
      
      throw new Error(`Ошибка zap-in: ${errorMessage}`);
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
    const baseToken = tokenInfo.baseToken;
    console.log(`Сохраненный LP токен в контракте: ${storedLpToken}`);
    console.log(`Base token (тип пары): ${baseToken}`);
    
    // Проверяем, что baseToken установлен (для старых токенов может быть address(0))
    if (!baseToken || baseToken === ethers.ZeroAddress) {
      throw new Error('BASE_TOKEN_NOT_SET: Токен был добавлен до обновления контракта. Пожалуйста, удалите токен и добавьте его заново через /addtoken с указанием типа пары (WBNB или USDT).');
    }

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
        let errorDetails = [];
        
        try {
          const lpBalance = await this.retryCall(() => this.multiZapContract.getLpBalance(tokenAddress)).catch(() => 0n);
          if (lpBalance === 0n) {
            errorDetails.push('Нет LP токенов для продажи (баланс LP: 0)');
          }
        } catch (e) {
          // Игнорируем ошибку проверки баланса
        }
        
        try {
          const tokenInfo = await this.retryCall(() => this.multiZapContract.getTokenInfo(tokenAddress)).catch(() => null);
          if (tokenInfo && (!tokenInfo.baseToken || tokenInfo.baseToken === ethers.ZeroAddress)) {
            errorDetails.push('Токен был добавлен до обновления контракта (baseToken не установлен). Удалите токен и добавьте заново через /addtoken');
          }
          if (tokenInfo && !tokenInfo.isActive) {
            errorDetails.push('Токен неактивен');
          }
        } catch (e) {
          // Игнорируем ошибку получения информации
        }
        
        let errorMsg = 'Транзакция была отклонена контрактом.';
        if (errorDetails.length > 0) {
          errorMsg += '\n\nВозможные причины:\n• ' + errorDetails.join('\n• ');
        } else {
          errorMsg += '\n\nВозможные причины:\n• Нет LP токенов для продажи\n• Недостаточно ликвидности в пуле\n• Токен неактивен\n• Токен был добавлен до обновления контракта (baseToken не установлен)';
        }
        
        throw new Error(errorMsg);
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

  async exitAndSellPartial(tokenAddress, percent, slippagePercent = config.DEFAULT_SLIPPAGE) {
    if (!this.multiZapContract) {
      throw new Error('Контракт не подключен');
    }

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Неверный адрес токена');
    }

    // ВАЖНО: Проверяем, что percent не является дробным числом (например, 0.05 вместо 5)
    // Если percent меньше 1, это может быть ошибка (например, 0.05 вместо 5)
    if (typeof percent === 'number' && percent < 1 && percent > 0) {
      throw new Error(`Похоже, что передан дробный процент (${percent}) вместо целого числа. Используйте целые числа: 5, 25, 50, 75`);
    }

    // Убеждаемся, что percent - это целое число
    let percentInt;
    if (typeof percent === 'string') {
      percentInt = parseInt(percent, 10);
      if (isNaN(percentInt)) {
        throw new Error(`Неверный формат процента (строка): "${percent}"`);
      }
    } else if (typeof percent === 'number') {
      // Проверяем, что это целое число, а не дробное
      if (!Number.isInteger(percent)) {
        throw new Error(`Процент должен быть целым числом, получено: ${percent}`);
      }
      percentInt = Math.floor(percent);
    } else {
      // Если это BigInt или другой тип, конвертируем в число
      percentInt = Number(percent);
      if (isNaN(percentInt)) {
        throw new Error(`Неверный формат процента: ${percent} (тип: ${typeof percent})`);
      }
      if (!Number.isInteger(percentInt)) {
        throw new Error(`Процент должен быть целым числом, получено: ${percentInt}`);
      }
      percentInt = Math.floor(percentInt);
    }
    
    // Проверяем, что percentInt - это целое число от 1 до 100
    if (isNaN(percentInt) || !Number.isInteger(percentInt) || percentInt < 1 || percentInt > 100) {
      throw new Error(`Неверный процент: ${percentInt} (исходный: ${percent}, тип: ${typeof percent}). Доступные значения: 5, 25, 50, 75`);
    }
    
    if (![5, 25, 50, 75].includes(percentInt)) {
      throw new Error(`Неверный процент: ${percentInt} (исходный: ${percent}). Доступные значения: 5, 25, 50, 75`);
    }
    
    console.log(`exitAndSellPartial: percent=${percent} (тип: ${typeof percent}), percentInt=${percentInt} (тип: ${typeof percentInt}, isInteger: ${Number.isInteger(percentInt)})`);

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

    const baseToken = tokenInfo.baseToken;
    
    // Проверяем, что baseToken установлен
    if (!baseToken || baseToken === ethers.ZeroAddress) {
      throw new Error('BASE_TOKEN_NOT_SET: Токен был добавлен до обновления контракта. Пожалуйста, удалите токен и добавьте его заново через /addtoken с указанием типа пары (WBNB или USDT).');
    }

    // Получаем баланс LP токенов
    let lpBalance;
    try {
      lpBalance = await this.retryCall(() => this.multiZapContract.getLpBalance(tokenAddress));
    } catch (error) {
      throw new Error(`Ошибка получения баланса LP токенов: ${error.message}`);
    }

    if (lpBalance === 0n) {
      throw new Error('Нет LP токенов для продажи');
    }

    // Вычисляем количество LP токенов для продажи
    // Убеждаемся, что percentInt - это целое число перед конвертацией в BigInt
    const percentForCalculation = Number.isInteger(percentInt) ? percentInt : Math.floor(Number(percentInt));
    
    if (!Number.isInteger(percentForCalculation) || percentForCalculation < 1 || percentForCalculation > 100) {
      throw new Error(`Неверный процент для вычислений: ${percentForCalculation} (исходный: ${percent}, тип: ${typeof percent})`);
    }
    
    console.log(`Вычисление lpToSell: lpBalance=${lpBalance}, percentForCalculation=${percentForCalculation} (тип: ${typeof percentForCalculation})`);
    
    // Используем percentForCalculation для вычислений
    const lpToSell = (lpBalance * BigInt(percentForCalculation)) / 100n;
    if (lpToSell === 0n) {
      throw new Error('Недостаточно LP токенов для продажи выбранного процента');
    }

    // Подготавливаем параметры газа
    // Используем getGasParams() для правильной обработки EIP-1559 (Ethereum, Base)
    // Это важно, так как для Ethereum и Base gasPrice может быть null
    const gasParams = await this.getGasParams();
    
    // Увеличиваем gasLimit для частичной продажи
    const baseGasLimit = gasParams.gasLimit 
      ? (typeof gasParams.gasLimit === 'string' ? BigInt(gasParams.gasLimit) : BigInt(gasParams.gasLimit))
      : BigInt(500000);
    
    // Обновляем gasLimit в gasParams
    if (this.networkConfig.supportsEIP1559) {
      gasParams.gasLimit = baseGasLimit;
    } else {
      gasParams.gasLimit = baseGasLimit;
    }

    try {
      // Убеждаемся, что percentInt - это целое число (не дробное)
      // Конвертируем в число и проверяем, что это целое число
      const percentNumber = Number(percentInt);
      if (!Number.isInteger(percentNumber) || percentNumber < 1 || percentNumber > 100) {
        throw new Error(`Неверный процент для контракта: ${percentNumber} (тип: ${typeof percentNumber})`);
      }
      
      // Убеждаемся, что это именно целое число, а не дробное
      const percentForContract = Math.floor(percentNumber);
      
      if (percentForContract !== percentNumber) {
        throw new Error(`Процент должен быть целым числом, получено: ${percentNumber}`);
      }
      
      // Проверяем, что это одно из допустимых значений
      if (![5, 25, 50, 75].includes(percentForContract)) {
        throw new Error(`Неверный процент: ${percentForContract}. Доступные значения: 5, 25, 50, 75`);
      }
      
      console.log(`Вызов exitAndSellPartial с параметрами: tokenAddress=${tokenAddress}, percent=${percentForContract} (тип: ${typeof percentForContract}, isInteger: ${Number.isInteger(percentForContract)})`);
      
      const tx = await this.multiZapContract.exitAndSellPartial(
        tokenAddress,
        percentForContract, // Явно передаем целое число
        0, // amountTokenMin - 0 для максимальной гибкости
        0, // amountBNBMin - 0 для максимальной гибкости
        0, // amountOutMinBNB - 0 для максимальной гибкости
        gasParams
      );
      
      // Ждем подтверждения транзакции
      // Для Ethereum и Base используем 1 подтверждение для ускорения
      // Для BSC можно использовать больше подтверждений
      const confirmations = this.networkConfig.supportsEIP1559 ? 1 : 1;
      const receipt = await tx.wait(confirmations);
      
      // Проверяем статус транзакции
      if (receipt.status === 0) {
        throw new Error('Транзакция была отклонена контрактом');
      }
      
      return tx.hash;
    } catch (error) {
      // Улучшаем сообщение об ошибке
      if (error.message.includes('user rejected') || error.message.includes('User denied')) {
        throw new Error('Транзакция отклонена пользователем');
      }
      if (error.message.includes('NO_LP') || error.message.includes('NO_LP_BALANCE')) {
        throw new Error('У вас нет LP токенов для продажи. Сначала купите токены через zap-in.');
      }
      if (error.message.includes('INVALID_PERCENT')) {
        throw new Error('Неверный процент. Доступные значения: 5, 25, 50, 75');
      }
      if (error.message.includes('INSUFFICIENT_LP_TO_SELL')) {
        throw new Error('Недостаточно LP токенов для продажи выбранного процента');
      }
      if (error.receipt && error.receipt.status === 0) {
        throw new Error('Транзакция была отклонена. Возможные причины:\n• Недостаточно ликвидности в пуле\n• Проблема с контрактом');
      }
      throw new Error(`Ошибка частичной продажи: ${error.message}`);
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
      if (this.networkConfig.supportsEIP1559) {
        // Для Ethereum и Base используем динамические значения из сети
        if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
          // Увеличиваем maxFeePerGas на 50% для надежности (Ethereum может быть очень загружен)
          const maxFeePerGas = feeData.maxFeePerGas + (feeData.maxFeePerGas / 2n);
          // Увеличиваем maxPriorityFeePerGas на 30% для более быстрого включения в блок
          const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas + (feeData.maxPriorityFeePerGas * 3n / 10n);
          
          return {
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            gasLimit: this.networkConfig.gasLimit || '2000000'
          };
        } else {
          // Fallback для EIP-1559 сетей, если не получили данные
          // Используем разумные значения по умолчанию для каждой сети
          let defaultMaxFeePerGas, defaultMaxPriorityFeePerGas;
          
          if (this.currentNetwork === 'MEGAETH') {
            // MegaETH: очень низкие комиссии (OP Stack, base fee ~0.001 gwei)
            defaultMaxFeePerGas = ethers.parseUnits('0.1', 'gwei'); // 0.1 gwei
            defaultMaxPriorityFeePerGas = ethers.parseUnits('0.01', 'gwei'); // 0.01 gwei
          } else {
            defaultMaxFeePerGas = ethers.parseUnits('50', 'gwei'); // 50 gwei
            defaultMaxPriorityFeePerGas = ethers.parseUnits('2', 'gwei'); // 2 gwei
          }
          
          console.warn('⚠️ Не удалось получить feeData для EIP-1559, используем значения по умолчанию');
          return {
            maxFeePerGas: defaultMaxFeePerGas,
            maxPriorityFeePerGas: defaultMaxPriorityFeePerGas,
            gasLimit: this.networkConfig.gasLimit || '2000000'
          };
        }
      }
      
      // Для сетей без EIP-1559 (например, BSC) используем gasPrice из конфига
      const gasPriceConfig = this.networkConfig.gasPrice;
      let gasPrice;
      
      if (gasPriceConfig) {
        gasPrice = ethers.parseUnits(gasPriceConfig.toString(), 'gwei');
      } else if (feeData.gasPrice) {
        gasPrice = feeData.gasPrice;
      } else {
        // Fallback для сетей без EIP-1559
        gasPrice = ethers.parseUnits('0.05', 'gwei');
      }
      
      console.log(`Gas price из конфига: ${gasPriceConfig || 'auto'} gwei`);
      console.log(`Gas price в wei: ${gasPrice.toString()}`);
      
      return {
        gasPrice: gasPrice,
        gasLimit: this.networkConfig.gasLimit || '2000000'
      };
    } catch (error) {
      console.error('Ошибка получения газовых параметров:', error);
      
      // Fallback значения в зависимости от типа сети
      if (this.networkConfig.supportsEIP1559) {
        // Для EIP-1559 сетей используем maxFeePerGas и maxPriorityFeePerGas
        let defaultMaxFeePerGas, defaultMaxPriorityFeePerGas;
        
        if (this.currentNetwork === 'MEGAETH') {
          defaultMaxFeePerGas = ethers.parseUnits('0.1', 'gwei');
          defaultMaxPriorityFeePerGas = ethers.parseUnits('0.01', 'gwei');
        } else {
          defaultMaxFeePerGas = ethers.parseUnits('50', 'gwei');
          defaultMaxPriorityFeePerGas = ethers.parseUnits('2', 'gwei');
        }
        
        console.log(`Fallback для EIP-1559: maxFeePerGas=${defaultMaxFeePerGas}, maxPriorityFeePerGas=${defaultMaxPriorityFeePerGas}`);
        
        return {
          maxFeePerGas: defaultMaxFeePerGas,
          maxPriorityFeePerGas: defaultMaxPriorityFeePerGas,
          gasLimit: this.networkConfig.gasLimit || '2000000'
        };
      } else {
        // Для сетей без EIP-1559 используем gasPrice
        const gasPriceConfig = this.networkConfig.gasPrice || '0.05';
        const gasPrice = ethers.parseUnits(gasPriceConfig.toString(), 'gwei');
        
        console.log(`Fallback gas price из конфига: ${gasPriceConfig} gwei`);
        console.log(`Fallback gas price в wei: ${gasPrice.toString()}`);
        
        return {
          gasPrice: gasPrice,
          gasLimit: this.networkConfig.gasLimit || '2000000'
        };
      }
    }
  }

  calculateSlippage(amount, slippagePercent = config.DEFAULT_SLIPPAGE) {
    // Максимальная гибкость - возвращаем 0
    return 0n;
  }

  /**
   * Определяет WETH адрес роутера (поддержка WETH() и WETH9())
   */
  async getWethAddress() {
    const routerAddr = this.networkConfig.routerAddress;
    
    // Сначала пробуем WETH() (стандарт Uniswap V2)
    try {
      const routerWETH = new ethers.Contract(
        routerAddr,
        ['function WETH() external pure returns (address)'],
        this.provider
      );
      const weth = await routerWETH.WETH();
      if (weth && weth !== ethers.ZeroAddress) {
        console.log(`WETH адрес (через WETH()): ${weth}`);
        return weth;
      }
    } catch (e) {
      // WETH() не поддерживается, пробуем WETH9()
    }
    
    // Затем пробуем WETH9() (Kumbaya, некоторые V3 роутеры)
    try {
      const routerWETH9 = new ethers.Contract(
        routerAddr,
        ['function WETH9() external pure returns (address)'],
        this.provider
      );
      const weth = await routerWETH9.WETH9();
      if (weth && weth !== ethers.ZeroAddress) {
        console.log(`WETH адрес (через WETH9()): ${weth}`);
        return weth;
      }
    } catch (e) {
      // WETH9() тоже не поддерживается
    }
    
    // Fallback: используем известный WETH адрес для OP Stack сетей
    if (this.currentNetwork === 'MEGAETH' || this.currentNetwork === 'BASE') {
      const fallbackWeth = '0x4200000000000000000000000000000000000006';
      console.log(`WETH адрес (fallback для ${this.currentNetwork}): ${fallbackWeth}`);
      return fallbackWeth;
    }
    
    throw new Error('Не удалось определить WETH адрес роутера');
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

  async getNativePrice() {
    // Проверяем кэш
    const now = Date.now();
    if (this.nativePriceCache.price && (now - this.nativePriceCache.timestamp) < this.nativePriceCache.ttl) {
      return this.nativePriceCache.price;
    }
    
    try {
      // Получаем адрес WBNB/WETH для текущей сети
      const routerContract = new ethers.Contract(this.networkConfig.routerAddress, [
        'function WETH() external pure returns (address)'
      ], this.provider);
      
      const wethAddress = await this.retryCall(() => routerContract.WETH());
      
      // Получаем цену нативной валюты через DEXScreener
      const chainIdMap = {
        'ETH': 'ethereum',
        'BSC': 'bsc',
        'BASE': 'base',
        'MONAD': 'monad',
        'MEGAETH': 'megaeth'
      };
      
      const chainId = chainIdMap[this.currentNetwork] || 'bsc';
      const url = `https://api.dexscreener.com/latest/dex/tokens/${wethAddress}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`DEXScreener API returned status ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.pairs || data.pairs.length === 0) {
        throw new Error('No pairs found for native currency');
      }
      
      // Находим пару с наибольшей ликвидностью для текущей сети
      const pairsForNetwork = data.pairs.filter(pair => {
        const pairChainId = pair.chainId?.toLowerCase();
        return pairChainId === chainId || 
               (chainId === 'bsc' && pairChainId === 'binance') ||
               (chainId === 'ethereum' && pairChainId === 'eth');
      });
      
      if (pairsForNetwork.length === 0) {
        throw new Error('No pair found for current network');
      }
      
      // Сортируем по ликвидности
      const bestPair = pairsForNetwork.sort((a, b) => {
        const liquidityA = parseFloat(a.liquidity?.usd || 0);
        const liquidityB = parseFloat(b.liquidity?.usd || 0);
        return liquidityB - liquidityA;
      })[0];
      
      const priceUsd = parseFloat(bestPair.priceUsd || 0);
      
      if (!priceUsd || priceUsd === 0) {
        throw new Error('Invalid price from DEXScreener');
      }
      
      // Сохраняем в кэш
      this.nativePriceCache.price = priceUsd;
      this.nativePriceCache.timestamp = Date.now();
      
      return priceUsd;
    } catch (error) {
      console.error(`Ошибка получения цены ${this.networkConfig.nativeCurrency} через DEXScreener:`, error);
      
      // Если есть кэш, используем его даже если он старый
      if (this.nativePriceCache.price) {
        console.log(`Используем кэшированную цену ${this.networkConfig.nativeCurrency}: ${this.nativePriceCache.price}`);
        return this.nativePriceCache.price;
      }
      
      // Fallback значения
      switch (this.currentNetwork) {
        case 'BSC':
          return 600; // Примерная цена BNB
        case 'BASE':
        case 'ETH':
        case 'MEGAETH':
          return 3000; // Примерная цена ETH
        default:
          return 3000;
      }
    }
  }

  async getTokenPriceFromDexScreener(tokenAddress) {
    try {
      // Маппинг chainId для DEXScreener
      const chainIdMap = {
        'ETH': 'ethereum',
        'BSC': 'bsc',
        'BASE': 'base',
        'MONAD': 'monad',
        'MEGAETH': 'megaeth'
      };
      
      const chainId = chainIdMap[this.currentNetwork] || 'bsc';
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`DEXScreener API returned status ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.pairs || data.pairs.length === 0) {
        throw new Error('No pairs found for token');
      }
      
      // Находим пару с наибольшей ликвидностью для текущей сети
      const pairsForNetwork = data.pairs.filter(pair => {
        const pairChainId = pair.chainId?.toLowerCase();
        return pairChainId === chainId || 
               (chainId === 'bsc' && pairChainId === 'binance') ||
               (chainId === 'ethereum' && pairChainId === 'eth');
      });
      
      if (pairsForNetwork.length === 0) {
        throw new Error('No pair found for current network');
      }
      
      // Сортируем по ликвидности
      const bestPair = pairsForNetwork.sort((a, b) => {
        const liquidityA = parseFloat(a.liquidity?.usd || 0);
        const liquidityB = parseFloat(b.liquidity?.usd || 0);
        return liquidityB - liquidityA;
      })[0];
      
      const priceUsd = parseFloat(bestPair.priceUsd || 0);
      const priceNative = parseFloat(bestPair.priceNative || 0);
      
      if (!priceUsd || priceUsd === 0) {
        throw new Error('Invalid price from DEXScreener');
      }
      
      // Получаем базовую информацию о токене из блокчейна
      const tokenContract = new ethers.Contract(tokenAddress, [
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)',
        'function totalSupply() view returns (uint256)'
      ], this.provider);
      
      const [decimals, symbol, name, totalSupply] = await Promise.all([
        this.retryCall(() => tokenContract.decimals()).catch(() => 18),
        this.retryCall(() => tokenContract.symbol()).catch(() => bestPair.baseToken?.symbol || 'UNKNOWN'),
        this.retryCall(() => tokenContract.name()).catch(() => bestPair.baseToken?.name || 'Unknown Token'),
        this.retryCall(() => tokenContract.totalSupply()).catch(() => 0n)
      ]);
      
      const formattedSupply = ethers.formatUnits(totalSupply, decimals);
      const marketCapInUsd = priceUsd * parseFloat(formattedSupply);
      
      // Получаем цену нативной валюты для отображения
      // Если priceNative есть из DEXScreener, вычисляем цену нативной валюты из него
      let nativePriceInUsd;
      if (priceNative && priceNative > 0 && priceUsd > 0) {
        // Вычисляем цену нативной валюты: priceUsd / priceNative
        nativePriceInUsd = priceUsd / priceNative;
        // Обновляем кэш
        this.nativePriceCache.price = nativePriceInUsd;
        this.nativePriceCache.timestamp = Date.now();
      } else {
        // Fallback на getNativePrice через DEXScreener (с кэшем)
        nativePriceInUsd = await this.getNativePrice().catch(() => {
          switch (this.currentNetwork) {
            case 'BSC': return 600;
            case 'BASE':
            case 'ETH':
            case 'MEGAETH': return 3000;
            default: return 3000;
          }
        });
      }
      
      return {
        price: priceNative || (priceUsd / nativePriceInUsd), // Цена в нативной валюте
        priceUsd: priceUsd,
        symbol,
        name,
        decimals: Number(decimals),
        totalSupply: parseFloat(formattedSupply),
        marketCap: marketCapInUsd,
        nativePrice: nativePriceInUsd,
        ethPrice: nativePriceInUsd
      };
    } catch (error) {
      console.error('Ошибка получения цены через DEXScreener:', error.message);
      return null;
    }
  }

  async getTokenPrice(tokenAddress) {
    // Сначала пробуем DEXScreener (быстрее, без rate limit)
    const dexscreenerPrice = await this.getTokenPriceFromDexScreener(tokenAddress);
    if (dexscreenerPrice) {
      return dexscreenerPrice;
    }
    
    // Fallback на старый метод через блокчейн
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

      const [decimals, symbol, name, totalSupply, nativePriceInUsd] = await Promise.all([
        this.retryCall(() => tokenContract.decimals()).catch(() => 18),
        this.retryCall(() => tokenContract.symbol()).catch(() => 'UNKNOWN'),
        this.retryCall(() => tokenContract.name()).catch(() => 'Unknown Token'),
        this.retryCall(() => tokenContract.totalSupply()).catch(() => 0n),
        this.getNativePrice() // Используем правильную цену нативной валюты
      ]);

      const amountIn = ethers.parseUnits('1', decimals);
      const amounts = await this.retryCall(() => routerContract.getAmountsOut(amountIn, path)).catch(() => [0n, 0n]);
      const priceInNative = ethers.formatEther(amounts[1]); // Цена в нативной валюте (BNB/ETH)
      const formattedSupply = ethers.formatUnits(totalSupply, decimals);

      const priceInUsd = parseFloat(priceInNative) * nativePriceInUsd;
      const marketCapInUsd = priceInUsd * parseFloat(formattedSupply);

      return {
        price: parseFloat(priceInNative),
        priceUsd: priceInUsd,
        symbol,
        name,
        decimals: Number(decimals),
        totalSupply: parseFloat(formattedSupply),
        marketCap: marketCapInUsd,
        nativePrice: nativePriceInUsd, // Цена нативной валюты в USD
        ethPrice: nativePriceInUsd // Для обратной совместимости
      };
    } catch (error) {
      console.error('Ошибка получения цены токена:', error);
      // Получаем цену нативной валюты для fallback
      const nativePrice = await this.getNativePrice().catch(() => {
        switch (this.currentNetwork) {
          case 'BSC':
            return 600;
          case 'BASE':
          case 'ETH':
          case 'MEGAETH':
            return 3000;
          default:
            return 3000;
        }
      });
      
      return {
        price: 0,
        priceUsd: 0,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 18,
        totalSupply: 0,
        marketCap: 0,
        nativePrice: nativePrice,
        ethPrice: nativePrice // Для обратной совместимости
      };
    }
  }
}

module.exports = Web3Manager;
