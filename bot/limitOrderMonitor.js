const LimitOrderManager = require('./limitOrderManager');
const Web3Manager = require('./web3Manager');
const UserManager = require('./userManager');
const config = require('./config');

class LimitOrderMonitor {
  constructor(telegramBot) {
    this.limitOrderManager = new LimitOrderManager();
    this.userManager = new UserManager();
    this.telegramBot = telegramBot;
    this.isRunning = false;
    this.checkInterval = 30000; // 30 секунд
    this.monitoringInterval = null;
  }

  start() {
    if (this.isRunning) {
      console.log('⚠️ Мониторинг лимитных ордеров уже запущен');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Запуск мониторинга лимитных ордеров...');
    
    // Запускаем проверку сразу
    this.checkOrders();
    
    // Затем проверяем каждые 30 секунд
    this.monitoringInterval = setInterval(() => {
      this.checkOrders();
    }, this.checkInterval);
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    console.log('⏹️ Мониторинг лимитных ордеров остановлен');
  }

  async checkOrders() {
    try {
      const allUsers = this.userManager.getAllUsers();
      let totalOrders = 0;
      
      for (const user of allUsers) {
        const chatId = user.telegramId;
        const activeOrders = this.limitOrderManager.getActiveOrders(chatId);
        
        if (activeOrders.length === 0) {
          continue;
        }
        
        totalOrders += activeOrders.length;
        
        // Группируем ордера по токенам
        const ordersByToken = {};
        for (const order of activeOrders) {
          if (!ordersByToken[order.tokenAddress]) {
            ordersByToken[order.tokenAddress] = [];
          }
          ordersByToken[order.tokenAddress].push(order);
        }
        
        // Проверяем каждый токен
        for (const tokenAddress in ordersByToken) {
          await this.checkTokenOrders(chatId, tokenAddress, ordersByToken[tokenAddress]);
        }
      }
      
      if (totalOrders > 0) {
        console.log(`🔍 Проверено ${totalOrders} активных лимитных ордеров`);
      }
    } catch (error) {
      console.error('Ошибка проверки лимитных ордеров:', error.message);
    }
  }

  async checkTokenOrders(chatId, tokenAddress, orders) {
    try {
      const user = this.userManager.getUser(chatId);
      if (!user) {
        return;
      }

      const userNetwork = this.userManager.getUserNetwork(chatId);
      const userContract = this.userManager.getUserContract(chatId, userNetwork);
      if (!userContract) {
        return;
      }

      const web3Manager = new Web3Manager(userNetwork);
      web3Manager.setPrivateKey(user.privateKey);
      web3Manager.setContractAddress(userContract);

      // Получаем текущую цену токена
      let currentPrice;
      try {
        const tokenPrice = await web3Manager.getTokenPrice(tokenAddress);
        currentPrice = tokenPrice.price;
        console.log(`💰 Токен ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}: текущая цена ${currentPrice.toFixed(8)}, проверяю ${orders.length} ордеров`);
      } catch (error) {
        console.error(`Ошибка получения цены для токена ${tokenAddress}:`, error.message);
        return;
      }

      // Проверяем каждый ордер
      for (const order of orders) {
        if (order.status !== 'active') {
          continue;
        }

        console.log(`  📊 Ордер #${order.id}: продать ${order.percent}% при цене ≥ ${order.sellPrice.toFixed(8)} (текущая: ${currentPrice.toFixed(8)})`);

        // Если текущая цена >= цены продажи, выполняем ордер
        if (currentPrice >= order.sellPrice) {
          console.log(`🎯 ВЫПОЛНЕНИЕ лимитного ордера: токен ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}, цена ${currentPrice.toFixed(8)} >= ${order.sellPrice.toFixed(8)}`);
          
          try {
            // Выполняем продажу
            let txHash;
            if (order.percent === 100) {
              txHash = await web3Manager.exitAndSell(tokenAddress);
            } else {
              txHash = await web3Manager.exitAndSellPartial(tokenAddress, order.percent);
            }

            // Отмечаем ордер как выполненный
            this.limitOrderManager.markOrderExecuted(chatId, tokenAddress, order.id);

            // Отправляем уведомление пользователю
            const networkConfig = config.getNetworkConfig(userNetwork);
            const explorerUrl = config.getExplorerUrl(userNetwork);
            const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
            const percentText = order.percent === 100 ? 'все' : `${order.percent}%`;

            await this.telegramBot.bot.sendMessage(
              chatId,
              `✅ **Лимитный ордер выполнен!**\n\n` +
              `📍 Токен: \`${shortAddress}\`\n` +
              `💰 Цена продажи: ${order.sellPrice.toFixed(8)} ${networkConfig.nativeCurrency}\n` +
              `📊 Продано: ${percentText} LP токенов\n` +
              `🔗 Транзакция: ${explorerUrl}/tx/${txHash}`,
              { parse_mode: 'Markdown' }
            );
          } catch (error) {
            console.error(`Ошибка выполнения лимитного ордера:`, error.message);
            
            // Отправляем уведомление об ошибке
            const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
            const userNetwork = this.userManager.getUserNetwork(chatId);
            const networkConfig = config.getNetworkConfig(userNetwork);
            const nativeCurrency = networkConfig.nativeCurrency;
            
            try {
              await this.telegramBot.bot.sendMessage(
                chatId,
                `❌ **Ошибка выполнения лимитного ордера**\n\n` +
                `📍 Токен: \`${shortAddress}\`\n` +
                `💰 Цена продажи: ${order.sellPrice.toFixed(8)} ${nativeCurrency}\n` +
                `📊 Процент: ${order.percent}%\n\n` +
                `Ошибка: ${error.message}\n\n` +
                `💡 Ордер остается активным и будет проверен снова.`,
                { parse_mode: 'Markdown' }
              );
            } catch (sendError) {
              console.error('Ошибка отправки уведомления об ошибке:', sendError.message);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Ошибка проверки ордеров для токена ${tokenAddress}:`, error.message);
    }
  }
}

module.exports = LimitOrderMonitor;

