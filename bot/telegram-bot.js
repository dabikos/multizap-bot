const TelegramBot = require('node-telegram-bot-api');
const Web3Manager = require('./web3Manager');
const UserManager = require('./userManager');
const config = require('./config');

class TelegramBotManager {
  constructor() {
    this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.web3Manager = new Web3Manager();
    this.userManager = new UserManager();
    this.setupCommands();
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

  // Получить explorer URL для текущей сети пользователя
  getExplorerUrl(chatId) {
    const userNetwork = this.userManager.getUserNetwork(chatId);
    return config.getExplorerUrl(userNetwork);
  }

  // Обрезать сообщение до максимальной длины для Telegram (4096 символов)
  truncateMessage(message, maxLength = 4000) {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 50) + '\n\n... (сообщение обрезано)';
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
      tokenPrice = { name: 'Unknown', symbol: 'UNKNOWN', price: 0, priceUsd: 0, marketCap: 0, ethPrice: 3000 };
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
    const status = tokenInfo.isActive ? '✅ Активен' : '❌ Неактивен';
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
    const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
    const nativeCurrency = networkConfig.nativeCurrency;
    let message = `🪙 **${tokenPrice.name} (${tokenPrice.symbol})**\n\n` +
      `📍 Адрес: \`${shortAddress}\`\n` +
      `💰 Цена: ${tokenPrice.price.toFixed(8)} ${nativeCurrency} ($${tokenPrice.priceUsd.toFixed(4)})\n` +
      `📊 Маркеткап: ${formatMarketCap(tokenPrice.marketCap)}\n` +
      `🔄 Статус: ${status}\n` +
      `💎 LP баланс: ${hasLpBalance ? '✅ ' : '⚠️ '}${lpBalance}\n` +
      `🪙 Токен баланс: ${tokenBalance}\n` +
      `📈 ${nativeCurrency} цена: $${tokenPrice.ethPrice.toFixed(2)}\n`;
    
    // Добавляем предупреждение если нет LP баланса
    if (!hasLpBalance) {
      message += `\n⚠️ **Нет LP токенов для продажи**\n` +
        `💡 Сначала купите токены через zap-in, чтобы создать LP позицию.`;
    }
    
    message += `\n\n💡 Выберите действие:`;
    
    // Обрезаем сообщение если слишком длинное
    message = this.truncateMessage(message);
    
    // Показываем кнопки с действиями
    const actionKeyboard = {
      inline_keyboard: [
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
          { text: '💸 Продать все', callback_data: `sell_${tokenAddress}` }
        ],
        [
          { text: '📊 Обновить', callback_data: `select_token_${tokenAddress}` },
          { text: '❌ Отмена', callback_data: 'cancel' }
        ]
      ]
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
      { command: 'addtoken', description: '🪙 Добавить токен' },
      { command: 'tokens', description: '📝 Список токенов' },
      { command: 'positions', description: '📊 Мои позиции' },
      { command: 'zapin', description: '💰 Купить токены' },
      { command: 'exit', description: '🔄 Продать позиции' },
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
• Работать с несколькими сетями: ETH, BSC и BASE
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
/addtoken - Добавить новый токен
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
      
      const userNetwork = user ? this.userManager.getUserNetwork(chatId) : 'BSC';
      const networkConfig = config.getNetworkConfig(userNetwork);
      const userContract = user ? this.userManager.getUserContract(chatId, userNetwork) : null;
      
      let message = '🏠 **Главное меню MultiZap Bot**\n\n';
      message += `🌐 **Текущая сеть:** ${networkConfig.name} (${userNetwork})\n\n`;
      
      if (userContract) {
        message += `✅ Контракт развернут: \`${userContract.slice(0, 6)}...${userContract.slice(-4)}\`\n\n`;
      } else {
        message += `❌ Контракт не развернут в сети ${userNetwork}\n\n`;
      }
      
      message += '💡 Выберите действие:';
      
      const homeKeyboard = {
        inline_keyboard: [
          [
            { text: '🔐 Регистрация', callback_data: 'home_register' },
            { text: '🚀 Развернуть контракт', callback_data: 'home_deploy' }
          ],
          [
            { text: '🪙 Добавить токен', callback_data: 'home_addtoken' },
            { text: '📊 Позиции', callback_data: 'home_positions' }
          ],
          [
            { text: '💰 Zap-in', callback_data: 'home_zapin' },
            { text: '💸 Exit & Sell', callback_data: 'home_exit' }
          ],
          [
            { text: '💰 Балансы', callback_data: 'home_balance' },
            { text: '📝 Список токенов', callback_data: 'home_tokens' }
          ],
          [
            { text: '🌐 Сеть', callback_data: 'home_network' },
            { text: '❓ Помощь', callback_data: 'home_help' }
          ]
        ]
      };
      
      this.bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: homeKeyboard
      });
    });

    // Команда /register
    this.bot.onText(/\/register/, (msg) => {
      const chatId = msg.chat.id;
      this.bot.sendMessage(chatId, 
        '🔐 Введите ваш приватный ключ для регистрации:\n\n' +
        '⚠️ Внимание: Приватный ключ будет сохранен локально и используется только для подписи транзакций.'
      );
      
      this.bot.once('message', (msg) => {
        let privateKey = msg.text.trim();
        
        // Проверяем формат приватного ключа (с 0x или без)
        if (privateKey && (
          (privateKey.startsWith('0x') && privateKey.length === 66) || 
          (!privateKey.startsWith('0x') && privateKey.length === 64)
        )) {
          // Добавляем 0x если его нет
          if (!privateKey.startsWith('0x')) {
            privateKey = '0x' + privateKey;
          }
          
          const success = this.userManager.addUser(chatId, privateKey);
          if (success) {
            this.bot.sendMessage(chatId, '✅ Регистрация успешна! Теперь вы можете использовать команду /deploy');
          } else {
            this.bot.sendMessage(chatId, '❌ Ошибка регистрации. Попробуйте еще раз.');
          }
        } else {
          this.bot.sendMessage(chatId, '❌ Неверный формат приватного ключа. Введите 64-символьный ключ (с 0x или без).');
        }
      });
    });

    // Команда /network - переключение сети
    this.bot.onText(/\/network/, (msg) => {
      const chatId = msg.chat.id;
      this.showNetworkSelection(chatId);
    });

    // Команда /deploy
    this.bot.onText(/\/deploy/, async (msg) => {
      const chatId = msg.chat.id;
      let user = this.userManager.getUser(chatId);
      
      // Если пользователь не зарегистрирован, используем приватный ключ из config
      if (!user) {
        if (config.PRIVATE_KEY && config.PRIVATE_KEY !== 'your_private_key_here') {
          this.bot.sendMessage(chatId, '⚠️ Используется приватный ключ из конфигурации. Для безопасности рекомендуется зарегистрироваться командой /register');
          user = { privateKey: config.PRIVATE_KEY };
        } else {
          this.bot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь командой /register или настройте приватный ключ в config.js');
          return;
        }
      }

      try {
        this.bot.sendMessage(chatId, '⏳ Развертывание контракта...');
        
        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const contractAddress = await web3Manager.deployMultiZap();
        
        const userNetwork = this.userManager.getUserNetwork(chatId);
        this.userManager.updateUserContract(chatId, contractAddress, userNetwork);
        
        const explorerUrl = this.getExplorerUrl(chatId);
        this.bot.sendMessage(chatId, 
          `✅ Контракт успешно развернут!\n\n` +
          `📍 Адрес контракта: \`${contractAddress}\`\n` +
          `🌐 Сеть: ${userNetwork}\n` +
          `🔗 Explorer: ${explorerUrl}/address/${contractAddress}\n\n` +
          `Теперь вы можете добавлять токены командой /addtoken`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Ошибка развертывания: ${error.message}`);
      }
    });

    // Команда /addtoken
    this.bot.onText(/\/addtoken/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      this.bot.sendMessage(chatId, 
        '🪙 Введите адрес токена для автоматического поиска LP:\n\n' +
        '**Формат 1 (автоматический поиск):**\n' +
        '`адрес_токена`\n\n' +
        '**Формат 2 (ручное указание LP):**\n' +
        '`адрес_токена,адрес_LP_токена`\n\n' +
        'Примеры:\n' +
        '• `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e` (автопоиск)\n' +
        '• `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e,0x1234...5678` (с LP адресом)\n\n' +
        '💡 Если автоматический поиск не работает (новые токены), используйте формат 2.',
        { parse_mode: 'Markdown' }
      );

      this.bot.once('message', async (msg) => {
        try {
          const input = msg.text.trim();
          const parts = input.split(',').map(p => p.trim());
          
          let tokenAddress, lpTokenAddress;
          
          if (parts.length === 1) {
            // Автоматический поиск
            tokenAddress = parts[0];
            lpTokenAddress = null;
          } else if (parts.length === 2) {
            // Ручное указание LP
            tokenAddress = parts[0];
            lpTokenAddress = parts[1];
          } else {
            this.bot.sendMessage(chatId, '❌ Неверный формат. Используйте: `адрес_токена` или `адрес_токена,адрес_LP`');
            return;
          }
          
          if (!tokenAddress || !tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
            this.bot.sendMessage(chatId, '❌ Неверный формат адреса токена. Попробуйте еще раз с /addtoken');
            return;
          }
          
          if (lpTokenAddress && (!lpTokenAddress.startsWith('0x') || lpTokenAddress.length !== 42)) {
            this.bot.sendMessage(chatId, '❌ Неверный формат адреса LP токена. Попробуйте еще раз с /addtoken');
            return;
          }

          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          const userContract = this.userManager.getUserContract(chatId);
          web3Manager.setContractAddress(userContract);
          
          let txHash;
          if (lpTokenAddress) {
            // Ручное добавление с LP адресом
            this.bot.sendMessage(chatId, '🔍 Добавление токена с указанным LP адресом...');
            txHash = await web3Manager.addToken(tokenAddress, lpTokenAddress);
          } else {
            // Автоматический поиск
            this.bot.sendMessage(chatId, '🔍 Поиск LP токена...');
            txHash = await web3Manager.addTokenAuto(tokenAddress);
          }
          
          const explorerUrl = this.getExplorerUrl(chatId);
          this.bot.sendMessage(chatId, 
            `✅ Токен успешно добавлен!\n\n` +
            `📍 Токен: \`${tokenAddress}\`\n` +
            (lpTokenAddress ? `📍 LP токен: \`${lpTokenAddress}\`\n` : '') +
            `🔗 Транзакция: ${explorerUrl}/tx/${txHash}\n\n` +
            `📊 Открываю ваши позиции...`,
            { parse_mode: 'Markdown' }
          );

          // Автоматически показываем позиции после добавления токена
          setTimeout(async () => {
            try {
              const tokens = await web3Manager.getAllTokens();
              
              if (tokens.length === 0) {
                this.bot.sendMessage(chatId, '📝 Список позиций пуст.');
                return;
              }

              let message = '📊 Ваши позиции:\n\n';
              const keyboard = [];
              
              for (let i = 0; i < tokens.length; i++) {
                const tokenInfo = await web3Manager.getTokenInfo(tokens[i]);
                const shortAddress = `${tokens[i].slice(0, 6)}...${tokens[i].slice(-4)}`;
                const status = tokenInfo.isActive ? '✅' : '❌';
                
                message += `${i + 1}. ${status} \`${shortAddress}\`\n`;
                
                // Создаем кнопку для каждого токена
                keyboard.push([{
                  text: `${i + 1}. ${shortAddress} ${status}`,
                  callback_data: `select_token_${tokens[i]}`
                }]);
              }

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
          }, 2000); // Задержка 2 секунды для подтверждения транзакции
        } catch (error) {
          this.bot.sendMessage(chatId, `❌ Ошибка добавления токена: ${error.message}`);
        }
      });
    });

    // Команда /zapin
    this.bot.onText(/\/zapin/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      this.bot.sendMessage(chatId, 
        '💰 Введите адрес токена и количество ETH в формате:\n\n' +
        '`токен_адрес,количество_ETH`\n\n' +
        'Пример: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e,0.01`',
        { parse_mode: 'Markdown' }
      );

      this.bot.once('message', async (msg) => {
        try {
          const [tokenAddress, amountStr] = msg.text.split(',').map(item => item.trim());
          const amount = parseFloat(amountStr);
          
          if (!tokenAddress || isNaN(amount) || amount <= 0) {
            this.bot.sendMessage(chatId, '❌ Неверный формат. Попробуйте еще раз с /zapin');
            return;
          }

          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          const userContract = this.userManager.getUserContract(chatId);
          web3Manager.setContractAddress(userContract);
          
          const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
          const txHash = await web3Manager.zapIn(tokenAddress, amount);
          
          const explorerUrl = this.getExplorerUrl(chatId);
          this.bot.sendMessage(chatId, 
            `✅ Zap-in выполнен успешно!\n\n` +
            `📍 Токен: \`${tokenAddress}\`\n` +
            `💰 Сумма: ${amount} ${networkConfig.nativeCurrency}\n` +
            `🔗 Транзакция: ${explorerUrl}/tx/${txHash}\n\n` +
            `⏳ Загружаю позицию...`,
            { parse_mode: 'Markdown' }
          );
          
          // Открываем позицию токена после покупки
          setTimeout(async () => {
            try {
              await this.showTokenPosition(chatId, tokenAddress);
            } catch (error) {
              console.error('Ошибка открытия позиции после покупки:', error.message);
            }
          }, 2000); // Задержка 2 секунды для подтверждения транзакции
        } catch (error) {
          this.bot.sendMessage(chatId, `❌ Ошибка zap-in: ${error.message.substring(0, 100)}...`);
        }
      });
    });

    // Команда /exit
    this.bot.onText(/\/exit/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      this.bot.sendMessage(chatId, 
        '🔄 Введите адрес токена для exit-and-sell:\n\n' +
        'Пример: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e`',
        { parse_mode: 'Markdown' }
      );

      this.bot.once('message', async (msg) => {
        try {
          const tokenAddress = msg.text.trim();
          
          if (!tokenAddress) {
            this.bot.sendMessage(chatId, '❌ Неверный формат. Попробуйте еще раз с /exit');
            return;
          }

          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          const userContract = this.userManager.getUserContract(chatId);
          web3Manager.setContractAddress(userContract);
          
          const txHash = await web3Manager.exitAndSell(tokenAddress);
          
          const explorerUrl = this.getExplorerUrl(chatId);
          this.bot.sendMessage(chatId, 
            `✅ Exit-and-sell выполнен успешно!\n\n` +
            `📍 Токен: \`${tokenAddress}\`\n` +
            `🔗 Транзакция: ${explorerUrl}/tx/${txHash}`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          this.bot.sendMessage(chatId, `❌ Ошибка exit-and-sell: ${error.message}`);
        }
      });
    });

    // Команда /balance
    this.bot.onText(/\/balance/, async (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const userContract = this.userManager.getUserContract(chatId);
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
    });

    // Команда /positions - показать позиции с кнопками для покупки
    this.bot.onText(/\/positions/, async (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const userContract = this.userManager.getUserContract(chatId);
        web3Manager.setContractAddress(userContract);
        
        const tokens = await web3Manager.getAllTokens();
        
        if (tokens.length === 0) {
          this.bot.sendMessage(chatId, '📝 Список позиций пуст. Добавьте токены командой /addtoken');
          return;
        }

        let message = '📊 Ваши позиции:\n\n';
        const keyboard = [];
        
        for (let i = 0; i < tokens.length; i++) {
          const tokenInfo = await this.web3Manager.getTokenInfo(tokens[i]);
          const shortAddress = `${tokens[i].slice(0, 6)}...${tokens[i].slice(-4)}`;
          const status = tokenInfo.isActive ? '✅' : '❌';
          
          message += `${i + 1}. ${status} \`${shortAddress}\`\n`;
          
          // Создаем кнопку для каждого токена
          keyboard.push([{
            text: `${i + 1}. ${shortAddress} ${status}`,
            callback_data: `select_token_${tokens[i]}`
          }]);
        }

        const replyMarkup = {
          inline_keyboard: keyboard
        };

        this.bot.sendMessage(chatId, message + '\n💡 Выберите токен для покупки:', { 
          parse_mode: 'Markdown',
          reply_markup: replyMarkup
        });
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Ошибка получения позиций: ${error.message}`);
      }
    });

    // Команда /tokens
    this.bot.onText(/\/tokens/, async (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      const userContract = user ? this.userManager.getUserContract(chatId) : null;
      if (!user || !userContract) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const userContract = this.userManager.getUserContract(chatId);
        web3Manager.setContractAddress(userContract);
        
        const tokens = await web3Manager.getAllTokens();
        
        if (tokens.length === 0) {
          this.bot.sendMessage(chatId, '📝 Список токенов пуст. Добавьте токены командой /addtoken');
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
    });

    // Команда /menu - быстрый доступ к командам
    this.bot.onText(/\/menu/, (msg) => {
      const chatId = msg.chat.id;
      const menuMessage = `
📋 **Меню команд MultiZap Bot**

**Основные:**
🚀 /start - Начать работу
🏠 /home - Главное меню
🔐 /register - Добавить ключ
🚀 /deploy - Развернуть контракт

**Токены:**
🪙 /addtoken - Добавить токен
📝 /tokens - Список токенов
📊 /positions - Мои позиции

**Операции:**
💰 /zapin - Купить токены
🔄 /exit - Продать позиции
💰 /balance - Балансы

**Информация:**
❓ /help - Подробная справка
📊 /status - Статус бота

💡 **Совет:** Используйте кнопку "📋" рядом с полем ввода для быстрого доступа к командам!
      `;
      this.bot.sendMessage(chatId, menuMessage, { parse_mode: 'Markdown' });
    });

    // Команда /help
    this.bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = `
📚 Справка по командам MultiZap Bot:

🔐 /register - Регистрация (добавить приватный ключ)
🚀 /deploy - Развернуть MultiZap контракт
🪙 /addtoken - Добавить новый токен
📊 /positions - Просмотр позиций с быстрой покупкой
💰 /zapin - Выполнить zap-in операцию
🔄 /exit - Выполнить exit-and-sell операцию
💰 /balance - Показать балансы
📝 /tokens - Список поддерживаемых токенов
🏠 /home - Главное меню с кнопками
❓ /help - Эта справка

📋 Примеры использования:

1. Регистрация:
   /register
   (введите приватный ключ)

2. Развертывание контракта:
   /deploy

3. Добавление токена:
   /addtoken
   (введите: адрес_токена,адрес_LP_токена)

4. Zap-in операция:
   /zapin
   (введите: адрес_токена,количество_ETH)

5. Exit операция:
   /exit
   (введите: адрес_токена)

⚠️ Безопасность:
• Никогда не передавайте приватный ключ третьим лицам
• Проверяйте адреса токенов перед операциями
• Используйте только проверенные токены
      `;
      this.bot.sendMessage(chatId, helpMessage);
    });

    // Обработка callback-кнопок
    this.bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      const user = this.userManager.getUser(chatId);
      
      if (!user || !user.contractAddress) {
        this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Сначала разверните контракт командой /deploy' });
        return;
      }

      try {
        // Обработка выбора токена
        if (data.startsWith('select_token_')) {
          const tokenAddress = data.replace('select_token_', '');
          await this.showTokenPosition(chatId, tokenAddress, callbackQuery.message.message_id);
          this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Информация о токене загружена' });
        }
        
        // Обработка покупки с фиксированной суммой
        else if (data.startsWith('buy_')) {
          const [, tokenAddress, amount] = data.split('_');
          const amountFloat = parseFloat(amount);
          
          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          const userContract = this.userManager.getUserContract(chatId);
          web3Manager.setContractAddress(userContract);
          
          const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
          
          await this.bot.editMessageText(
            `⏳ Выполняется покупка на ${amount} ETH...\n\n` +
            `📍 Токен: \`${shortAddress}\`\n` +
            `💰 Сумма: ${amount} ETH`,
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          
          const txHash = await web3Manager.zapIn(tokenAddress, amountFloat);
          
          const explorerUrl = this.getExplorerUrl(chatId);
          const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
          
          // Показываем успешную покупку
          await this.bot.editMessageText(
            `✅ Покупка выполнена успешно!\n\n` +
            `📍 Токен: \`${shortAddress}\`\n` +
            `💰 Сумма: ${amount} ${networkConfig.nativeCurrency}\n` +
            `🔗 Транзакция: ${explorerUrl}/tx/${txHash}\n\n` +
            `⏳ Загружаю позицию...`,
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          
          this.bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Покупка выполнена!' });
          
          // Открываем позицию токена после покупки
          setTimeout(async () => {
            try {
              await this.showTokenPosition(chatId, tokenAddress);
            } catch (error) {
              console.error('Ошибка открытия позиции после покупки:', error.message);
            }
          }, 2000); // Задержка 2 секунды для подтверждения транзакции
        }
        
        // Обработка пользовательской суммы
        else if (data.startsWith('custom_amount_')) {
          const tokenAddress = data.replace('custom_amount_', '');
          const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
          
          await this.bot.editMessageText(
            `💰 Введите сумму в ETH для покупки токена \`${shortAddress}\`:\n\n` +
            `Пример: 0.05 или 0.1`,
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          
          // Ожидаем ввод пользовательской суммы
          this.bot.once('message', async (msg) => {
            try {
              const customAmount = parseFloat(msg.text.trim());
              
              if (isNaN(customAmount) || customAmount <= 0) {
                this.bot.sendMessage(chatId, '❌ Неверная сумма. Попробуйте еще раз с /positions');
                return;
              }
              
              const web3Manager = this.getWeb3ManagerForUser(chatId);
              web3Manager.setPrivateKey(user.privateKey);
              const userContract = this.userManager.getUserContract(chatId);
              web3Manager.setContractAddress(userContract);
              
              const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
              this.bot.sendMessage(chatId, `⏳ Выполняется покупка на ${customAmount} ${networkConfig.nativeCurrency}...`);
              
              const txHash = await web3Manager.zapIn(tokenAddress, customAmount);
              
              const explorerUrl = this.getExplorerUrl(chatId);
              this.bot.sendMessage(chatId, 
                `✅ Покупка выполнена успешно!\n\n` +
                `📍 Токен: \`${shortAddress}\`\n` +
                `💰 Сумма: ${customAmount} ${networkConfig.nativeCurrency}\n` +
                `🔗 Транзакция: ${explorerUrl}/tx/${txHash}\n\n` +
                `⏳ Загружаю позицию...`,
                { parse_mode: 'Markdown' }
              );
              
              // Открываем позицию токена после покупки
              setTimeout(async () => {
                try {
                  await this.showTokenPosition(chatId, tokenAddress);
                } catch (error) {
                  console.error('Ошибка открытия позиции после покупки:', error.message);
                }
              }, 2000); // Задержка 2 секунды для подтверждения транзакции
            } catch (error) {
              this.bot.sendMessage(chatId, `❌ Ошибка покупки: ${error.message}`);
            }
          });
          
          this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Введите сумму' });
        }
        
        // Обработка продажи токена
        else if (data.startsWith('sell_')) {
          const tokenAddress = data.replace('sell_', '');
          const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
          
          const web3Manager = this.getWeb3ManagerForUser(chatId);
          web3Manager.setPrivateKey(user.privateKey);
          const userContract = this.userManager.getUserContract(chatId);
          web3Manager.setContractAddress(userContract);
          
          await this.bot.editMessageText(
            `⏳ Выполняется продажа токена \`${shortAddress}\`...\n\n` +
            `🔄 Конвертируем LP токены обратно в ETH`,
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          
          try {
            // Проверяем LP баланс перед продажей для более понятного сообщения
            let lpBalance = '0';
            try {
              lpBalance = await web3Manager.getLpBalance(tokenAddress);
            } catch (e) {
              console.warn('Не удалось получить LP баланс перед продажей:', e.message);
            }
            
            const txHash = await web3Manager.exitAndSell(tokenAddress);
            
            const explorerUrl = this.getExplorerUrl(chatId);
            const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
            await this.bot.editMessageText(
              `✅ Продажа выполнена успешно!\n\n` +
              `📍 Токен: \`${shortAddress}\`\n` +
              `💸 Все LP токены конвертированы в ${networkConfig.nativeCurrency}\n` +
              `🔗 Транзакция: ${explorerUrl}/tx/${txHash}\n\n` +
              `💡 Используйте /positions для просмотра обновленных позиций`,
              {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
              }
            );
            
            this.bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Продажа выполнена!' });
          } catch (error) {
            let errorMessage = error.message;
            
            // Улучшаем сообщение об ошибке
            if (errorMessage.includes('NO_LP') || errorMessage.includes('нет LP токенов')) {
              errorMessage = `❌ **Нет LP токенов для продажи**\n\n` +
                `💡 У вас нет LP токенов в контракте для этого токена.\n` +
                `📊 Сначала купите токены через zap-in, чтобы создать LP позицию.\n\n` +
                `📍 Токен: \`${shortAddress}\``;
            } else if (errorMessage.includes('TOKEN_NOT_SUPPORTED')) {
              errorMessage = `❌ **Токен не поддерживается**\n\n` +
                `💡 Этот токен не добавлен в контракт или был удален.\n` +
                `📍 Токен: \`${shortAddress}\``;
            } else if (errorMessage.includes('TOKEN_INACTIVE')) {
              errorMessage = `❌ **Токен неактивен**\n\n` +
                `💡 Этот токен был деактивирован в контракте.\n` +
                `📍 Токен: \`${shortAddress}\``;
            } else if (errorMessage.includes('отклонена')) {
              errorMessage = `❌ **Транзакция отклонена**\n\n` +
                `💡 Транзакция была отклонена контрактом.\n\n` +
                `**Возможные причины:**\n` +
                `• Нет LP токенов для продажи\n` +
                `• Недостаточно ликвидности в пуле\n` +
                `• Токен неактивен\n\n` +
                `📍 Токен: \`${shortAddress}\``;
            } else {
              errorMessage = `❌ **Ошибка продажи**\n\n` +
                `${errorMessage}\n\n` +
                `📍 Токен: \`${shortAddress}\``;
            }
            
            await this.bot.editMessageText(
              errorMessage,
              {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
              }
            );
            
            this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Ошибка продажи' });
          }
        }
        
        // Обработка переключения сети
        else if (data.startsWith('switch_network_')) {
          const networkName = data.replace('switch_network_', '');
          
          if (!this.userManager.isUserExists(chatId)) {
            this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Сначала зарегистрируйтесь командой /register' });
            return;
          }
          
          this.userManager.setUserNetwork(chatId, networkName);
          const networkConfig = config.getNetworkConfig(networkName);
          const userContract = this.userManager.getUserContract(chatId, networkName);
          
          let message = `✅ Сеть изменена на **${networkConfig.name}** (${networkName})\n\n`;
          
          if (userContract) {
            message += `✅ Контракт в этой сети: \`${userContract.slice(0, 6)}...${userContract.slice(-4)}\`\n`;
          } else {
            message += `⚠️ Контракт не развернут в этой сети. Используйте /deploy для развертывания.\n`;
          }
          
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown'
          });
          
          this.bot.answerCallbackQuery(callbackQuery.id, { text: `Сеть изменена на ${networkName}` });
        }
        
        // Обработка кнопок главного меню
        else if (data.startsWith('home_')) {
          const action = data.replace('home_', '');
          
          switch (action) {
            case 'network':
              this.showNetworkSelection(chatId);
              this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Выбор сети' });
              break;
            case 'register':
              this.bot.sendMessage(chatId, 
                '🔐 Введите ваш приватный ключ для регистрации:\n\n' +
                '⚠️ Внимание: Приватный ключ будет сохранен локально и используется только для подписи транзакций.'
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
                    this.bot.sendMessage(chatId, '✅ Регистрация успешна! Теперь вы можете использовать команду /deploy');
                  } else {
                    this.bot.sendMessage(chatId, '❌ Ошибка регистрации. Попробуйте еще раз.');
                  }
                } else {
                  this.bot.sendMessage(chatId, '❌ Неверный формат приватного ключа. Введите 64-символьный ключ (с 0x или без).');
                }
              });
              break;
              
            case 'deploy':
              this.bot.sendMessage(chatId, '⏳ Развертывание контракта...');
              // Вызываем существующую логику deploy
              this.handleDeploy(chatId);
              break;
              
            case 'addtoken':
              this.bot.sendMessage(chatId, 
                '🪙 Введите адрес токена для автоматического поиска LP:\n\n' +
                'Пример: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e`\n\n' +
                'Бот автоматически найдет соответствующий LP токен через Uniswap Factory.',
                { parse_mode: 'Markdown' }
              );
              // Вызываем существующую логику addtoken
              this.handleAddToken(chatId);
              break;
              
            case 'positions':
              // Вызываем существующую логику positions
              this.handlePositions(chatId);
              break;
              
            case 'zapin':
              this.bot.sendMessage(chatId, 
                '💰 Введите адрес токена и количество ETH в формате:\n\n' +
                '`токен_адрес,количество_ETH`\n\n' +
                'Пример: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e,0.01`',
                { parse_mode: 'Markdown' }
              );
              // Вызываем существующую логику zapin
              this.handleZapIn(chatId);
              break;
              
            case 'exit':
              this.bot.sendMessage(chatId, 
                '🔄 Введите адрес токена для exit-and-sell:\n\n' +
                'Пример: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e`',
                { parse_mode: 'Markdown' }
              );
              // Вызываем существующую логику exit
              this.handleExit(chatId);
              break;
              
            case 'balance':
              // Вызываем существующую логику balance
              this.handleBalance(chatId);
              break;
              
            case 'tokens':
              // Вызываем существующую логику tokens
              this.handleTokens(chatId);
              break;
              
            case 'help':
              const helpMessage = `
📚 Справка по командам MultiZap Bot:

🔐 /register - Регистрация (добавить приватный ключ)
🚀 /deploy - Развернуть MultiZap контракт
🪙 /addtoken - Добавить новый токен
📊 /positions - Просмотр позиций с быстрой покупкой
💰 /zapin - Выполнить zap-in операцию
🔄 /exit - Выполнить exit-and-sell операцию
💰 /balance - Показать балансы
📝 /tokens - Список поддерживаемых токенов
🏠 /home - Главное меню с кнопками
❓ /help - Эта справка

📋 Примеры использования:

1. Регистрация:
   /register
   (введите приватный ключ)

2. Развертывание контракта:
   /deploy

3. Добавление токена:
   /addtoken
   (введите: адрес_токена)

4. Zap-in операция:
   /zapin
   (введите: адрес_токена,количество_ETH)

5. Exit операция:
   /exit
   (введите: адрес_токена)

⚠️ Безопасность:
• Никогда не передавайте приватный ключ третьим лицам
• Проверяйте адреса токенов перед операциями
• Используйте только проверенные токены
              `;
              this.bot.sendMessage(chatId, helpMessage);
              break;
          }
          
          this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Выполняется...' });
        }
        
        // Обработка отмены
        else if (data === 'cancel') {
          await this.bot.editMessageText(
            '❌ Операция отменена.\n\nИспользуйте /positions для просмотра позиций.',
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id
            }
          );
          
          this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Операция отменена' });
        }
        
      } catch (error) {
        this.bot.answerCallbackQuery(callbackQuery.id, { text: `❌ Ошибка: ${error.message}` });
        console.error('Ошибка обработки callback:', error);
      }
    });

    // Обработка ошибок
    this.bot.on('error', (error) => {
      console.error('Ошибка бота:', error);
    });

    this.bot.on('polling_error', (error) => {
      console.error('Ошибка polling:', error);
    });

    console.log('🤖 MultiZap Bot запущен!');
  }

  // Методы-обработчики для главного меню
  async handleDeploy(chatId) {
    let user = this.userManager.getUser(chatId);
    
    if (!user) {
      if (config.PRIVATE_KEY && config.PRIVATE_KEY !== 'your_private_key_here') {
        this.bot.sendMessage(chatId, '⚠️ Используется приватный ключ из конфигурации. Для безопасности рекомендуется зарегистрироваться командой /register');
        user = { privateKey: config.PRIVATE_KEY };
      } else {
        this.bot.sendMessage(chatId, '❌ Сначала зарегистрируйтесь командой /register или настройте приватный ключ в config.js');
        return;
      }
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      const contractAddress = await web3Manager.deployMultiZap();
      
      const userNetwork = this.userManager.getUserNetwork(chatId);
      this.userManager.updateUserContract(chatId, contractAddress, userNetwork);
      
      const explorerUrl = this.getExplorerUrl(chatId);
      this.bot.sendMessage(chatId, 
        `✅ Контракт успешно развернут!\n\n` +
        `📍 Адрес контракта: \`${contractAddress}\`\n` +
        `🌐 Сеть: ${userNetwork}\n` +
        `🔗 Explorer: ${explorerUrl}/address/${contractAddress}\n\n` +
        `Теперь вы можете добавлять токены командой /addtoken`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      this.bot.sendMessage(chatId, `❌ Ошибка развертывания: ${error.message}`);
    }
  }

  handleAddToken(chatId) {
    // Проверяем пользователя и контракт перед ожиданием ввода
    const user = this.userManager.getUser(chatId);
    if (!user || !user.contractAddress) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    this.bot.once('message', async (msg) => {
      try {
        const tokenAddress = msg.text.trim();
        
        if (!tokenAddress || !tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
          this.bot.sendMessage(chatId, '❌ Неверный формат адреса токена. Попробуйте еще раз с /addtoken');
          return;
        }

        // Повторная проверка пользователя (на случай если что-то изменилось)
        const currentUser = this.userManager.getUser(chatId);
        const userContract = currentUser ? this.userManager.getUserContract(chatId) : null;
        if (!currentUser || !userContract) {
          this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
          return;
        }

        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(currentUser.privateKey);
        web3Manager.setContractAddress(userContract);
        
        this.bot.sendMessage(chatId, '🔍 Поиск LP токена...');
        const txHash = await web3Manager.addTokenAuto(tokenAddress);
        
        const explorerUrl = this.getExplorerUrl(chatId);
        this.bot.sendMessage(chatId, 
          `✅ Токен успешно добавлен с автоматическим поиском LP!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `🔗 Транзакция: ${explorerUrl}/tx/${txHash}\n\n` +
          `📊 Открываю ваши позиции...`,
          { parse_mode: 'Markdown' }
        );

        // Автоматически показываем позиции после добавления токена
        setTimeout(async () => {
          try {
            const tokens = await web3Manager.getAllTokens();
            
            if (tokens.length === 0) {
              this.bot.sendMessage(chatId, '📝 Список позиций пуст.');
              return;
            }

            let message = '📊 Ваши позиции:\n\n';
            const keyboard = [];
            
            for (let i = 0; i < tokens.length; i++) {
              const tokenInfo = await this.web3Manager.getTokenInfo(tokens[i]);
              const shortAddress = `${tokens[i].slice(0, 6)}...${tokens[i].slice(-4)}`;
              const status = tokenInfo.isActive ? '✅' : '❌';
              
              message += `${i + 1}. ${status} \`${shortAddress}\`\n`;
              
              keyboard.push([{
                text: `${i + 1}. ${shortAddress} ${status}`,
                callback_data: `select_token_${tokens[i]}`
              }]);
            }

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
        }, 2000);
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Ошибка добавления токена: ${error.message}`);
      }
    });
  }

  async handlePositions(chatId) {
    const user = this.userManager.getUser(chatId);
    
    if (!user || !user.contractAddress) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      const userContract = this.userManager.getUserContract(chatId);
      web3Manager.setContractAddress(userContract);
      
      const tokens = await this.web3Manager.getAllTokens();
      
      if (tokens.length === 0) {
        this.bot.sendMessage(chatId, '📝 Список позиций пуст. Добавьте токены командой /addtoken');
        return;
      }

      let message = '📊 Ваши позиции:\n\n';
      const keyboard = [];
      
      for (let i = 0; i < tokens.length; i++) {
        const tokenInfo = await this.web3Manager.getTokenInfo(tokens[i]);
        const shortAddress = `${tokens[i].slice(0, 6)}...${tokens[i].slice(-4)}`;
        const status = tokenInfo.isActive ? '✅' : '❌';
        
        message += `${i + 1}. ${status} \`${shortAddress}\`\n`;
        
        keyboard.push([{
          text: `${i + 1}. ${shortAddress} ${status}`,
          callback_data: `select_token_${tokens[i]}`
        }]);
      }

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
    this.bot.once('message', async (msg) => {
      try {
        const [tokenAddress, amountStr] = msg.text.split(',').map(item => item.trim());
        const amount = parseFloat(amountStr);
        
        if (!tokenAddress || isNaN(amount) || amount <= 0) {
          this.bot.sendMessage(chatId, '❌ Неверный формат. Попробуйте еще раз с /zapin');
          return;
        }

        const user = this.userManager.getUser(chatId);
        if (!user || !user.contractAddress) {
          this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
          return;
        }

        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const userContract = this.userManager.getUserContract(chatId);
        web3Manager.setContractAddress(userContract);
        
        const txHash = await web3Manager.zapIn(tokenAddress, amount);
        
        const explorerUrl = this.getExplorerUrl(chatId);
        const networkConfig = config.getNetworkConfig(this.userManager.getUserNetwork(chatId));
        this.bot.sendMessage(chatId, 
          `✅ Zap-in выполнен успешно!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `💰 Сумма: ${amount} ${networkConfig.nativeCurrency}\n` +
          `🔗 Транзакция: ${explorerUrl}/tx/${txHash}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Ошибка zap-in: ${error.message.substring(0, 100)}...`);
      }
    });
  }

  handleExit(chatId) {
    this.bot.once('message', async (msg) => {
      try {
        const tokenAddress = msg.text.trim();
        
        if (!tokenAddress) {
          this.bot.sendMessage(chatId, '❌ Неверный формат. Попробуйте еще раз с /exit');
          return;
        }

        const user = this.userManager.getUser(chatId);
        if (!user || !user.contractAddress) {
          this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
          return;
        }

        const web3Manager = this.getWeb3ManagerForUser(chatId);
        web3Manager.setPrivateKey(user.privateKey);
        const userContract = this.userManager.getUserContract(chatId);
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
        
        const txHash = await web3Manager.exitAndSell(tokenAddress);
        
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
      }
    });
  }

  async handleBalance(chatId) {
    const user = this.userManager.getUser(chatId);
    
    if (!user || !user.contractAddress) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      const userContract = this.userManager.getUserContract(chatId);
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
    
    if (!user || !user.contractAddress) {
      this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
      return;
    }

    try {
      const web3Manager = this.getWeb3ManagerForUser(chatId);
      web3Manager.setPrivateKey(user.privateKey);
      const userContract = this.userManager.getUserContract(chatId);
      web3Manager.setContractAddress(userContract);
      
      const tokens = await this.web3Manager.getAllTokens();
      
      if (tokens.length === 0) {
        this.bot.sendMessage(chatId, '📝 Список токенов пуст. Добавьте токены командой /addtoken');
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

  showNetworkSelection(chatId) {
    const user = this.userManager.getUser(chatId);
    const currentNetwork = user ? this.userManager.getUserNetwork(chatId) : 'BSC';
    
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
