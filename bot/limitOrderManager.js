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
        return JSON.parse(data);
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
      if (!this.orders[chatId]) {
        this.orders[chatId] = {};
      }
      
      if (!this.orders[chatId][tokenAddress]) {
        this.orders[chatId][tokenAddress] = [];
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
      
      this.orders[chatId][tokenAddress].push(order);
      this.saveOrders();
      return order;
    } catch (error) {
      console.error('Ошибка добавления лимитного ордера:', error.message);
      return null;
    }
  }

  getOrders(chatId, tokenAddress = null) {
    if (!this.orders[chatId]) {
      return [];
    }
    
    if (tokenAddress) {
      return this.orders[chatId][tokenAddress] || [];
    }
    
    // Возвращаем все ордера пользователя
    const allOrders = [];
    for (const tokenAddr in this.orders[chatId]) {
      allOrders.push(...(this.orders[chatId][tokenAddr] || []));
    }
    return allOrders;
  }

  getActiveOrders(chatId, tokenAddress = null) {
    const orders = this.getOrders(chatId, tokenAddress);
    return orders.filter(order => order.status === 'active');
  }

  cancelOrder(chatId, tokenAddress, orderId) {
    try {
      if (!this.orders[chatId] || !this.orders[chatId][tokenAddress]) {
        return false;
      }
      
      const orderIndex = this.orders[chatId][tokenAddress].findIndex(o => o.id === orderId);
      if (orderIndex === -1) {
        return false;
      }
      
      this.orders[chatId][tokenAddress][orderIndex].status = 'cancelled';
      this.saveOrders();
      return true;
    } catch (error) {
      console.error('Ошибка отмены лимитного ордера:', error.message);
      return false;
    }
  }

  markOrderExecuted(chatId, tokenAddress, orderId) {
    try {
      if (!this.orders[chatId] || !this.orders[chatId][tokenAddress]) {
        return false;
      }
      
      const orderIndex = this.orders[chatId][tokenAddress].findIndex(o => o.id === orderId);
      if (orderIndex === -1) {
        return false;
      }
      
      this.orders[chatId][tokenAddress][orderIndex].status = 'executed';
      this.orders[chatId][tokenAddress][orderIndex].executedAt = new Date().toISOString();
      this.saveOrders();
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


