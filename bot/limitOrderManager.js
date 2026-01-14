const fs = require('fs');
const path = require('path');

class LimitOrderManager {
  constructor() {
    this.ordersFile = path.join(__dirname, 'limit-orders.json');
    this.orders = this.loadOrders();
  }

  loadOrders() {
    try {
      if (fs.existsSync(this.ordersFile)) {
        const data = fs.readFileSync(this.ordersFile, 'utf8');
        const orders = JSON.parse(data);
        const totalOrders = Object.values(orders).reduce((sum, userOrders) => {
          return sum + Object.values(userOrders).reduce((userSum, tokenOrders) => userSum + tokenOrders.length, 0);
        }, 0);
        console.log(`📂 Загружено ${totalOrders} лимитных ордеров из файла`);
        return orders;
      } else {
        console.log(`ℹ️ Файл лимитных ордеров не существует: ${this.ordersFile}`);
      }
    } catch (error) {
      console.error('Ошибка загрузки лимитных ордеров:', error.message);
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
      
      fs.writeFileSync(this.ordersFile, JSON.stringify(this.orders, null, 2), { mode: 0o666 });
    } catch (error) {
      console.error('Ошибка сохранения лимитных ордеров:', error.message);
    }
  }

  addOrder(chatId, tokenAddress, sellPriceUsd, percent) {
    try {
      // Убеждаемся что chatId - строка
      const chatIdStr = String(chatId);
      
      if (!this.orders[chatIdStr]) {
        this.orders[chatIdStr] = {};
      }
      
      if (!this.orders[chatIdStr][tokenAddress]) {
        this.orders[chatIdStr][tokenAddress] = [];
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
      this.saveOrders();
      console.log(`✅ Лимитный ордер #${order.id} добавлен: токен ${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}, цена $${sellPriceUsd}, ${percent}%`);
      return order;
    } catch (error) {
      console.error('Ошибка добавления лимитного ордера:', error.message);
      return null;
    }
  }

  getOrders(chatId, tokenAddress = null) {
    // Убеждаемся что chatId - строка
    const chatIdStr = String(chatId);
    
    if (!this.orders[chatIdStr]) {
      return [];
    }
    
    if (tokenAddress) {
      return this.orders[chatIdStr][tokenAddress] || [];
    }
    
    // Возвращаем все ордера пользователя
    const allOrders = [];
    for (const tokenAddr in this.orders[chatIdStr]) {
      allOrders.push(...(this.orders[chatIdStr][tokenAddr] || []));
    }
    return allOrders;
  }

  getActiveOrders(chatId, tokenAddress = null) {
    // Убеждаемся что chatId - строка (Telegram ID может быть строкой или числом)
    const chatIdStr = String(chatId);
    const orders = this.getOrders(chatIdStr, tokenAddress);
    const activeOrders = orders.filter(order => order.status === 'active');
    
    // Логируем если есть неактивные ордера для диагностики
    if (orders.length > 0 && activeOrders.length !== orders.length) {
      const inactiveCount = orders.length - activeOrders.length;
      console.log(`📊 Пользователь ${chatIdStr}: ${activeOrders.length} активных из ${orders.length} ордеров (${inactiveCount} неактивных)`);
    }
    
    return activeOrders;
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
      
      this.orders[chatIdStr][tokenAddress][orderIndex].status = 'cancelled';
      this.saveOrders();
      console.log(`✅ Ордер #${orderId} успешно отменен и сохранен (пользователь ${chatIdStr})`);
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


