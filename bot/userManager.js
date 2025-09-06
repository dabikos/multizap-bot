const fs = require('fs');
const path = require('path');

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
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.error('Ошибка сохранения пользователей:', error.message);
    }
  }

  addUser(telegramId, privateKey) {
    try {
      this.users[telegramId] = {
        privateKey: privateKey,
        contractAddress: null,
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

  updateUserContract(telegramId, contractAddress) {
    if (this.users[telegramId]) {
      this.users[telegramId].contractAddress = contractAddress;
      this.users[telegramId].lastActivity = new Date().toISOString();
      this.saveUsers();
      return true;
    }
    return false;
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
    const usersWithContracts = Object.values(this.users).filter(user => user.contractAddress).length;
    
    return {
      totalUsers,
      usersWithContracts,
      usersWithoutContracts: totalUsers - usersWithContracts
    };
  }
}

module.exports = UserManager;







