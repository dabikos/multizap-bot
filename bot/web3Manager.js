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

    try {
      console.log(`Развертывание контракта в сети ${this.currentNetwork}:`);
      console.log('ABI:', this.abi ? 'загружен' : 'не загружен');
      console.log('Bytecode:', this.bytecode ? 'загружен' : 'не загружен');
      console.log('Router Address:', this.networkConfig.routerAddress);
      console.log('Factory Address:', this.networkConfig.factoryAddress);
      console.log('Wallet Address:', this.wallet.address);

      const gasParams = await this.getGasParams();
      console.log('Gas params (raw):', gasParams);

      // Используем актуальные сетевые параметры газа для всех сетей
      const deployOptions = { ...gasParams };
      // Убираем gasPrice если есть EIP-1559 параметры
      if (deployOptions.maxFeePerGas && deployOptions.gasPrice) {
        delete deployOptions.gasPrice;
      }
      console.log('Deploy gas params:', {
        maxFeePerGas: deployOptions.maxFeePerGas ? `${ethers.formatUnits(deployOptions.maxFeePerGas, 'gwei')} gwei` : 'N/A',
        maxPriorityFeePerGas: deployOptions.maxPriorityFeePerGas ? `${ethers.formatUnits(deployOptions.maxPriorityFeePerGas, 'gwei')} gwei` : 'N/A',
        gasPrice: deployOptions.gasPrice ? `${ethers.formatUnits(deployOptions.gasPrice, 'gwei')} gwei` : 'N/A'
      });

      // Используем estimateGas для точного расчёта gasLimit на всех сетях
      let baseGasLimit;
      try {
        const wethForEstimate = await this.getWethAddress();
        const MultiZapFactory = new ethers.ContractFactory(this.abi, this.bytecode, this.wallet);
        const deployTx = await MultiZapFactory.getDeployTransaction(
          ethers.getAddress(this.networkConfig.routerAddress),
          ethers.getAddress(this.networkConfig.factoryAddress),
          wethForEstimate
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
        baseGasLimit = BigInt(4000000); // Fallback: 4M (контракт ~3.2M с новыми интерфейсами)
      }

      deployOptions.gasLimit = baseGasLimit;
      console.log(`Gas limit для деплоя: ${deployOptions.gasLimit.toString()}`);

      // Проверяем адреса перед деплоем
      const routerAddr = ethers.getAddress(this.networkConfig.routerAddress);
      const factoryAddr = ethers.getAddress(this.networkConfig.factoryAddress);

      // Определяем WETH адрес (роутеры могут использовать WETH() или WETH9())
      const wethAddr = await this.getWethAddress();

      console.log('Проверка адресов:');
      console.log('  Router:', routerAddr);
      console.log('  Factory:', factoryAddr);
      console.log('  WETH:', wethAddr);

      const deployGasCost = deployOptions.maxFeePerGas
        ? deployOptions.gasLimit * deployOptions.maxFeePerGas
        : deployOptions.gasPrice
          ? deployOptions.gasLimit * deployOptions.gasPrice
          : null;

      if (deployGasCost) {
        const balance = await this.provider.getBalance(this.wallet.address);
        if (balance < deployGasCost) {
          throw new Error(
            `Недостаточно средств для деплоя. ` +
            `Баланс: ${ethers.formatEther(balance)} ${this.networkConfig.nativeCurrency}, ` +
            `требуется примерно: ${ethers.formatEther(deployGasCost)} ${this.networkConfig.nativeCurrency} ` +
            `(gasLimit ${deployOptions.gasLimit.toString()}).`
          );
        }
      }

      const MultiZapFactory = new ethers.ContractFactory(this.abi, this.bytecode, this.wallet);
      const multiZap = await MultiZapFactory.deploy(
        routerAddr,
        factoryAddr,
        wethAddr,
        deployOptions  // Опции передаются как 5-й аргумент
      );
      await multiZap.waitForDeployment();
      const address = await multiZap.getAddress();

      this.multiZapContract = multiZap;
      return address;
    } catch (error) {
      console.error('Детали ошибки развертывания:', {
        message: error.message,
        reason: error.reason,
        shortMessage: error.shortMessage,
        code: error.code,
        rpcMessage: error.info?.error?.message
      });

      const message = error.shortMessage || error.info?.error?.message || error.reason || error.message || 'Неизвестная ошибка';
      throw new Error(`Ошибка развертывания контракта: ${message}`);
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

  normalizeGasLimit(gasLimit, fallbackGasLimit = 500000n) {
    if (gasLimit == null) {
      return fallbackGasLimit;
    }

    if (typeof gasLimit === 'bigint') {
      return gasLimit;
    }

    return BigInt(gasLimit);
  }

  async buildTxOverrides(estimateFn, fallbackGasLimit = 500000n) {
    const gasParams = await this.getGasParams();
    // Убираем gasLimit из gasParams чтобы он не перезаписывал наш рассчитанный лимит
    const { gasLimit: _configGasLimit, ...gasParamsWithoutLimit } = gasParams;
    const overrides = { ...gasParamsWithoutLimit };

    try {
      const estimatedGas = await estimateFn(overrides);
      // Добавляем 20% буфер к реальной оценке газа
      overrides.gasLimit = estimatedGas + (estimatedGas / 5n);
      console.log(`EstimateGas: ${estimatedGas.toString()}, с буфером: ${overrides.gasLimit.toString()}`);
    } catch (error) {
      console.warn('Gas estimate failed, using fallback gas limit:', error.message);
      overrides.gasLimit = fallbackGasLimit;
    }

    return overrides;
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
        throw new Error('TOKEN_NOT_SUPPORTED: token is not registered yet. Use the one-click buy flow.');
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
      const amountOutMinToken = 0n;
      const amountTokenMin = 0n;
      const amountETHMin = 0n;

      console.log(`Сумма покупки: ${amountEth} ${this.networkConfig.nativeCurrency} (${amountWei.toString()} wei)`);
      console.log(`Адрес контракта: ${await this.multiZapContract.getAddress()}`);
      console.log(`Адрес кошелька: ${this.wallet.address}`);
      console.log(`Адрес токена: ${tokenAddress}`);

      // Используем buildTxOverrides с реальным estimateGas (как в deploy)
      const txOverrides = await this.buildTxOverrides(
        (overrides) => this.multiZapContract.zapIn.estimateGas(
          tokenAddress,
          amountOutMinToken,
          amountTokenMin,
          amountETHMin,
          { value: amountWei, ...overrides }
        ),
        450000n
      );

      // Проверяем баланс перед отправкой транзакции
      const balance = await this.provider.getBalance(this.wallet.address);
      const gasLimit = this.normalizeGasLimit(txOverrides.gasLimit, 450000n);

      let estimatedGasCost;
      if (this.networkConfig.supportsEIP1559 && txOverrides.maxFeePerGas) {
        estimatedGasCost = gasLimit * txOverrides.maxFeePerGas;
      } else if (txOverrides.gasPrice) {
        estimatedGasCost = gasLimit * txOverrides.gasPrice;
      } else {
        estimatedGasCost = gasLimit * ethers.parseUnits('50', 'gwei');
      }

      const totalNeeded = amountWei + estimatedGasCost;

      if (balance < totalNeeded) {
        const balanceEth = ethers.formatEther(balance);
        const neededEth = ethers.formatEther(totalNeeded);
        throw new Error(`Недостаточно средств для транзакции. Баланс: ${balanceEth} ${this.networkConfig.nativeCurrency}, требуется: ${neededEth} ${this.networkConfig.nativeCurrency} (включая газ)`);
      }

      console.log(`Gas limit: ${gasLimit.toString()}`);
      console.log(`Estimated gas cost: ${ethers.formatEther(estimatedGasCost)} ${this.networkConfig.nativeCurrency}`);
      console.log(`Total needed: ${ethers.formatEther(totalNeeded)} ${this.networkConfig.nativeCurrency}`);

      // Отправляем транзакцию
      console.log('Отправка транзакции...');
      const tx = await this.multiZapContract.zapIn(
        tokenAddress,
        amountOutMinToken,
        amountTokenMin,
        amountETHMin,
        {
          value: amountWei,
          ...txOverrides
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
        errorMessage = 'Токен еще не зарегистрирован. Для покупки используйте кнопку Buy, она добавит токен автоматически.';
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

  async zapInAuto(tokenAddress, amountEth, slippagePercent = config.DEFAULT_SLIPPAGE) {
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
      const amountOutMinToken = 0n;
      const amountTokenMin = 0n;
      const amountETHMin = 0n;

      const txOverrides = await this.buildTxOverrides(
        (overrides) => this.multiZapContract.addTokenAndZapIn.estimateGas(
          tokenAddress,
          amountOutMinToken,
          amountTokenMin,
          amountETHMin,
          { value: amountWei, ...overrides }
        ),
        450000n
      );

      const tx = await this.multiZapContract.addTokenAndZapIn(
        tokenAddress,
        amountOutMinToken,
        amountTokenMin,
        amountETHMin,
        {
          value: amountWei,
          ...txOverrides
        }
      );

      const receipt = await tx.wait();
      if (receipt.status === 0) {
        throw new Error('Транзакция отклонена контрактом.');
      }

      return tx.hash;
    } catch (error) {
      let errorMessage = error.message || 'Неизвестная ошибка';

      if (errorMessage.includes('LP_PAIR_NOT_FOUND')) {
        errorMessage = 'LP пара WETH не найдена для этого токена.';
      } else if (errorMessage.includes('TOKEN_INACTIVE')) {
        errorMessage = 'Токен неактивен в контракте.';
      } else if (errorMessage.includes('NO_TOKENS_RECEIVED')) {
        errorMessage = 'Не удалось получить токены после swap.';
      } else if (errorMessage.includes('insufficient funds') || errorMessage.includes('insufficient balance')) {
        errorMessage = 'Недостаточно средств для оплаты газа и покупки.';
      }

      throw new Error(`Ошибка buy: ${errorMessage}`);
    }
  }

  async exitAndSell(tokenAddress, slippagePercent = config.DEFAULT_SLIPPAGE) {
    if (!this.multiZapContract) {
      throw new Error('Contract is not connected');
    }

    if (!ethers.isAddress(tokenAddress)) {
      throw new Error('Invalid token address');
    }

    let tokenInfo;
    try {
      tokenInfo = await this.retryCall(() => this.multiZapContract.getTokenInfo(tokenAddress));
    } catch (error) {
      throw new Error(`Token info error: ${error.message}`);
    }

    if (!tokenInfo || tokenInfo.token === ethers.ZeroAddress) {
      throw new Error('Token not found in contract. Buy it first, then sell.');
    }

    if (!tokenInfo.isActive) {
      throw new Error('TOKEN_INACTIVE: Token is inactive in the contract.');
    }

    console.log(`Stored LP token in contract: ${tokenInfo.lpToken}`);
    try {
      const amountTokenMin = 0n;
      const amountETHMin = 0n;
      const amountOutMinETH = 0n;

      const txOverrides = await this.buildTxOverrides(
        (overrides) => this.multiZapContract.exitAndSell.estimateGas(tokenAddress, amountTokenMin, amountETHMin, amountOutMinETH, overrides),
        420000n
      );

      const tx = await this.multiZapContract.exitAndSell(
        tokenAddress,
        amountTokenMin,
        amountETHMin,
        amountOutMinETH,
        txOverrides
      );
      await tx.wait();
      return tx.hash;
    } catch (error) {
      let errorMsg = error.message || 'Unknown error';
      if (errorMsg.includes('TOKEN_INACTIVE')) {
        errorMsg = 'Token is inactive in the contract.';
      } else if (errorMsg.includes('NO_LP')) {
        errorMsg = 'No LP tokens available to sell.';
      } else if (errorMsg.includes('LP_PAIR_NOT_FOUND')) {
        errorMsg = 'No WETH/WBNB LP pair found for this token.';
      }
      throw new Error(`Exit-and-sell error: ${errorMsg}`);
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
          // Увеличиваем maxFeePerGas на 20% для небольшого запаса
          const maxFeePerGas = feeData.maxFeePerGas + (feeData.maxFeePerGas / 5n);
          // Увеличиваем maxPriorityFeePerGas на 10% для аккуратного tip
          const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas + (feeData.maxPriorityFeePerGas / 10n);

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

  async getTokenInfo(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Contract is not connected');
    }
    return await this.retryCall(() => this.multiZapContract.getTokenInfo(tokenAddress));
  }

  async getAllTokens() {
    if (!this.multiZapContract) {
      throw new Error('Contract is not connected');
    }
    return await this.retryCall(() => this.multiZapContract.getAllTokens());
  }

  async getLpBalance(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Contract is not connected');
    }
    const balance = await this.retryCall(() => this.multiZapContract.getLpBalance(tokenAddress));
    return ethers.formatEther(balance);
  }

  async getTokenBalance(tokenAddress) {
    if (!this.multiZapContract) {
      throw new Error('Contract is not connected');
    }
    const balance = await this.retryCall(() => this.multiZapContract.getTokenBalance(tokenAddress));
    return ethers.formatEther(balance);
  }
}

module.exports = Web3Manager;

