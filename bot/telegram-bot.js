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
• Создать один контракт для работы с разными токенами
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
      
      let message = '🏠 **Главное меню MultiZap Bot**\n\n';
      
      if (user && user.contractAddress) {
        message += `✅ Контракт развернут: \`${user.contractAddress.slice(0, 6)}...${user.contractAddress.slice(-4)}\`\n\n`;
      } else {
        message += `❌ Контракт не развернут\n\n`;
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
        
        this.web3Manager.setPrivateKey(user.privateKey);
        const contractAddress = await this.web3Manager.deployMultiZap();
        
        this.userManager.updateUserContract(chatId, contractAddress);
        
        this.bot.sendMessage(chatId, 
          `✅ Контракт успешно развернут!\n\n` +
          `📍 Адрес контракта: \`${contractAddress}\`\n` +
          `🔗 Etherscan: https://etherscan.io/address/${contractAddress}\n\n` +
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
      
      if (!user || !user.contractAddress) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      this.bot.sendMessage(chatId, 
        '🪙 Введите адрес токена для автоматического поиска LP:\n\n' +
        'Пример: `0xA0b86a33E6441b8c4C8C0d4B0c8e8C8C0d4B0c8e`\n\n' +
        'Бот автоматически найдет соответствующий LP токен через Uniswap Factory.',
        { parse_mode: 'Markdown' }
      );

      this.bot.once('message', async (msg) => {
        try {
          const tokenAddress = msg.text.trim();
          
          if (!tokenAddress || !tokenAddress.startsWith('0x') || tokenAddress.length !== 42) {
            this.bot.sendMessage(chatId, '❌ Неверный формат адреса токена. Попробуйте еще раз с /addtoken');
            return;
          }

          this.web3Manager.setPrivateKey(user.privateKey);
          this.web3Manager.setContractAddress(user.contractAddress);
          
          this.bot.sendMessage(chatId, '🔍 Поиск LP токена...');
          const txHash = await this.web3Manager.addTokenAuto(tokenAddress);
          
          this.bot.sendMessage(chatId, 
            `✅ Токен успешно добавлен с автоматическим поиском LP!\n\n` +
            `📍 Токен: \`${tokenAddress}\`\n` +
            `🔗 Транзакция: https://etherscan.io/tx/${txHash}\n\n` +
            `📊 Открываю ваши позиции...`,
            { parse_mode: 'Markdown' }
          );

          // Автоматически показываем позиции после добавления токена
          setTimeout(async () => {
            try {
              const tokens = await this.web3Manager.getAllTokens();
              
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
      
      if (!user || !user.contractAddress) {
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

          this.web3Manager.setPrivateKey(user.privateKey);
          this.web3Manager.setContractAddress(user.contractAddress);
          
          const txHash = await this.web3Manager.zapIn(tokenAddress, amount);
          
          this.bot.sendMessage(chatId, 
            `✅ Zap-in выполнен успешно!\n\n` +
            `📍 Токен: \`${tokenAddress}\`\n` +
            `💰 Сумма: ${amount} ETH\n` +
            `🔗 Транзакция: https://etherscan.io/tx/${txHash}`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          this.bot.sendMessage(chatId, `❌ Ошибка zap-in: ${error.message}`);
        }
      });
    });

    // Команда /exit
    this.bot.onText(/\/exit/, (msg) => {
      const chatId = msg.chat.id;
      const user = this.userManager.getUser(chatId);
      
      if (!user || !user.contractAddress) {
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

          this.web3Manager.setPrivateKey(user.privateKey);
          this.web3Manager.setContractAddress(user.contractAddress);
          
          const txHash = await this.web3Manager.exitAndSell(tokenAddress);
          
          this.bot.sendMessage(chatId, 
            `✅ Exit-and-sell выполнен успешно!\n\n` +
            `📍 Токен: \`${tokenAddress}\`\n` +
            `🔗 Транзакция: https://etherscan.io/tx/${txHash}`,
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
      
      if (!user || !user.contractAddress) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        this.web3Manager.setPrivateKey(user.privateKey);
        this.web3Manager.setContractAddress(user.contractAddress);
        
        const walletBalance = await this.web3Manager.getWalletBalance();
        const contractEthBalance = await this.web3Manager.getEthBalance();
        const walletAddress = this.web3Manager.getWalletAddress();
        
        this.bot.sendMessage(chatId, 
          `💰 Балансы:\n\n` +
          `👤 Ваш кошелек: \`${walletAddress}\`\n` +
          `💳 Баланс кошелька: ${walletBalance} ETH\n` +
          `🏦 Баланс контракта: ${contractEthBalance} ETH\n\n` +
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
      
      if (!user || !user.contractAddress) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        this.web3Manager.setPrivateKey(user.privateKey);
        this.web3Manager.setContractAddress(user.contractAddress);
        
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
      
      if (!user || !user.contractAddress) {
        this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        this.web3Manager.setPrivateKey(user.privateKey);
        this.web3Manager.setContractAddress(user.contractAddress);
        
        const tokens = await this.web3Manager.getAllTokens();
        
        if (tokens.length === 0) {
          this.bot.sendMessage(chatId, '📝 Список токенов пуст. Добавьте токены командой /addtoken');
          return;
        }

        let message = '🪙 Поддерживаемые токены:\n\n';
        
        for (let i = 0; i < tokens.length; i++) {
          const tokenInfo = await this.web3Manager.getTokenInfo(tokens[i]);
          const lpBalance = await this.web3Manager.getLpBalance(tokens[i]);
          const tokenBalance = await this.web3Manager.getTokenBalance(tokens[i]);
          
          message += `${i + 1}. Токен: \`${tokens[i]}\`\n`;
          message += `   LP: \`${tokenInfo.lpToken}\`\n`;
          message += `   Статус: ${tokenInfo.isActive ? '✅ Активен' : '❌ Неактивен'}\n`;
          message += `   LP баланс: ${lpBalance}\n`;
          message += `   Токен баланс: ${tokenBalance}\n\n`;
        }
        
        this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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
        this.bot.answerCallbackQuery(callbackQuery.id, '❌ Сначала разверните контракт командой /deploy');
        return;
      }

      try {
        // Обработка выбора токена
        if (data.startsWith('select_token_')) {
          const tokenAddress = data.replace('select_token_', '');
          
          this.web3Manager.setPrivateKey(user.privateKey);
          this.web3Manager.setContractAddress(user.contractAddress);
          
          // Получаем информацию о токене
          const tokenInfo = await this.web3Manager.getTokenInfo(tokenAddress);
          const tokenPrice = await this.web3Manager.getTokenPrice(tokenAddress);
          const lpBalance = await this.web3Manager.getLpBalance(tokenAddress);
          const tokenBalance = await this.web3Manager.getTokenBalance(tokenAddress);
          
          const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
          const status = tokenInfo.isActive ? '✅ Активен' : '❌ Неактивен';
          
          // Форматируем маркеткап
          const formatMarketCap = (marketCap) => {
            if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(2)}B`;
            if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(2)}M`;
            if (marketCap >= 1e3) return `$${(marketCap / 1e3).toFixed(2)}K`;
            return `$${marketCap.toFixed(2)}`;
          };
          
          const message = `🪙 **${tokenPrice.name} (${tokenPrice.symbol})**\n\n` +
            `📍 Адрес: \`${shortAddress}\`\n` +
            `💰 Цена: ${tokenPrice.price.toFixed(8)} ETH ($${tokenPrice.priceUsd.toFixed(4)})\n` +
            `📊 Маркеткап: ${formatMarketCap(tokenPrice.marketCap)}\n` +
            `🔄 Статус: ${status}\n` +
            `💎 LP баланс: ${lpBalance}\n` +
            `🪙 Токен баланс: ${tokenBalance}\n` +
            `📈 ETH цена: $${tokenPrice.ethPrice.toFixed(2)}\n\n` +
            `💡 Выберите действие:`;
          
          // Показываем кнопки с действиями
          const actionKeyboard = {
            inline_keyboard: [
              [
                { text: '💰 Купить 0.01 ETH', callback_data: `buy_${tokenAddress}_0.01` },
                { text: '💰 Купить 0.005 ETH', callback_data: `buy_${tokenAddress}_0.005` }
              ],
              [
                { text: '💰 Купить 0.002 ETH', callback_data: `buy_${tokenAddress}_0.002` },
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
          
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: actionKeyboard
          });
          
          this.bot.answerCallbackQuery(callbackQuery.id, 'Информация о токене загружена');
        }
        
        // Обработка покупки с фиксированной суммой
        else if (data.startsWith('buy_')) {
          const [, tokenAddress, amount] = data.split('_');
          const amountFloat = parseFloat(amount);
          
          this.web3Manager.setPrivateKey(user.privateKey);
          this.web3Manager.setContractAddress(user.contractAddress);
          
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
          
          const txHash = await this.web3Manager.zapIn(tokenAddress, amountFloat);
          
          await this.bot.editMessageText(
            `✅ Покупка выполнена успешно!\n\n` +
            `📍 Токен: \`${shortAddress}\`\n` +
            `💰 Сумма: ${amount} ETH\n` +
            `🔗 Транзакция: https://etherscan.io/tx/${txHash}`,
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          
          this.bot.answerCallbackQuery(callbackQuery.id, '✅ Покупка выполнена!');
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
              
              this.web3Manager.setPrivateKey(user.privateKey);
              this.web3Manager.setContractAddress(user.contractAddress);
              
              this.bot.sendMessage(chatId, `⏳ Выполняется покупка на ${customAmount} ETH...`);
              
              const txHash = await this.web3Manager.zapIn(tokenAddress, customAmount);
              
              this.bot.sendMessage(chatId, 
                `✅ Покупка выполнена успешно!\n\n` +
                `📍 Токен: \`${shortAddress}\`\n` +
                `💰 Сумма: ${customAmount} ETH\n` +
                `🔗 Транзакция: https://etherscan.io/tx/${txHash}`,
                { parse_mode: 'Markdown' }
              );
            } catch (error) {
              this.bot.sendMessage(chatId, `❌ Ошибка покупки: ${error.message}`);
            }
          });
          
          this.bot.answerCallbackQuery(callbackQuery.id, 'Введите сумму');
        }
        
        // Обработка продажи токена
        else if (data.startsWith('sell_')) {
          const tokenAddress = data.replace('sell_', '');
          const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
          
          this.web3Manager.setPrivateKey(user.privateKey);
          this.web3Manager.setContractAddress(user.contractAddress);
          
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
            const txHash = await this.web3Manager.exitAndSell(tokenAddress);
            
            await this.bot.editMessageText(
              `✅ Продажа выполнена успешно!\n\n` +
              `📍 Токен: \`${shortAddress}\`\n` +
              `💸 Все LP токены конвертированы в ETH\n` +
              `🔗 Транзакция: https://etherscan.io/tx/${txHash}\n\n` +
              `💡 Используйте /positions для просмотра обновленных позиций`,
              {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'Markdown'
              }
            );
            
            this.bot.answerCallbackQuery(callbackQuery.id, '✅ Продажа выполнена!');
          } catch (error) {
            await this.bot.editMessageText(
              `❌ Ошибка продажи: ${error.message}\n\n` +
              `💡 Возможно, у вас нет LP токенов для продажи`,
              {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
              }
            );
            
            this.bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка продажи');
          }
        }
        
        // Обработка кнопок главного меню
        else if (data.startsWith('home_')) {
          const action = data.replace('home_', '');
          
          switch (action) {
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
          
          this.bot.answerCallbackQuery(callbackQuery.id, 'Выполняется...');
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
          
          this.bot.answerCallbackQuery(callbackQuery.id, 'Операция отменена');
        }
        
      } catch (error) {
        this.bot.answerCallbackQuery(callbackQuery.id, `❌ Ошибка: ${error.message}`);
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
      this.web3Manager.setPrivateKey(user.privateKey);
      const contractAddress = await this.web3Manager.deployMultiZap();
      
      this.userManager.updateUserContract(chatId, contractAddress);
      
      this.bot.sendMessage(chatId, 
        `✅ Контракт успешно развернут!\n\n` +
        `📍 Адрес контракта: \`${contractAddress}\`\n` +
        `🔗 Etherscan: https://etherscan.io/address/${contractAddress}\n\n` +
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
        if (!currentUser || !currentUser.contractAddress) {
          this.bot.sendMessage(chatId, '❌ Сначала разверните контракт командой /deploy');
          return;
        }

        this.web3Manager.setPrivateKey(currentUser.privateKey);
        this.web3Manager.setContractAddress(currentUser.contractAddress);
        
        this.bot.sendMessage(chatId, '🔍 Поиск LP токена...');
        const txHash = await this.web3Manager.addTokenAuto(tokenAddress);
        
        this.bot.sendMessage(chatId, 
          `✅ Токен успешно добавлен с автоматическим поиском LP!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `🔗 Транзакция: https://etherscan.io/tx/${txHash}\n\n` +
          `📊 Открываю ваши позиции...`,
          { parse_mode: 'Markdown' }
        );

        // Автоматически показываем позиции после добавления токена
        setTimeout(async () => {
          try {
            const tokens = await this.web3Manager.getAllTokens();
            
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
      this.web3Manager.setPrivateKey(user.privateKey);
      this.web3Manager.setContractAddress(user.contractAddress);
      
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

        this.web3Manager.setPrivateKey(user.privateKey);
        this.web3Manager.setContractAddress(user.contractAddress);
        
        const txHash = await this.web3Manager.zapIn(tokenAddress, amount);
        
        this.bot.sendMessage(chatId, 
          `✅ Zap-in выполнен успешно!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `💰 Сумма: ${amount} ETH\n` +
          `🔗 Транзакция: https://etherscan.io/tx/${txHash}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Ошибка zap-in: ${error.message}`);
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

        this.web3Manager.setPrivateKey(user.privateKey);
        this.web3Manager.setContractAddress(user.contractAddress);
        
        const txHash = await this.web3Manager.exitAndSell(tokenAddress);
        
        this.bot.sendMessage(chatId, 
          `✅ Exit-and-sell выполнен успешно!\n\n` +
          `📍 Токен: \`${tokenAddress}\`\n` +
          `🔗 Транзакция: https://etherscan.io/tx/${txHash}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        this.bot.sendMessage(chatId, `❌ Ошибка exit-and-sell: ${error.message}`);
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
      this.web3Manager.setPrivateKey(user.privateKey);
      this.web3Manager.setContractAddress(user.contractAddress);
      
      const walletBalance = await this.web3Manager.getWalletBalance();
      const contractEthBalance = await this.web3Manager.getEthBalance();
      const walletAddress = this.web3Manager.getWalletAddress();
      
      this.bot.sendMessage(chatId, 
        `💰 Балансы:\n\n` +
        `👤 Ваш кошелек: \`${walletAddress}\`\n` +
        `💳 Баланс кошелька: ${walletBalance} ETH\n` +
        `🏦 Баланс контракта: ${contractEthBalance} ETH\n\n` +
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
      this.web3Manager.setPrivateKey(user.privateKey);
      this.web3Manager.setContractAddress(user.contractAddress);
      
      const tokens = await this.web3Manager.getAllTokens();
      
      if (tokens.length === 0) {
        this.bot.sendMessage(chatId, '📝 Список токенов пуст. Добавьте токены командой /addtoken');
        return;
      }

      let message = '🪙 Поддерживаемые токены:\n\n';
      
      for (let i = 0; i < tokens.length; i++) {
        const tokenInfo = await this.web3Manager.getTokenInfo(tokens[i]);
        const lpBalance = await this.web3Manager.getLpBalance(tokens[i]);
        const tokenBalance = await this.web3Manager.getTokenBalance(tokens[i]);
        
        message += `${i + 1}. Токен: \`${tokens[i]}\`\n`;
        message += `   LP: \`${tokenInfo.lpToken}\`\n`;
        message += `   Статус: ${tokenInfo.isActive ? '✅ Активен' : '❌ Неактивен'}\n`;
        message += `   LP баланс: ${lpBalance}\n`;
        message += `   Токен баланс: ${tokenBalance}\n\n`;
      }
      
      this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      this.bot.sendMessage(chatId, `❌ Ошибка получения токенов: ${error.message}`);
    }
  }
}

// Запуск бота
const bot = new TelegramBotManager();
