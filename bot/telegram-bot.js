const TelegramBot = require('node-telegram-bot-api');
const { ethers } = require('ethers');
const Web3Manager = require('./web3Manager');
const UserManager = require('./userManager');
const LimitOrderManager = require('./limitOrderManager');
const LimitOrderMonitor = require('./limitOrderMonitor');
const SniperManager = require('./sniperManager');
const SniperMonitor = require('./sniperMonitor');
const config = require('./config');

class TelegramBotManager {
  constructor() {
    this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.web3Manager = new Web3Manager();
    this.userManager = new UserManager();
    this.limitOrderManager = new LimitOrderManager();
    this.sniperManager = new SniperManager();
    // Передаем тот же экземпляр LimitOrderManager в мониторинг, чтобы использовать одну память
    this.limitOrderMonitor = new LimitOrderMonitor(this, this.limitOrderManager);
    this.sniperMonitor = new SniperMonitor(this, this.sniperManager);
    // Временное хранилище для цены лимитного ордера, чтобы не класть длинные числа в callback_data
    // Формат: { [chatId]: { tokenAddress, sellPrice } }
    this.pendingLimitOrders = {};
    // Хранилище для маппинга коротких ID токенов (чтобы не класть полные адреса в callback_data)
    // Формат: { [chatId]: { [shortId]: tokenAddress } }
    this.tokenAddressMap = {};
    this.pendingActions = new Set();
    this.pendingInputActions = new Map();
    this.setupCommands();
    this.setupCallbackHandlers();
    // Запускаем мониторинг лимитных ордеров
    this.limitOrderMonitor.start();
    this.sniperMonitor.start();
  }

  // Получить Web3Manager для конкретного пользователя с правильной сетью
  getWeb3ManagerForUser(chatId) {
    const user = this.userManager.getUser(chatId);
    if (user) {
      const userNetwork = this.userManager.getUserNetwork(chatId);
      this.web3Manager.setNetwork(userNetwork);
    }
    return this.web3Manager;
  }

  getExplorerUrl(chatId) {
    const userNetwork = this.userManager.getUserNetwork(chatId);
    return config.getExplorerUrl(userNetwork);
  }

  getTokenShortId(chatId, tokenAddress) {
    if (!this.tokenAddressMap[chatId]) {
      this.tokenAddressMap[chatId] = {};
    }
    
    for (const [shortId, addr] of Object.entries(this.tokenAddressMap[chatId])) {
      if (addr.toLowerCase() === tokenAddress.toLowerCase()) {
        return shortId;
      }
    }
    
    const shortId = tokenAddress.slice(-8).toLowerCase();
    this.tokenAddressMap[chatId][shortId] = tokenAddress;
    return shortId;
  }

  getTokenAddressByShortId(chatId, shortId) {
    if (!this.tokenAddressMap[chatId]) {
      return null;
    }
    return this.tokenAddressMap[chatId][shortId.toLowerCase()] || null;
  }

  getBasePairLabel(networkName) {
    const networkConfig = config.getNetworkConfig(networkName);
    return networkConfig.nativeCurrency === 'BNB' ? 'WBNB' : 'WETH';
  }

  getPendingActionKey(chatId, action, tokenAddress) {
    return `${chatId}:${action}:${tokenAddress.toLowerCase()}`;
  }

  setPendingInput(chatId, action) {
    this.pendingInputActions.set(String(chatId), action);
  }

  clearPendingInput(chatId, action = null) {
    const key = String(chatId);
    if (!action || this.pendingInputActions.get(key) === action) {
      this.pendingInputActions.delete(key);
    }
  }

  hasPendingInput(chatId) {
    return this.pendingInputActions.has(String(chatId));
  }

  async runTokenAction(chatId, action, tokenAddress, fn) {
    const key = this.getPendingActionKey(chatId, action, tokenAddress);
    if (this.pendingActions.has(key)) {
      throw new Error(`${action} is already pending for this token. Wait for the current transaction to finish.`);
    }

    this.pendingActions.add(key);
    try {
      return await fn();
    } finally {
      this.pendingActions.delete(key);
    }
  }

  async autoAddAndZapIn(chatId, web3Manager, tokenAddress, amount) {
    const tokenInfo = await web3Manager.getTokenInfo(tokenAddress);
    if (tokenInfo?.token && tokenInfo.token !== ethers.ZeroAddress && !tokenInfo.isActive) {
      throw new Error('TOKEN_INACTIVE: Token is inactive in the contract.');
    }

    const added = !tokenInfo?.token || tokenInfo.token === ethers.ZeroAddress;
    const pairType = added ? this.getBasePairLabel(this.userManager.getUserNetwork(chatId)) : null;
    const txHash = await web3Manager.zapInAuto(tokenAddress, amount);
    return { txHash, added, pairType };
  }

  truncateMessage(message, maxLength = 4000) {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 50) + '\n\n... (сообщение обрезано)';
  }

  getReadableErrorMessage(error) {
    const rawMessage = error.shortMessage ||
      error.info?.error?.message ||
      error.reason ||
      error.message ||
      'Unknown error';

    return String(rawMessage)
      .replace(/transaction="0x[a-fA-F0-9]+"/g, 'transaction="<hidden>"')
      .replace(/0x[a-fA-F0-9]{200,}/g, '<hidden bytecode>');
  }

  // Показать позицию токена (используется после покупки и при выборе токена)
  async showTokenPosition(chatId, tokenAddress, messageId = null) {
    const user = this.userManager.getUser(chatId);
    if (!user) {
      return;
    }

    const web3Manager = this.getWeb3ManagerForUser(chatId);
    web3Manager.setPrivateKey(user.privateKey);
    const userContract = this.userManager.getUserContract(chatId);
    web3Manager.setContractAddress(userContract);
    
    // Получаем информацию о токене с обработкой ошибок
    let tokenInfo, tokenPrice, lpBalance, tokenBalance;
    try {
      tokenInfo = await web3Manager.getTokenInfo(tokenAddress);
    } catch (error) {
      console.error('Ошибка получения tokenInfo:', error.message);
      tokenInfo = { token: tokenAddress, lpToken: '0x0000000000000000000000000000000000000000', isActive: true };
    }
    
    try {
      tokenPrice = await web3Manager.getTokenPrice(tokenAddress);
    } catch (error) {
      console.error('Ошибка получения tokenPrice:', error.message);
      const userNetworkName = this.userManager.getUserNetwork(chatId);
      const fallbackPrice = userNetworkName === 'BSC' ? 600 : 3000;
      tokenPrice = { name: 'Unknown', symbol: 'UNKNOWN', price: 0, priceUsd: 0, marketCap: 0, nativePrice: fallbackPrice, ethPrice: fallbackPrice };
    }
    
    try {
      lpBalance = await web3Manager.getLpBalance(tokenAddress);
    } catch (error) {
      console.error('Ошибка получения lpBalance:', error.message);
      lpBalance = '0';
    }
    
    try {
      tokenBalance = await web3Manager.getTokenBalance(tokenAddress);
    } catch (error) {
      console.error('Ошибка получения tokenBalance:', error.message);
      tokenBalance = '0';
    }
    
    const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
    const isStoredToken = tokenInfo?.token && tokenInfo.token !== ethers.ZeroAddress;
    const status = isStoredToken
      ? (tokenInfo.isActive ? '✅ Активен' : '❌ Неактивен')
      : '⏳ Будет добавлен при покупке';
    const lpBalanceNum = parseFloat(lpBalance);
    const hasLpBalance = lpBalanceNum > 0;
    
    // Форматируем маркеткап
    const formatMarketCap = (marketCap) => {
      if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(2)}B`;
      if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(2)}M`;
      if (marketCap >= 1e3) return `$${(marketCap / 1e3).toFixed(2)}K`;
      return `$${marketCap.toFixed(2)}`;
    };
    
    // Ограничиваем длину сообщения (Telegram лимит 4096 символов)
    const userNetworkName = this.userManager.getUserNetwork(chatId);
    const networkConfig = config.getNetworkConfig(userNetworkName);
    const nativeCurrency = networkConfig.nativeCurrency;
    let message = `🪙 **${tokenPrice.name} (${tokenPrice.symbol})**\n\n` +
      `📍 Адрес: \`${shortAddress}\`\n` +
      `💰 Цена: ${tokenPrice.price.toFixed(8)} ${nativeCurrency} ($${tokenPrice.priceUsd.toFixed(4)})\n` +
      `📊 Маркеткап: ${formatMarketCap(tokenPrice.marketCap)}\n` +
      `🔄 Статус: ${status}\n` +
      `💎 LP баланс: ${hasLpBalance ? '✅ ' : '⚠️ '}${lpBalance}\n` +
      `🪙 Токен баланс: ${tokenBalance}\n` +
      `📈 ${nativeCurrency} цена: $${(tokenPrice.nativePrice || tokenPrice.ethPrice || 0).toFixed(2)}\n`;
    
    // Добавляем предупреждение если нет LP баланса
    if (!hasLpBalance && isStoredToken) {
      message += `\n⚠️ **Нет LP токенов для продажи**\n` +
        `💡 Сначала купите токены через zap-in, чтобы создать LP позицию.`;
    }
    
    // Показываем активные лимитные ордера
    const activeOrders = this.limitOrderManager.getActiveOrders(chatId, tokenAddress);
    if (activeOrders.length > 0) {
      message += `\n\n🎯 **Активные лимитные ордера:**\n`;
      activeOrders.forEach((order, index) => {
        // Обратная совместимость: если есть sellPriceUsd, используем его, иначе sellPrice (старые ордера)
        const priceUsd = order.sellPriceUsd !== undefined ? order.sellPriceUsd : (order.sellPrice || 0);
        message += `${index + 1}. Продать ${order.percent}% при цене ≥ $${priceUsd.toFixed(8)}\n`;
      });
    }
    
    message += `\n\n💡 Выберите действие:`;
    
    // Обрезаем сообщение если слишком длинное
    message = this.truncateMessage(message);
    
    // Показываем кнопки с действиями
    const actionKeyboardRows = [
        [
          { text: `💰 Купить 0.01 ${networkConfig.nativeCurrency}`, callback_data: `buy_${tokenAddress}_0.01` },
          { text: `💰 Купить 0.05 ${networkConfig.nativeCurrency}`, callback_data: `buy_${tokenAddress}_0.05` }
        ],
        [
          { text: `💰 Купить 0.02 ${networkConfig.nativeCurrency}`, callback_data: `buy_${tokenAddress}_0.02` },
          { text: `💰 Купить 0.04 ${networkConfig.nativeCurrency}`, callback_data: `buy_${tokenAddress}_0.04` }
        ],
        [
          { text: '💰 Другая сумма', callback_data: `custom_amount_${tokenAddress}` }
        ],
        [
          { text: '💸 Продать все', callback_data: `sell_all_${tokenAddress}` }
        ],
        [
          { text: '🗑️ Убрать из списка', callback_data: `remove_token_${tokenAddress}` }
        ],
        [
          { text: '📊 Обновить', callback_data: `select_token_${tokenAddress}` },
          { text: '❌ Отмена', callback_data: 'cancel' }
        ]
    ];

    const actionKeyboard = {
      inline_keyboard: actionKeyboardRows
    };
    
    if (messageId) {
      // Обновляем существующее сообщение
      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: actionKeyboard
      });
    } else {
      // Отправляем новое сообщение
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: actionKeyboard
      });
    }
  }

  setupBotMenu() {
    // Настройка меню команд для бота
    const commands = [
      { command: 'start', description: '🚀 Начать работу с ботом' },
      { command: 'home', description: '🏠 Главное меню' },
      { command: 'menu', description: '📋 Меню команд' },
      { command: 'register', description: '🔐 Регистрация (добавить ключ)' },
      { command: 'deploy', description: '🚀 Развернуть контракт' },
      { command: 'removetoken', description: '🗑️ Удалить токен' },
      { command: 'tokens', description: '📝 Список токенов' },
      { command: 'positions', description: '📊 Мои позиции' },
      { command: 'zapin', description: '💰 Купить токены' },
      { command: 'exit', description: '🔄 Продать позиции' },
      { command: 'sniper', description: '🎯 Снайпер по deployer' },
      { command: 'snipers', description: '📋 Активные снайперы' },
      { command: 'sniperstop', description: '⏹️ Остановить снайпер' },
      { command: 'balance', description: '💰 Балансы' },
      { command: 'network', description: '🌐 Переключить сеть' },
      { command: 'help', description: '❓ Помощь' },
      { command: 'status', description: '📊 Статус бота' }
    ];

    this.bot.setMyCommands(commands).then(() => {
      console.log('✅ Меню команд настроено');
    }).catch((error) => {
      console.error('❌ Ошибка настройки меню команд:', error);
    });
  }

  setupCommands() {
    // Настройка меню команд
    this.setupBotMenu();
    
    // Команда /start
    this.bot.onText(/\/start/, (msg) => {
      const chatId = msg.chat.id;
      const welcomeMessage = `
🚀 Добро пожаловать в MultiZap Bot!

Этот бот позволяет вам:
• Работать с несколькими сетями: ETH, BSC, BASE, ROBINHOOD, MONAD и MEGAETH
• Создать контракты для работы с разными токенами
• Управлять токенами через Telegram
• Выполнять zap-in и exit операции

📋 **Быстрый доступ к командам:**
Используйте кнопку "📋" рядом с полем ввода для просмотра всех команд!

**Основные команды:**
/menu - Меню команд
/home - Главное меню с кнопками
/register - Регистрация (добавить приватный ключ)
/deploy - Развернуть MultiZap контракт

**Управление токенами:**
Отправьте адрес токена, чтобы открыть карточку покупки/продажи
/removetoken - Удалить токен
/tokens - Список поддерживаемых токенов
/positions - Просмотр позиций

**Операции:**
/zapin - Выполнить zap-in операцию
/exit - Выполнить exit-and-sell операцию
/balance - Показать балансы

**Информация:**
/help - Подробная справка
/status - Статус бота

⚠️ **Внимание:** Никогда не передавайте приватный ключ третьим лицам!
      `;
      this.bot.sendMessage(chatId, welcomeMessage);
    });

    // Команда /home - главное меню с кнопками
    this.bot.onText(/\/home/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userNetwork = user ? this.userManager.getUserNetwork(chatId) : config.DEFAULT_NETWORK;
      const networkConfig = config.getNetworkConfig(userNetwork);
      const userContract = user ? this.userManager.getUserContract(chatId, userNetwork) : null;
      
      let message = 'Main Menu\n\n';
      message += `Current network: ${networkConfig.name} (${userNetwork})\n\n`;
      
      if (userContract) {
        message += `Contract deployed: \`${userContract.slice(0, 6)}...${userContract.slice(-4)}\`\n\n`;
      } else {
        message += `Contract is not deployed on ${userNetwork}\n\n`;
      }
      
      message += 'Choose an action:';
      
      const homeKeyboard = {
        inline_keyboard: [
          [
            { text: 'Register', callback_data: 'home_register' },
            { text: 'Deploy Contract', callback_data: 'home_deploy' }
          ],
          [
            { text: 'Open Token', callback_data: 'home_open_token' },
            { text: 'Positions', callback_data: 'home_positions' }
          ],
          [
            { text: 'Zap In', callback_data: 'home_zapin' },
            { text: 'Exit & Sell', callback_data: 'home_exit' }
          ],
          [
            { text: 'Balances', callback_data: 'home_balance' },
            { text: 'Token List', callback_data: 'home_tokens' }
          ],
          [
            { text: 'Sniper', callback_data: 'home_sniper' },
            { text: 'Snipers', callback_data: 'home_snipers' }
          ],
          [
            { text: 'Network', callback_data: 'home_network' },
            { text: 'Help', callback_data: 'home_help' }
          ]
        ]
      };
      
      this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: homeKeyboard
      });
    });

    this.bot.onText(/^\/menu(?:@\w+)?$/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId,
        'Menu:\n\n' +
        '/home - main menu\n' +
        '/positions - token positions\n' +
        '/position - token positions\n' +
        '/balance - wallet and contract balances\n' +
        '/tokens - token list\n' +
        '/exit - sell all LP for a token\n' +
        '/sniper - watch deployer and buy first token with liquidity\n' +
        '/snipers - active sniper tasks\n' +
        '/sniperstop - stop sniper task\n' +
        '/network - switch network\n\n' +
        'You can also send a token address directly to open buy/sell actions.'
      );
    });

    this.bot.onText(/^\/positions?(?:@\w+)?$/, async (msg) => {
      await this.handlePositions(msg.chat.id);
    });

    this.bot.onText(/^\/balance(?:@\w+)?$/, async (msg) => {
      await this.handleBalance(msg.chat.id);
    });

    this.bot.onText(/^\/tokens(?:@\w+)?$/, async (msg) => {
      await this.handleTokens(msg.chat.id);
    });

    this.bot.onText(/^\/sniper(?:@\w+)?$/, (msg) => {
      this.handleCreateSniper(msg.chat.id);
    });

    this.bot.onText(/^\/snipers(?:@\w+)?$/, (msg) => {
      this.handleSnipers(msg.chat.id);
    });

    this.bot.onText(/^\/sniperstop(?:@\w+)?(?:\s+(\d+))?$/, (msg, match) => {
      this.handleStopSniper(msg.chat.id, match?.[1]);
    });

    this.bot.onText(/^\/exit(?:@\w+)?$/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, 'Send token address to sell all LP for that token:');
      this.handleExit(chatId);
    });

    this.bot.onText(/^\/help(?:@\w+)?$/, (msg) => {
      this.bot.sendMessage(msg.chat.id, 'Main flow: /register -> /deploy -> send token address -> buy -> sell all. Use /home for buttons.');
    });

    this.bot.onText(/^\/status(?:@\w+)?$/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      const network = user ? this.userManager.getUserNetwork(chatId) : config.DEFAULT_NETWORK;
      const contractAddress = user ? this.userManager.getUserContract(chatId, network) : null;
      this.bot.sendMessage(chatId,
        `Status:\n\n` +
        `Network: ${network}\n` +
        `Registered: ${user ? 'yes' : 'no'}\n` +
        `Contract: ${contractAddress ? contractAddress : 'not deployed'}`
      );
    });

    this.bot.onText(/\/register/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, 
        'Enter your private key to register:\n\n' +
        'Warning: the private key is stored locally and used only for signing transactions.'
      );
      
      this.bot.once('message', (msg) => {
        let privateKey = msg.text.trim();
        
        if (privateKey && (
          (privateKey.startsWith('0x') && privateKey.length === 66) || 
          (!privateKey.startsWith('0x') && privateKey.length === 64)
        )) {
          if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
          }
          
          const success = this.userManager.addUser(chatId, privateKey);
          if (success) {
            this.bot.sendMessage(chatId, 'Registration successful. You can now use /deploy');
          } else {
            this.bot.sendMessage(chatId, 'Registration failed. Try again.');
          }
        } else {
          this.bot.sendMessage(chatId, 'Invalid private key format. Enter a 64-character key with or without 0x.');
        }
      });
    });

    this.bot.onText(/\/network/, (msg) => {
      const chatId = msg.chat.id;
      this.showNetworkSelection(chatId);
    });

    this.bot.onText(/\/deploy/, async (msg) => {
      const chatId = msg.chat.id;
      let user = this.userManager.getUser(chatId);
      
      if (!user) {
        if (config.PRIVATE_KEY && config.PRIVATE_KEY !== 'your_private_key_here') {
          this.bot.sendMessage(chatId, 'Using private key from config. For safety it is better to register with /register.');
          user = { privateKey: config.PRIVATE_KEY };
        } else {
          this.bot.sendMessage(chatId, 'Please register with /register or configure a private key in config.js');
          return;
        }
      }

      try {
        this.bot.sendMessage(chatId, 'Deploying contract...');
        
        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const contractAddress = await web3Manager.deployMultiZap();
        
        const userNetwork = this.userManager.getUserNetwork(chatId);
        this.userManager.updateUserContract(chatId, contractAddress, userNetwork);
        
        const explorerUrl = this.getExplorerUrl(chatId);
        this.bot.sendMessage(chatId, 
          `Contract deployed successfully.\n\n` +
          `Contract address: \`${contractAddress}\`\n` +
          `Network: ${userNetwork}\n` +
          `Explorer: ${explorerUrl}/address/${contractAddress}\n\n` +
          `Now send a token address to open buy/sell actions.`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        this.bot.sendMessage(chatId, this.truncateMessage(`Deployment error: ${this.getReadableErrorMessage(error)}`));
      }
    });

    this.bot.onText(/\/removetoken/, (msg) => {
      const chatId = msg.chat.id;
      this.handleRemoveToken(chatId);
    });

    this.bot.onText(/\/zapin/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, 'Deploy the contract first with /deploy');
        return;
      }

      this.bot.sendMessage(chatId, 
        'Enter token address and ETH amount in this format:\n\n' +
        '`token_address,amount_ETH`\n\n' +
        'Example: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e,0.01`',
        { parse_mode: 'Markdown' }
      );

      this.handleZapIn(chatId);
    });

    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();

      if (!text || text.startsWith('/') || !ethers.isAddress(text)) {
        return;
      }

      if (this.hasPendingInput(chatId)) {
        return;
      }

      const user = this.userManager.getUser(chatId);
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, 'Deploy the contract first with /deploy');
        return;
      }

      await this.showTokenPosition(chatId, text);
    });

  }
  handleRemoveToken(chatId) {
    const user = this.userManager.getUser(chatId);
    if (!user) {
      this.bot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь командой /register');
      return;
    }

    this.bot.sendMessage(chatId, '🗑️ Введите адрес токена, который нужно убрать из списков бота:');
    this.setPendingInput(chatId, 'remove_token');

    this.bot.once('message', async (msg) => {
      if (msg.chat.id !== chatId) return;
      
      try {
        const tokenAddress = msg.text.trim();
        
        if (!ethers.isAddress(tokenAddress)) {
          this.bot.sendMessage(chatId, '❌ Неверный формат адреса токена. Попробуйте еще раз с /removetoken');
          return;
        }

        this.userManager.hideToken(chatId, tokenAddress);
        this.bot.sendMessage(chatId, 
          `✅ Токен убран из списков бота.\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `Контракт не менялся, транзакция не отправлялась.`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        let errorMessage = error.message || 'Неизвестная ошибка';
        if (errorMessage.length > 4000) {
          errorMessage = errorMessage.substring(0, 4000) + '...';
        }
        this.bot.sendMessage(chatId, `❌ Ошибка удаления токена: ${errorMessage}`);
      } finally {
        this.clearPendingInput(chatId, 'remove_token');
      }
    });
  }

  async handlePositions(chatId) {
    const user = this.userManager.getUser(chatId);
    const userContract = user ? this.userManager.getUserContract(chatId) : null;
    if (!user || !userContract) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      web3Manager.setContractAddress(userContract);
      
      const allTokens = await this.web3Manager.getAllTokens();
      const hiddenTokens = new Set(this.userManager.getHiddenTokens(chatId).map(address => address.toLowerCase()));
      const tokens = allTokens.filter(address => !hiddenTokens.has(address.toLowerCase()));
      
      if (tokens.length === 0) {
        this.bot.sendMessage(chatId, '📝 Список позиций пуст. Отправьте адрес токена и нажмите Buy.');
        return;
      }

      // Фильтруем только активные токены для ускорения загрузки
      // Используем батчинг и задержки для избежания rate limit
      const activeTokens = [];
      const tokenInfoMap = {};
      
      // Обрабатываем токены батчами по 5 с задержкой между батчами
      const batchSize = 5;
      const delayBetweenBatches = 2000; // 2 секунды между батчами
      const delayBetweenRequests = 300; // 300мс между запросами в батче
      
      for (let i = 0; i < tokens.length; i++) {
        try {
          // Добавляем задержку между запросами
          if (i > 0 && i % batchSize === 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
          } else if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
          }
          
          const tokenInfo = await this.web3Manager.getTokenInfo(tokens[i]);
          tokenInfoMap[tokens[i]] = tokenInfo;
          // Показываем только активные токены
          if (tokenInfo.isActive) {
            activeTokens.push(tokens[i]);
          }
        } catch (error) {
          // Игнорируем ошибки rate limit и missing revert data
          const isRateLimit = error.message?.includes('rate limit') || 
                             error.message?.includes('missing revert data') ||
                             error.code === 'CALL_EXCEPTION';
          if (!isRateLimit) {
            console.warn(`Ошибка получения информации о токене ${tokens[i]}:`, error.message);
          }
          // Пропускаем токены с ошибками
        }
      }

      if (activeTokens.length === 0) {
        this.bot.sendMessage(chatId, '📝 Нет активных позиций. Отправьте адрес токена и нажмите Buy.');
        return;
      }

      let message = '📊 Ваши позиции:\n\n';
      const keyboard = [];
      
      for (let i = 0; i < activeTokens.length; i++) {
        const tokenAddress = activeTokens[i];
        const tokenInfo = tokenInfoMap[tokenAddress];
        const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
        
        message += `${i + 1}. ✅ \`${shortAddress}\`\n`;
        
        keyboard.push([{
          text: `${i + 1}. ${shortAddress} ✅`,
          callback_data: `select_token_${tokenAddress}`
        }]);
      }

      keyboard.push([{
        text: '🗑️ Убрать токен из списка',
        callback_data: 'remove_token_menu'
      }]);

      const replyMarkup = {
        inline_keyboard: keyboard
      };

      this.bot.sendMessage(chatId, message + '\n💡 Выберите токен для операций:', { 
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } catch (error) {
      this.bot.sendMessage(chatId, `❌ Ошибка получения позиций: ${error.message}`);
    }
  }

  handleZapIn(chatId) {
    this.setPendingInput(chatId, 'zapin');
    this.bot.once('message', async (msg) => {
      try {
        const [tokenAddress, amountStr] = msg.text.split(',').map(item => item.trim());
        const amount = parseFloat(amountStr);
        
        if (!tokenAddress || isNaN(amount) || amount <= 0) {
          this.bot.sendMessage(chatId, '❌ Неверный формат. Попробуйте еще раз с /zapin');
          return;
        }

        const user = this.userManager.getUser(chatId);
        const userContract = user ? this.userManager.getUserContract(chatId) : null;
        if (!user || !userContract) {
          this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
          return;
        }

        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        web3Manager.setContractAddress(userContract);
        
        const buyResult = await this.autoAddAndZapIn(chatId, web3Manager, tokenAddress, amount);
        this.userManager.unhideToken(chatId, tokenAddress);
        
        const explorerUrl = this.getExplorerUrl(chatId);
        const autoAddText = buyResult.added
          ? `Auto-add: token was added to the contract (${buyResult.pairType} pair).\n`
          : '';
        const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
        this.bot.sendMessage(chatId, 
          `✅ Zap-in выполнен успешно!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `💰 Сумма: ${amount} ${networkConfig.nativeCurrency}\n` +
          autoAddText +
          `🔗 Транзакция: ${explorerUrl}/tx/${buyResult.txHash}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        let errorMessage = error.message || 'Неизвестная ошибка';
        // Обрезаем сообщение если слишком длинное (Telegram лимит 4096 символов)
        if (errorMessage.length > 4000) {
          errorMessage = errorMessage.substring(0, 4000) + '...';
        }
        this.bot.sendMessage(chatId, `❌ Ошибка zap-in:\n\n${errorMessage}`);
      } finally {
        this.clearPendingInput(chatId, 'zapin');
      }
    });
  }

  handleExit(chatId) {
    this.setPendingInput(chatId, 'exit');
    this.bot.once('message', async (msg) => {
      try {
        const tokenAddress = msg.text.trim();
        
        if (!tokenAddress) {
          this.bot.sendMessage(chatId, '❌ Неверный формат. Попробуйте еще раз с /exit');
          return;
        }

        const user = this.userManager.getUser(chatId);
        const userContract = user ? this.userManager.getUserContract(chatId) : null;
        if (!user || !userContract) {
          this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
          return;
        }

        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        web3Manager.setContractAddress(userContract);
        
        // Проверяем LP баланс перед продажей
        let lpBalance = '0';
        try {
          lpBalance = await web3Manager.getLpBalance(tokenAddress);
          const lpBalanceNum = parseFloat(lpBalance);
          if (lpBalanceNum === 0) {
            this.bot.sendMessage(chatId, 
              `❌ **Нет LP токенов для продажи**\n\n` +
              `💡 У вас нет LP токенов в контракте для этого токена.\n` +
              `📊 Сначала купите токены через zap-in, чтобы создать LP позицию.\n\n` +
              `📍 Токен: \`${tokenAddress}\``,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        } catch (e) {
          console.warn('Не удалось получить LP баланс перед продажей:', e.message);
        }
        
        const txHash = await this.runTokenAction(chatId, 'sell', tokenAddress, () =>
          web3Manager.exitAndSell(tokenAddress)
        );
        
        const explorerUrl = this.getExplorerUrl(chatId);
        const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
        this.bot.sendMessage(chatId, 
          `✅ Exit-and-sell выполнен успешно!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `💸 Все LP токены конвертированы в ${networkConfig.nativeCurrency}\n` +
          `🔗 Транзакция: ${explorerUrl}/tx/${txHash}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        let errorMessage = error.message;
        
        // Улучшаем сообщение об ошибке
        if (errorMessage.includes('NO_LP') || errorMessage.includes('нет LP токенов')) {
          errorMessage = `❌ **Нет LP токенов для продажи**\n\n` +
            `💡 У вас нет LP токенов в контракте для этого токена.\n` +
            `📊 Сначала купите токены через zap-in, чтобы создать LP позицию.\n\n` +
            `📍 Токен: \`${tokenAddress}\``;
        } else if (errorMessage.includes('TOKEN_NOT_SUPPORTED')) {
          errorMessage = `❌ **Токен не поддерживается**\n\n` +
            `💡 Этот токен не добавлен в контракт или был удален.\n` +
            `📍 Токен: \`${tokenAddress}\``;
        } else if (errorMessage.includes('отклонена')) {
          errorMessage = `❌ **Транзакция отклонена**\n\n` +
            `💡 Транзакция была отклонена контрактом.\n\n` +
            `**Возможные причины:**\n` +
            `• Нет LP токенов для продажи\n` +
            `• Недостаточно ликвидности в пуле\n` +
            `• Токен неактивен\n\n` +
            `📍 Токен: \`${tokenAddress}\``;
        }
        
        this.bot.sendMessage(chatId, errorMessage, { parse_mode: 'Markdown' });
      } finally {
        this.clearPendingInput(chatId, 'exit');
      }
    });
  }

  async handleBalance(chatId) {
    const user = this.userManager.getUser(chatId);
    const userContract = user ? this.userManager.getUserContract(chatId) : null;
    if (!user || !userContract) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      web3Manager.setContractAddress(userContract);
      
        const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
        const walletBalance = await web3Manager.getWalletBalance();
        const contractEthBalance = await web3Manager.getEthBalance();
        const walletAddress = web3Manager.getWalletAddress();
      
        this.bot.sendMessage(chatId, 
          `💰 Балансы (${networkConfig.name}):\n\n` +
          `👤 Ваш кошелек: \`${walletAddress}\`\n` +
          `💳 Баланс кошелька: ${walletBalance} ${networkConfig.nativeCurrency}\n` +
          `🏦 Баланс контракта: ${contractEthBalance} ${networkConfig.nativeCurrency}\n\n` +
          `Используйте /tokens для просмотра LP балансов`,
          { parse_mode: 'Markdown' }
        );
    } catch (error) {
      this.bot.sendMessage(chatId, `❌ Ошибка получения балансов: ${error.message}`);
    }
  }

  async handleTokens(chatId) {
    const user = this.userManager.getUser(chatId);
    const userContract = user ? this.userManager.getUserContract(chatId) : null;
    if (!user || !userContract) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      web3Manager.setContractAddress(userContract);
      
      const allTokens = await this.web3Manager.getAllTokens();
      const hiddenTokens = new Set(this.userManager.getHiddenTokens(chatId).map(address => address.toLowerCase()));
      const tokens = allTokens.filter(address => !hiddenTokens.has(address.toLowerCase()));
      
      if (tokens.length === 0) {
        this.bot.sendMessage(chatId, '📝 Список токенов пуст. Отправьте адрес токена и нажмите Buy.');
        return;
      }

      let message = '🪙 Поддерживаемые токены:\n\n';
      
      for (let i = 0; i < tokens.length; i++) {
        let tokenInfo, lpBalance, tokenBalance;
        try {
          tokenInfo = await web3Manager.getTokenInfo(tokens[i]);
          lpBalance = await web3Manager.getLpBalance(tokens[i]);
          tokenBalance = await web3Manager.getTokenBalance(tokens[i]);
        } catch (error) {
          console.warn(`Ошибка получения данных для токена ${tokens[i]}:`, error.message);
          tokenInfo = { lpToken: '0x0000...0000', isActive: true };
          lpBalance = '0';
          tokenBalance = '0';
        }
        
        message += `${i + 1}. Токен: \`${tokens[i]}\`\n`;
        message += `   LP: \`${tokenInfo.lpToken}\`\n`;
        message += `   Статус: ${tokenInfo.isActive ? '✅ Активен' : '❌ Неактивен'}\n`;
        message += `   LP баланс: ${lpBalance}\n`;
        message += `   Токен баланс: ${tokenBalance}\n\n`;
      }
      
      this.bot.sendMessage(chatId, this.truncateMessage(message), { parse_mode: 'Markdown' });
    } catch (error) {
      this.bot.sendMessage(chatId, `❌ Ошибка получения токенов: ${error.message}`);
    }
  }

  handleCreateSniper(chatId) {
    const user = this.userManager.getUser(chatId);
    const userNetwork = user ? this.userManager.getUserNetwork(chatId) : config.DEFAULT_NETWORK;
    const userContract = user ? this.userManager.getUserContract(chatId, userNetwork) : null;
    const networkConfig = config.getNetworkConfig(userNetwork);

    if (!user || !userContract) {
      this.bot.sendMessage(chatId, 'Deploy the contract first with /deploy');
      return;
    }

    this.bot.sendMessage(
      chatId,
      `Send deployer address and buy amount in this format:\n\n` +
      `\`deployer_address,amount_${networkConfig.nativeCurrency}\`\n\n` +
      `Example: \`0x1234...,0.02\`\n\n` +
      `Network: ${userNetwork}`,
      { parse_mode: 'Markdown' }
    );

    this.setPendingInput(chatId, 'sniper');
    this.bot.once('message', async (msg) => {
      if (msg.chat.id !== chatId) return;

      try {
        const [deployerRaw, amountRaw] = (msg.text || '').split(',').map(item => item.trim());
        const amount = parseFloat(amountRaw);

        if (!ethers.isAddress(deployerRaw)) {
          throw new Error('Invalid deployer address');
        }
        if (!amount || amount <= 0) {
          throw new Error('Invalid buy amount');
        }

        const web3Manager = this.getWeb3ManagerForUser(chatId);
        const startBlock = await web3Manager.provider.getBlockNumber();
        const sniper = this.sniperManager.createSniper(chatId, {
          deployer: ethers.getAddress(deployerRaw),
          amount,
          network: userNetwork,
          startBlock
        });

        await this.bot.sendMessage(
          chatId,
          `✅ Sniper enabled\n\n` +
          `ID: #${sniper.id}\n` +
          `Deployer: \`${ethers.getAddress(deployerRaw)}\`\n` +
          `Amount: ${amount} ${networkConfig.nativeCurrency}\n` +
          `Network: ${userNetwork}\n` +
          `Start block: ${startBlock}\n\n` +
          `The bot will buy after it sees a new token and confirmed pair liquidity.`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        await this.bot.sendMessage(chatId, `Sniper setup error: ${error.message}`);
      } finally {
        this.clearPendingInput(chatId, 'sniper');
      }
    });
  }

  handleSnipers(chatId) {
    const snipers = this.sniperManager.getSnipers(chatId);
    if (snipers.length === 0) {
      this.bot.sendMessage(chatId, 'No sniper tasks.');
      return;
    }

    const lines = ['🎯 Snipers:\n'];
    for (const sniper of snipers.slice(-20)) {
      const shortDeployer = `${sniper.deployer.slice(0, 6)}...${sniper.deployer.slice(-4)}`;
      const tokenText = sniper.detectedToken ? `\nToken: \`${sniper.detectedToken}\`` : '';
      lines.push(
        `#${sniper.id} | ${sniper.status}\n` +
        `Network: ${sniper.network}\n` +
        `Deployer: \`${shortDeployer}\`\n` +
        `Amount: ${sniper.amount}${tokenText}\n`
      );
    }

    this.bot.sendMessage(chatId, this.truncateMessage(lines.join('\n')), { parse_mode: 'Markdown' });
  }

  handleStopSniper(chatId, id = null) {
    if (id) {
      const sniper = this.sniperManager.stopSniper(chatId, id);
      this.bot.sendMessage(chatId, sniper ? `Sniper #${id} stopped.` : `Sniper #${id} not found.`);
      return;
    }

    this.bot.sendMessage(chatId, 'Send sniper ID to stop:');
    this.setPendingInput(chatId, 'sniperstop');
    this.bot.once('message', (msg) => {
      if (msg.chat.id !== chatId) return;
      try {
        const sniperId = (msg.text || '').trim();
        const sniper = this.sniperManager.stopSniper(chatId, sniperId);
        this.bot.sendMessage(chatId, sniper ? `Sniper #${sniperId} stopped.` : `Sniper #${sniperId} not found.`);
      } finally {
        this.clearPendingInput(chatId, 'sniperstop');
      }
    });
  }

  setupCallbackHandlers() {
    this.bot.on('callback_query', async (query) => {
      const data = query.data || '';
      const chatId = query.message?.chat?.id;
      const messageId = query.message?.message_id;

      if (!chatId) {
        return;
      }

      try {
        if (data === 'cancel' || data === 'cancel_network') {
          await this.bot.answerCallbackQuery(query.id);
          return;
        }

        if (data === 'home_register') {
          await this.bot.sendMessage(chatId, 'Use /register and send your private key.');
        } else if (data === 'home_deploy') {
          await this.bot.sendMessage(chatId, 'Use /deploy to deploy the contract on the selected network.');
        } else if (data === 'home_open_token') {
          await this.bot.sendMessage(chatId, 'Send a token address to open buy/sell actions.');
        } else if (data === 'home_positions') {
          await this.handlePositions(chatId);
        } else if (data === 'home_zapin') {
          await this.bot.sendMessage(chatId, 'Use /zapin and send `token_address,amount_ETH`.', { parse_mode: 'Markdown' });
          this.handleZapIn(chatId);
        } else if (data === 'home_exit') {
          await this.handlePositions(chatId);
        } else if (data === 'home_balance') {
          await this.handleBalance(chatId);
        } else if (data === 'home_tokens') {
          await this.handleTokens(chatId);
        } else if (data === 'home_sniper') {
          this.handleCreateSniper(chatId);
        } else if (data === 'home_snipers') {
          this.handleSnipers(chatId);
        } else if (data === 'home_network') {
          this.showNetworkSelection(chatId);
        } else if (data === 'home_help') {
          await this.bot.sendMessage(chatId, 'Main flow: /register -> /deploy -> send token address -> buy -> sell all.');
        } else if (data.startsWith('switch_network_')) {
          const networkName = data.replace('switch_network_', '');
          this.userManager.setUserNetwork(chatId, networkName);
          await this.bot.sendMessage(chatId, `Network switched to ${networkName}.`);
        } else if (data === 'remove_token_menu') {
          this.handleRemoveToken(chatId);
        } else if (data.startsWith('remove_token_')) {
          const tokenAddress = data.replace('remove_token_', '');
          const user = this.userManager.getUser(chatId);
          if (!user) {
            throw new Error('Register first with /register');
          }

          this.userManager.hideToken(chatId, tokenAddress);
          await this.bot.sendMessage(
            chatId,
            `Token hidden from bot lists.\n\nToken: \`${tokenAddress}\`\nNo contract transaction was sent.`,
            { parse_mode: 'Markdown' }
          );
        } else if (data.startsWith('select_token_')) {
          const tokenAddress = data.replace('select_token_', '');
          await this.showTokenPosition(chatId, tokenAddress, messageId);
        } else if (data.startsWith('buy_')) {
          const match = data.match(/^buy_(0x[a-fA-F0-9]{40})_(.+)$/);
          if (!match) {
            throw new Error('Invalid buy callback format');
          }

          const [, tokenAddress, amountValue] = match;
          const amount = parseFloat(amountValue);
          const user = this.userManager.getUser(chatId);
          const userContract = user ? this.userManager.getUserContract(chatId) : null;
          if (!user || !userContract) {
            throw new Error('Deploy the contract first with /deploy');
          }

          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          web3Manager.setContractAddress(userContract);
          const buyResult = await this.runTokenAction(chatId, 'buy', tokenAddress, () =>
            this.autoAddAndZapIn(chatId, web3Manager, tokenAddress, amount)
          );
          this.userManager.unhideToken(chatId, tokenAddress);
          const explorerUrl = this.getExplorerUrl(chatId);
          const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
          const autoAddText = buyResult.added ? `Auto-add: ${buyResult.pairType} pair was registered.\n` : '';
          await this.bot.sendMessage(chatId, `Buy completed.\n\nToken: \`${tokenAddress}\`\nAmount: ${amount} ${networkConfig.nativeCurrency}\n${autoAddText}Transaction: ${explorerUrl}/tx/${buyResult.txHash}`, { parse_mode: 'Markdown' });
          await this.showTokenPosition(chatId, tokenAddress);
        } else if (data.startsWith('custom_amount_')) {
          const tokenAddress = data.replace('custom_amount_', '');
          await this.bot.sendMessage(chatId, 'Send buy amount in ETH, for example: 0.01');
          this.setPendingInput(chatId, 'custom_amount');
          this.bot.once('message', async (msg) => {
            if (msg.chat.id !== chatId) return;
            try {
              const amount = parseFloat((msg.text || '').trim());
              if (!amount || amount <= 0) {
                throw new Error('Invalid amount');
              }

              const user = this.userManager.getUser(chatId);
              const userContract = user ? this.userManager.getUserContract(chatId) : null;
              if (!user || !userContract) {
                throw new Error('Deploy the contract first with /deploy');
              }

              const web3Manager = this.getWeb3ManagerForUser(chatId);
              web3Manager.setPrivateKey(user.privateKey);
              web3Manager.setContractAddress(userContract);
              const buyResult = await this.runTokenAction(chatId, 'buy', tokenAddress, () =>
                this.autoAddAndZapIn(chatId, web3Manager, tokenAddress, amount)
              );
              this.userManager.unhideToken(chatId, tokenAddress);
              const explorerUrl = this.getExplorerUrl(chatId);
              await this.bot.sendMessage(chatId, `Buy completed.\n\nToken: \`${tokenAddress}\`\nAmount: ${amount}\nTransaction: ${explorerUrl}/tx/${buyResult.txHash}`, { parse_mode: 'Markdown' });
              await this.showTokenPosition(chatId, tokenAddress);
            } catch (error) {
              await this.bot.sendMessage(chatId, `Buy error: ${error.message}`);
            } finally {
              this.clearPendingInput(chatId, 'custom_amount');
            }
          });
        } else if (data.startsWith('sell_all_')) {
          const tokenAddress = data.replace('sell_all_', '');
          const user = this.userManager.getUser(chatId);
          const userContract = user ? this.userManager.getUserContract(chatId) : null;
          if (!user || !userContract) {
            throw new Error('Deploy the contract first with /deploy');
          }

          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          web3Manager.setContractAddress(userContract);
          const txHash = await this.runTokenAction(chatId, 'sell', tokenAddress, () =>
            web3Manager.exitAndSell(tokenAddress)
          );
          const explorerUrl = this.getExplorerUrl(chatId);
          await this.bot.sendMessage(chatId, `Sell completed.\n\nToken: \`${tokenAddress}\`\nTransaction: ${explorerUrl}/tx/${txHash}`, { parse_mode: 'Markdown' });
        }

        await this.bot.answerCallbackQuery(query.id);
      } catch (error) {
        await this.bot.answerCallbackQuery(query.id, { text: 'Action failed', show_alert: false }).catch(() => {});
        await this.bot.sendMessage(chatId, `Action error: ${error.message}`);
      }
    });
  }

  showNetworkSelection(chatId) {
    const user = this.userManager.getUser(chatId);
    const currentNetwork = user ? this.userManager.getUserNetwork(chatId) : config.DEFAULT_NETWORK;
    
    let message = '🌐 **Выбор сети**\n\n';
    message += `Текущая сеть: **${config.getNetworkConfig(currentNetwork).name}** (${currentNetwork})\n\n`;
    message += 'Выберите сеть для работы:';
    
    const networkKeyboard = {
      inline_keyboard: [
        [
          { 
            text: `${currentNetwork === 'ETH' ? '✅' : ''} Ethereum (ETH)`, 
            callback_data: 'switch_network_ETH' 
          }
        ],
        [
          { 
            text: `${currentNetwork === 'BSC' ? '✅' : ''} Binance Smart Chain (BSC)`, 
            callback_data: 'switch_network_BSC' 
          }
        ],
        [
          { 
            text: `${currentNetwork === 'BASE' ? '✅' : ''} Base (BASE)`, 
            callback_data: 'switch_network_BASE' 
          }
        ],
        [
          { 
            text: `${currentNetwork === 'ROBINHOOD' ? '✅' : ''} Robinhood Chain (ROBINHOOD)`, 
            callback_data: 'switch_network_ROBINHOOD' 
          }
        ],
        [
          { 
            text: `${currentNetwork === 'MONAD' ? '✅' : ''} Monad (MONAD)`, 
            callback_data: 'switch_network_MONAD' 
          }
        ],
        [
          { 
            text: `${currentNetwork === 'MEGAETH' ? '✅' : ''} MegaETH (MEGAETH)`, 
            callback_data: 'switch_network_MEGAETH' 
          }
        ],
        [
          { text: '❌ Отмена', callback_data: 'cancel_network' }
        ]
      ]
    };
    
    this.bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: networkKeyboard
    });
  }
}

// Запуск бота
const bot = new TelegramBotManager();
