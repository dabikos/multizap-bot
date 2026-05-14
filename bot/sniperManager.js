const fs = require('fs');
const path = require('path');

class SniperManager {
  constructor() {
    this.snipersFile = path.join(__dirname, 'snipers.json');
    this.snipers = this.loadSnipers();
  }

  loadSnipers() {
    try {
      if (fs.existsSync(this.snipersFile)) {
        return JSON.parse(fs.readFileSync(this.snipersFile, 'utf8'));
      }
    } catch (error) {
      console.error('Failed to load snipers:', error.message);
    }
    return {};
  }

  saveSnipers() {
    try {
      fs.writeFileSync(this.snipersFile, JSON.stringify(this.snipers, null, 2), { mode: 0o666 });
    } catch (error) {
      console.error('Failed to save snipers:', error.message);
    }
  }

  createSniper(chatId, { deployer, amount, network, startBlock }) {
    const key = String(chatId);
    if (!this.snipers[key]) {
      this.snipers[key] = [];
    }

    const sniper = {
      id: Date.now(),
      deployer: deployer.toLowerCase(),
      amount: String(amount),
      network,
      startBlock,
      lastCheckedBlock: startBlock,
      status: 'active',
      detectedToken: null,
      detectedTx: null,
      buyTx: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.snipers[key].push(sniper);
    this.saveSnipers();
    return sniper;
  }

  getSnipers(chatId) {
    return this.snipers[String(chatId)] || [];
  }

  getActiveSnipers() {
    const result = [];
    for (const [chatId, snipers] of Object.entries(this.snipers)) {
      for (const sniper of snipers) {
        if (sniper.status === 'active' || sniper.status === 'watching_liquidity') {
          result.push({ chatId, sniper });
        }
      }
    }
    return result;
  }

  updateSniper(chatId, id, changes) {
    const sniper = this.getSnipers(chatId).find(item => item.id === Number(id));
    if (!sniper) {
      return null;
    }

    Object.assign(sniper, changes, { updatedAt: new Date().toISOString() });
    this.saveSnipers();
    return sniper;
  }

  stopSniper(chatId, id) {
    return this.updateSniper(chatId, id, { status: 'stopped' });
  }
}

module.exports = SniperManager;
