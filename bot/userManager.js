const fs = require('fs');
const path = require('path');
const config = require('./config');

class UserManager {
  constructor() {
    this.usersFile = path.join(__dirname, 'users.json');
    this.users = this.loadUsers();
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Ошибка загрузки пользователей:', error.message);
    }
    return {};
  }

  saveUsers() {
    try {
      // Создаем директорию, если её нет
      const dir = path.dirname(this.usersFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Создаем файл с пустым объектом, если его нет
      if (!fs.existsSync(this.usersFile)) {
        fs.writeFileSync(this.usersFile, '{}');
      }
      
      // Сохраняем данные
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2), { mode: 0o666 });
    } catch (error) {
      console.error('Ошибка сохранения пользователей:', error.message);
      // Пытаемся создать файл с правами записи
      try {
        if (!fs.existsSync(this.usersFile)) {
          fs.writeFileSync(this.usersFile, '{}', { mode: 0o666 });
        }
      } catch (e) {
        console.error('Критическая ошибка: невозможно создать файл users.json:', e.message);
      }
    }
  }

  addUser(telegramId, privateKey) {
    try {
      this.users[telegramId] = {
        privateKey: privateKey,
        contractAddress: null, // Legacy, для обратной совместимости
        contracts: {}, // { ETH: '0x...', BSC: '0x...', BASE: '0x...' }
        hiddenTokens: {}, // { ETH: ['0x...'], BSC: ['0x...'], BASE: ['0x...'] }
        currentNetwork: config.DEFAULT_NETWORK, // Текущая выбранная сеть
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };
      this.saveUsers();
      return true;
    } catch (error) {
      console.error('Ошибка добавления пользователя:', error.message);
      return false;
    }
  }

  getUser(telegramId) {
    return this.users[telegramId] || null;
  }

  updateUserContract(telegramId, contractAddress, networkName = null) {
    if (this.users[telegramId]) {
      const network = networkName ? networkName.toUpperCase() : this.users[telegramId].currentNetwork || config.DEFAULT_NETWORK;
      
      // Обновляем legacy поле для обратной совместимости
      this.users[telegramId].contractAddress = contractAddress;
      
      // Обновляем контракты по сетям
      if (!this.users[telegramId].contracts) {
        this.users[telegramId].contracts = {};
      }
      this.users[telegramId].contracts[network] = contractAddress;
      
      this.users[telegramId].lastActivity = new Date().toISOString();
      this.saveUsers();
      return true;
    }
    return false;
  }

  setUserNetwork(telegramId, networkName) {
    if (this.users[telegramId]) {
      const network = networkName.toUpperCase();
      this.users[telegramId].currentNetwork = network;
      this.users[telegramId].lastActivity = new Date().toISOString();
      this.saveUsers();
      return true;
    }
    return false;
  }

  getUserNetwork(telegramId) {
    if (this.users[telegramId]) {
      return this.users[telegramId].currentNetwork || config.DEFAULT_NETWORK;
    }
    return config.DEFAULT_NETWORK;
  }

  getUserContract(telegramId, networkName = null) {
    if (this.users[telegramId]) {
      const network = networkName ? networkName.toUpperCase() : this.users[telegramId].currentNetwork || config.DEFAULT_NETWORK;
      
      // Сначала проверяем новую структуру contracts
      if (this.users[telegramId].contracts && this.users[telegramId].contracts[network]) {
        return this.users[telegramId].contracts[network];
      }
      
      // Fallback на legacy contractAddress для обратной совместимости
      if (this.users[telegramId].contractAddress) {
        return this.users[telegramId].contractAddress;
      }
    }
    return null;
  }

  getHiddenTokens(telegramId, networkName = null) {
    const user = this.users[telegramId];
    if (!user) {
      return [];
    }

    const network = networkName ? networkName.toUpperCase() : user.currentNetwork || config.DEFAULT_NETWORK;
    return user.hiddenTokens?.[network] || [];
  }

  hideToken(telegramId, tokenAddress, networkName = null) {
    const user = this.users[telegramId];
    if (!user || !tokenAddress) {
      return false;
    }

    const network = networkName ? networkName.toUpperCase() : user.currentNetwork || config.DEFAULT_NETWORK;
    const normalizedAddress = tokenAddress.toLowerCase();

    if (!user.hiddenTokens) {
      user.hiddenTokens = {};
    }
    if (!user.hiddenTokens[network]) {
      user.hiddenTokens[network] = [];
    }
    if (!user.hiddenTokens[network].includes(normalizedAddress)) {
      user.hiddenTokens[network].push(normalizedAddress);
    }

    user.lastActivity = new Date().toISOString();
    this.saveUsers();
    return true;
  }

  unhideToken(telegramId, tokenAddress, networkName = null) {
    const user = this.users[telegramId];
    if (!user || !tokenAddress) {
      return false;
    }

    const network = networkName ? networkName.toUpperCase() : user.currentNetwork || config.DEFAULT_NETWORK;
    const normalizedAddress = tokenAddress.toLowerCase();
    const hiddenTokens = user.hiddenTokens?.[network];

    if (!hiddenTokens) {
      return true;
    }

    user.hiddenTokens[network] = hiddenTokens.filter(address => address !== normalizedAddress);
    user.lastActivity = new Date().toISOString();
    this.saveUsers();
    return true;
  }

  updateUserActivity(telegramId) {
    if (this.users[telegramId]) {
      this.users[telegramId].lastActivity = new Date().toISOString();
      this.saveUsers();
    }
  }

  removeUser(telegramId) {
    if (this.users[telegramId]) {
      delete this.users[telegramId];
      this.saveUsers();
      return true;
    }
    return false;
  }

  getAllUsers() {
    return Object.keys(this.users).map(telegramId => ({
      telegramId,
      ...this.users[telegramId]
    }));
  }

  isUserExists(telegramId) {
    return this.users.hasOwnProperty(telegramId);
  }

  getUserStats() {
    const totalUsers = Object.keys(this.users).length;
    const usersWithContracts = Object.values(this.users).filter(user => {
      return user.contractAddress || (user.contracts && Object.keys(user.contracts).length > 0);
    }).length;
    
    return {
      totalUsers,
      usersWithContracts,
      usersWithoutContracts: totalUsers - usersWithContracts
    };
  }
}

module.exports = UserManager;




