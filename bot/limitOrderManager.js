const fs = require('fs');
const path = require('path');

class LimitOrderManager {
  constructor() {
    this.ordersFile = path.join(__dirname, 'limit-orders.json');
    this.orders = this.loadOrders();
    // Очищаем старые неактивные ордера при загрузке
    this.cleanupOldOrders();
  }

  loadOrders() {
    try {
      if (fs.existsSync(this.ordersFile)) {
        const data = fs.readFileSync(this.ordersFile, 'utf8');
        const orders = JSON.parse(data);
        const totalOrders = Object.values(orders).reduce((sum, userOrders) => {
          return sum + Object.values(userOrders).reduce((userSum, tokenOrders) => userSum + tokenOrders.length, 0);
        }, 0);
        const usersList = Object.keys(orders).join(', ');
        console.log(`📂 loadOrders: загружено ${totalOrders} лимитных ордеров из файла для пользователей [${usersList}]`);
        
        // Детальное логирование для каждого пользователя
        for (const chatId in orders) {
          const userOrders = orders[chatId];
          let userTotal = 0;
          for (const tokenAddr in userOrders) {
            userTotal += userOrders[tokenAddr].length;
          }
          console.log(`  👤 Пользователь ${chatId}: ${userTotal} ордеров`);
        }
        
        return orders;
      } else {
        console.log(`ℹ️ Файл лимитных ордеров не существует: ${this.ordersFile}`);
      }
    } catch (error) {
      console.error('Ошибка загрузки лимитных ордеров:', error.message);
      console.error('Детали ошибки:', error);
    }
    return {};
  }

  saveOrders() {
    try {
      const dir = path.dirname(this.ordersFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      if (!fs.existsSync(this.ordersFile)) {
        fs.writeFileSync(this.ordersFile, '{}');
      }
      
      // Подсчитываем ордера перед сохранением
      const totalOrders = Object.values(this.orders).reduce((sum, userOrders) => {
        return sum + Object.values(userOrders).reduce((userSum, tokenOrders) => userSum + tokenOrders.length, 0);
      }, 0);
      
      const usersList = Object.keys(this.orders).join(', ');
      console.log(`💾 saveOrders: сохраняю ${totalOrders} ордеров для пользователей [${usersList}]`);
      
      fs.writeFileSync(this.ordersFile, JSON.stringify(this.orders, null, 2), { mode: 0o666 });
      
      // Проверяем что файл действительно сохранился
      if (fs.existsSync(this.ordersFile)) {
        const fileData = fs.readFileSync(this.ordersFile, 'utf8');
        const savedOrders = JSON.parse(fileData);
        const savedTotal = Object.values(savedOrders).reduce((sum, userOrders) => {
          return sum + Object.values(userOrders).reduce((userSum, tokenOrders) => userSum + tokenOrders.length, 0);
        }, 0);
        console.log(`✅ saveOrders: файл сохранен, проверка - в файле ${savedTotal} ордеров`);
        
        if (savedTotal !== totalOrders) {
          console.error(`❌ ОШИБКА: Несоответствие! В памяти ${totalOrders}, в файле ${savedTotal}`);
        }
      }
    } catch (error) {
      console.error('Ошибка сохранения лимитных ордеров:', error.message);
      console.error('Детали ошибки:', error);
    }
  }

  // Очистка старых неактивных ордеров (старше 7 дней)
  cleanupOldOrders() {
    try {
      const now = Date.now();
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 дней в миллисекундах
      let cleanedCount = 0;
      let totalBefore = 0;
      let totalAfter = 0;
      let activeOrdersCount = 0;
      let removedActiveCount = 0;

      for (const chatId in this.orders) {
        for (const tokenAddress in this.orders[chatId]) {
          const orders = this.orders[chatId][tokenAddress];
          totalBefore += orders.length;
          
          // Считаем активные ордера до фильтрации
          const activeBefore = orders.filter(o => o.status === 'active').length;
          activeOrdersCount += activeBefore;
          
          // Фильтруем ордера: оставляем активные и недавние неактивные (меньше 7 дней)
          const filteredOrders = orders.filter(order => {
            // Всегда оставляем активные ордера
            if (order.status === 'active') {
              return true;
            }
            
            // Для неактивных ордеров проверяем возраст
            const orderDate = new Date(order.createdAt || order.executedAt || 0).getTime();
            const orderAge = now - orderDate;
            
            // Удаляем если старше 7 дней
            if (orderAge > maxAge) {
              cleanedCount++;
              console.log(`  🗑️ Удаление ордера #${order.id}: статус "${order.status}", возраст ${Math.floor(orderAge / (24 * 60 * 60 * 1000))} дней`);
              return false;
            }
            
            return true;
          });
          
          // Проверяем что активные ордера не были удалены
          const activeAfter = filteredOrders.filter(o => o.status === 'active').length;
          if (activeBefore > activeAfter) {
            removedActiveCount += (activeBefore - activeAfter);
            console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА: Удалены активные ордера! Было ${activeBefore}, стало ${activeAfter} для токена ${tokenAddress.slice(0, 6)}...`);
          }
          
          totalAfter += filteredOrders.length;
          this.orders[chatId][tokenAddress] = filteredOrders;
          
          // Удаляем пустые массивы токенов
          if (filteredOrders.length === 0) {
            delete this.orders[chatId][tokenAddress];
          }
        }
        
        // Удаляем пустые объекты пользователей
        if (Object.keys(this.orders[chatId]).length === 0) {
          delete this.orders[chatId];
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 Очищено ${cleanedCount} старых неактивных ордеров (было ${totalBefore}, стало ${totalAfter}, активных: ${activeOrdersCount})`);
        if (removedActiveCount > 0) {
          console.error(`❌ ВНИМАНИЕ: Было удалено ${removedActiveCount} активных ордеров! Это ошибка!`);
        }
        this.saveOrders();
      } else if (totalBefore > 0) {
        console.log(`ℹ️ Очистка: ${totalBefore} ордеров проверено, ${activeOrdersCount} активных, удалять нечего`);
      }
    } catch (error) {
      console.error('Ошибка очистки старых ордеров:', error.message);
      console.error('Детали ошибки:', error);
    }
  }

  addOrder(chatId, tokenAddress, sellPriceUsd, percent) {
    try {
      // Убеждаемся что chatId - строка
      const chatIdStr = String(chatId);
      console.log(`➕ addOrder вызван: chatId=${chatId} (тип: ${typeof chatId}), chatIdStr="${chatIdStr}", токен ${tokenAddress.slice(0, 6)}...`);
      
      if (!this.orders[chatIdStr]) {
        this.orders[chatIdStr] = {};
        console.log(`  📁 Создан новый объект для пользователя ${chatIdStr}`);
      }
      
      if (!this.orders[chatIdStr][tokenAddress]) {
        this.orders[chatIdStr][tokenAddress] = [];
        console.log(`  📁 Создан новый массив для токена ${tokenAddress.slice(0, 6)}...`);
      }
      
      const order = {
        id: Date.now().toString(),
        tokenAddress: tokenAddress,
        sellPriceUsd: parseFloat(sellPriceUsd), // Цена в USD
        percent: parseInt(percent),
        status: 'active', // active, executed, cancelled
        createdAt: new Date().toISOString(),
        executedAt: null
      };
      
      this.orders[chatIdStr][tokenAddress].push(order);
      console.log(`  💾 Ордер добавлен в память. Всего ордеров для токена: ${this.orders[chatIdStr][tokenAddress].length}`);
      
      this.saveOrders();
      console.log(`✅ Лимитный ордер #${order.id} добавлен и сохранен: токен ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}, цена $${sellPriceUsd}, ${percent}%`);
      
      // Проверяем что ордер действительно сохранен
      const verifyOrders = this.getOrders(chatIdStr, tokenAddress);
      console.log(`  🔍 Проверка: найдено ${verifyOrders.length} ордеров для токена после сохранения`);
      
      return order;
    } catch (error) {
      console.error('Ошибка добавления лимитного ордера:', error.message);
      console.error('Детали ошибки:', error);
      return null;
    }
  }

  getOrders(chatId, tokenAddress = null) {
    // Убеждаемся что chatId - строка
    const chatIdStr = String(chatId);
    
    if (!this.orders[chatIdStr]) {
      console.log(`  ⚠️ getOrders: пользователь ${chatIdStr} не найден в this.orders`);
      return [];
    }
    
    if (tokenAddress) {
      const tokenOrders = this.orders[chatIdStr][tokenAddress] || [];
      console.log(`  📦 getOrders: для токена ${tokenAddress.slice(0, 6)}... найдено ${tokenOrders.length} ордеров`);
      return tokenOrders;
    }
    
    // Возвращаем все ордера пользователя
    const allOrders = [];
    for (const tokenAddr in this.orders[chatIdStr]) {
      const tokenOrders = this.orders[chatIdStr][tokenAddr] || [];
      allOrders.push(...tokenOrders);
      console.log(`  📦 getOrders: для токена ${tokenAddr.slice(0, 6)}... найдено ${tokenOrders.length} ордеров`);
    }
    console.log(`  📦 getOrders: всего найдено ${allOrders.length} ордеров для пользователя ${chatIdStr}`);
    return allOrders;
  }

  getActiveOrders(chatId, tokenAddress = null) {
    // Убеждаемся что chatId - строка (Telegram ID может быть строкой или числом)
    const chatIdStr = String(chatId);
    console.log(`🔍 getActiveOrders вызван: chatId=${chatId} (тип: ${typeof chatId}), chatIdStr="${chatIdStr}", токен ${tokenAddress ? tokenAddress.slice(0, 6) + '...' : 'все'}`);
    
    // Проверяем что пользователь существует в базе
    if (!this.orders[chatIdStr]) {
      console.log(`  ⚠️ Пользователь ${chatIdStr} не найден в базе ордеров`);
      console.log(`  📋 Доступные пользователи: ${Object.keys(this.orders).join(', ')}`);
      return [];
    }
    
    const orders = this.getOrders(chatIdStr, tokenAddress);
    console.log(`  📦 getOrders вернул ${orders.length} ордеров для пользователя ${chatIdStr}`);
    
    // Фильтруем только активные ордера (теперь в базе должны быть только активные)
    const activeOrders = orders.filter(order => order.status === 'active');
    
    // Если нашли неактивные ордера - это ошибка, они должны были быть удалены
    const inactiveOrders = orders.filter(order => order.status !== 'active');
    if (inactiveOrders.length > 0) {
      console.error(`❌ ОШИБКА: Найдены неактивные ордера в базе! Они должны были быть удалены.`);
      inactiveOrders.forEach(order => {
        console.error(`  🗑️ Неактивный ордер #${order.id}: статус "${order.status}" - будет удален`);
      });
      // Удаляем неактивные ордера автоматически
      this.removeInactiveOrders(chatIdStr, tokenAddress, inactiveOrders);
    }
    
    // Логируем результат
    if (activeOrders.length > 0) {
      console.log(`📊 Пользователь ${chatIdStr}: ${activeOrders.length} активных ордеров из ${orders.length} всего`);
      activeOrders.forEach(order => {
        console.log(`  ✅ Активный ордер #${order.id}: токен ${order.tokenAddress.slice(0, 6)}..., цена $${order.sellPriceUsd}, ${order.percent}%`);
      });
    } else {
      console.log(`  ℹ️ Активных ордеров не найдено для пользователя ${chatIdStr}`);
      if (orders.length > 0) {
        console.log(`  ⚠️ Но есть ${orders.length} неактивных ордеров`);
      }
    }
    
    return activeOrders;
  }

  // Удаление неактивных ордеров из базы
  removeInactiveOrders(chatIdStr, tokenAddress, inactiveOrders) {
    try {
      if (!this.orders[chatIdStr]) {
        return;
      }
      
      const inactiveIds = new Set(inactiveOrders.map(o => o.id));
      let removedCount = 0;
      
      if (tokenAddress) {
        // Удаляем из конкретного токена
        if (this.orders[chatIdStr][tokenAddress]) {
          const before = this.orders[chatIdStr][tokenAddress].length;
          this.orders[chatIdStr][tokenAddress] = this.orders[chatIdStr][tokenAddress].filter(
            order => !inactiveIds.has(order.id)
          );
          removedCount = before - this.orders[chatIdStr][tokenAddress].length;
          
          // Удаляем пустые массивы токенов
          if (this.orders[chatIdStr][tokenAddress].length === 0) {
            delete this.orders[chatIdStr][tokenAddress];
          }
        }
      } else {
        // Удаляем из всех токенов пользователя
        for (const tokenAddr in this.orders[chatIdStr]) {
          if (this.orders[chatIdStr][tokenAddr]) {
            const before = this.orders[chatIdStr][tokenAddr].length;
            this.orders[chatIdStr][tokenAddr] = this.orders[chatIdStr][tokenAddr].filter(
              order => !inactiveIds.has(order.id)
            );
            removedCount += before - this.orders[chatIdStr][tokenAddr].length;
            
            // Удаляем пустые массивы токенов
            if (this.orders[chatIdStr][tokenAddr].length === 0) {
              delete this.orders[chatIdStr][tokenAddr];
            }
          }
        }
      }
      
      // Удаляем пустые объекты пользователей
      if (Object.keys(this.orders[chatIdStr]).length === 0) {
        delete this.orders[chatIdStr];
      }
      
      if (removedCount > 0) {
        this.saveOrders();
        console.log(`🧹 Удалено ${removedCount} неактивных ордеров из базы`);
      }
    } catch (error) {
      console.error('Ошибка удаления неактивных ордеров:', error.message);
    }
  }

  cancelOrder(chatId, tokenAddress, orderId) {
    try {
      // Убеждаемся что chatId - строка
      const chatIdStr = String(chatId);
      
      if (!this.orders[chatIdStr] || !this.orders[chatIdStr][tokenAddress]) {
        console.log(`⚠️ Ордер #${orderId} не найден для отмены (пользователь ${chatIdStr}, токен ${tokenAddress.slice(0, 6)}...)`);
        return false;
      }
      
      const orderIndex = this.orders[chatIdStr][tokenAddress].findIndex(o => o.id === orderId);
      if (orderIndex === -1) {
        console.log(`⚠️ Ордер #${orderId} не найден в списке`);
        return false;
      }
      
      const order = this.orders[chatIdStr][tokenAddress][orderIndex];
      if (order.status !== 'active') {
        console.log(`⚠️ Ордер #${orderId} уже имеет статус "${order.status}", не может быть отменен`);
        return false;
      }
      
      // Удаляем ордер полностью из базы вместо изменения статуса
      this.orders[chatIdStr][tokenAddress].splice(orderIndex, 1);
      
      // Удаляем пустые массивы токенов
      if (this.orders[chatIdStr][tokenAddress].length === 0) {
        delete this.orders[chatIdStr][tokenAddress];
      }
      
      // Удаляем пустые объекты пользователей
      if (Object.keys(this.orders[chatIdStr]).length === 0) {
        delete this.orders[chatIdStr];
      }
      
      this.saveOrders();
      console.log(`✅ Ордер #${orderId} успешно удален из базы (пользователь ${chatIdStr})`);
      return true;
    } catch (error) {
      console.error('Ошибка отмены лимитного ордера:', error.message);
      return false;
    }
  }

  markOrderExecuted(chatId, tokenAddress, orderId) {
    try {
      // Убеждаемся что chatId - строка
      const chatIdStr = String(chatId);
      
      if (!this.orders[chatIdStr] || !this.orders[chatIdStr][tokenAddress]) {
        console.log(`⚠️ Ордер #${orderId} не найден для отметки как выполненный`);
        return false;
      }
      
      const orderIndex = this.orders[chatIdStr][tokenAddress].findIndex(o => o.id === orderId);
      if (orderIndex === -1) {
        console.log(`⚠️ Ордер #${orderId} не найден в списке для отметки`);
        return false;
      }
      
      this.orders[chatIdStr][tokenAddress][orderIndex].status = 'executed';
      this.orders[chatIdStr][tokenAddress][orderIndex].executedAt = new Date().toISOString();
      this.saveOrders();
      console.log(`✅ Ордер #${orderId} помечен как выполненный и сохранен`);
      return true;
    } catch (error) {
      console.error('Ошибка отметки ордера как выполненного:', error.message);
      return false;
    }
  }

  removeOrder(chatId, tokenAddress, orderId) {
    try {
      if (!this.orders[chatId] || !this.orders[chatId][tokenAddress]) {
        return false;
      }
      
      this.orders[chatId][tokenAddress] = this.orders[chatId][tokenAddress].filter(o => o.id !== orderId);
      
      if (this.orders[chatId][tokenAddress].length === 0) {
        delete this.orders[chatId][tokenAddress];
      }
      
      if (Object.keys(this.orders[chatId]).length === 0) {
        delete this.orders[chatId];
      }
      
      this.saveOrders();
      return true;
    } catch (error) {
      console.error('Ошибка удаления лимитного ордера:', error.message);
      return false;
    }
  }
}

module.exports = LimitOrderManager;


