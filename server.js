const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { ethers } = require('ethers');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const RPC_URL = process.env.ETH_RPC_URL || process.env.RPC_URL || 'https://eth.llamarpc.com';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище данных
let wallets = new Map();
let activeOrders = new Map();
let priceMonitors = new Map();
let appLogs = [];

// Helper: broadcast app log events (not price ticks)
function emitLog(message) {
  const entry = { message, time: new Date().toISOString() };
  appLogs.unshift(entry);
  if (appLogs.length > 500) appLogs.pop();
  io.emit('appLog', entry);
}

// REST: получить последние логи
app.get('/api/logs', (req, res) => {
  res.json({ success: true, logs: appLogs });
});

// ABI для контрактов
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

function getZapArtifact() {
  const artifactPath = path.join(__dirname, 'artifacts', 'contracts', 'Zap.sol', 'Zap.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return { abi: artifact.abi, bytecode: artifact.bytecode };
}

function getTokenPriceInETH(reserve0, reserve1, token0, token1, tokenAddress) {
  let tokenReserve, ethReserve;
  
  if (token0.toLowerCase() === tokenAddress.toLowerCase()) {
    tokenReserve = reserve0;
    ethReserve = reserve1;
  } else if (token1.toLowerCase() === tokenAddress.toLowerCase()) {
    tokenReserve = reserve1;
    ethReserve = reserve0;
  } else {
    throw new Error('Токен не найден в паре');
  }
  
  return Number(ethReserve) / Number(tokenReserve);
}

async function getCurrentPrice(provider, pairAddress, tokenAddress) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  
  const [reserves, token0, token1] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
    pair.token1()
  ]);
  
  return getTokenPriceInETH(reserves[0], reserves[1], token0, token1, tokenAddress);
}

async function getWalletBalance(provider, address) {
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}

// API Routes

// Добавление кошелька
app.post('/api/wallet/add', async (req, res) => {
  try {
    const { privateKey } = req.body;
    
    if (!privateKey) {
      return res.json({ success: false, error: 'Приватный ключ не указан' });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await getWalletBalance(provider, wallet.address);
    
    const walletData = {
      address: wallet.address,
      privateKey: privateKey,
      balance: parseFloat(balance).toFixed(4)
    };
    
    wallets.set(wallet.address, walletData);
    emitLog(`Кошелек добавлен: ${wallet.address} (баланс ~${walletData.balance} ETH)`);
    
    res.json({ success: true, wallet: walletData });
  } catch (error) {
    emitLog(`Ошибка добавления кошелька: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// Деплой контракта
app.post('/api/deploy', async (req, res) => {
  try {
    const { walletIndex, tokenAddress, lpAddress, routerAddress } = req.body;
    
    // Получаем кошелек по индексу (в реальном приложении нужно хранить индексы)
    const walletEntries = Array.from(wallets.values());
    if (walletIndex >= walletEntries.length) {
      return res.json({ success: false, error: 'Неверный индекс кошелька' });
    }
    
    const walletData = walletEntries[walletIndex];
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(walletData.privateKey, provider);

    const { abi, bytecode } = getZapArtifact();
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    emitLog(`Деплой Zap: token=${tokenAddress}, lp=${lpAddress}, router=${routerAddress}`);
    const zap = await factory.deploy(tokenAddress, lpAddress, routerAddress);
    const receipt = await zap.deploymentTransaction().wait();
    const address = await zap.getAddress();
    emitLog(`УСПЕШНО: Zap задеплоен по адресу ${address}`);
    res.json({ success: true, address });
  } catch (error) {
    emitLog(`Ошибка деплоя: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// Ручная покупка
app.post('/api/trade/buy', async (req, res) => {
  try {
    const { walletIndex, zapAddress, buyAmount } = req.body;
    
    const walletEntries = Array.from(wallets.values());
    if (walletIndex >= walletEntries.length) {
      return res.json({ success: false, error: 'Неверный индекс кошелька' });
    }
    
    const walletData = walletEntries[walletIndex];
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(walletData.privateKey, provider);
    
    const zap = new ethers.Contract(zapAddress, getZapArtifact().abi, wallet);
    const amountWei = ethers.parseEther(buyAmount);
    
    emitLog(`Отправка zapIn: сумма ${buyAmount} ETH → ${zapAddress}`);
    const tx = await zap.zapIn(0n, 0n, 0n, { value: amountWei });
    await tx.wait();
    emitLog(`УСПЕШНО: zapIn tx=${tx.hash}`);
    io.emit('tradeExecuted', { type: 'zap-in', hash: tx.hash });
    res.json({ success: true, hash: tx.hash });
  } catch (error) {
    emitLog(`Ошибка zapIn: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// Ручная продажа
app.post('/api/trade/sell', async (req, res) => {
  try {
    const { walletIndex, zapAddress } = req.body;
    
    const walletEntries = Array.from(wallets.values());
    if (walletIndex >= walletEntries.length) {
      return res.json({ success: false, error: 'Неверный индекс кошелька' });
    }
    
    const walletData = walletEntries[walletIndex];
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(walletData.privateKey, provider);
    
    const zap = new ethers.Contract(zapAddress, getZapArtifact().abi, wallet);
    
    emitLog(`Отправка exitAndSell для ${zapAddress}`);
    const tx = await zap.exitAndSell(0n, 0n, 0n);
    await tx.wait();
    emitLog(`УСПЕШНО: exitAndSell tx=${tx.hash}`);
    io.emit('tradeExecuted', { type: 'exit-and-sell', hash: tx.hash });
    res.json({ success: true, hash: tx.hash });
  } catch (error) {
    emitLog(`Ошибка exitAndSell: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// Запуск лимитного ордера
app.post('/api/order/start-buy', async (req, res) => {
  try {
    const { walletIndex, tokenAddress, lpPair, zapAddress, buyPrice, buyAmount } = req.body;
    
    const walletEntries = Array.from(wallets.values());
    if (walletIndex >= walletEntries.length) {
      return res.json({ success: false, error: 'Неверный индекс кошелька' });
    }
    
    const walletData = walletEntries[walletIndex];
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(walletData.privateKey, provider);
    
    const orderId = Date.now().toString();
    
    const orderData = {
      id: orderId,
      walletIndex,
      tokenAddress,
      lpPair,
      zapAddress,
      mode: 'buy',
      buyPrice: parseFloat(buyPrice),
      buyAmount,
      status: 'active',
      lastAction: null,
      executing: false
    };
    
    activeOrders.set(orderId, orderData);
    emitLog(`Лимит BUY запущен #${orderId}: price<=${orderData.buyPrice}, amount=${buyAmount} ETH`);
    
    // Запускаем мониторинг цены
    startPriceMonitoring(orderId, orderData, provider, wallet);
    
    res.json({ success: true, orderId });
  } catch (error) {
    emitLog(`Ошибка запуска лимит BUY: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// Запуск лимитного ордера на продажу (однократное исполнение)
app.post('/api/order/start-sell', async (req, res) => {
  try {
    const { walletIndex, tokenAddress, lpPair, zapAddress, sellPrice } = req.body;

    const walletEntries = Array.from(wallets.values());
    if (walletIndex >= walletEntries.length) {
      return res.json({ success: false, error: 'Неверный индекс кошелька' });
    }

    const walletData = walletEntries[walletIndex];
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(walletData.privateKey, provider);

    const orderId = Date.now().toString();

    const orderData = {
      id: orderId,
      walletIndex,
      tokenAddress,
      lpPair,
      zapAddress,
      mode: 'sell',
      sellPrice: parseFloat(sellPrice),
      status: 'active',
      lastAction: null,
      executing: false
    };

    activeOrders.set(orderId, orderData);
    emitLog(`Лимит SELL запущен #${orderId}: price>=${orderData.sellPrice}`);

    startPriceMonitoring(orderId, orderData, provider, wallet);

    res.json({ success: true, orderId });
  } catch (error) {
    emitLog(`Ошибка запуска лимит SELL: ${error.message}`);
    res.json({ success: false, error: error.message });
  }
});

// Остановка лимитного ордера
app.post('/api/order/stop', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (activeOrders.has(orderId)) {
      activeOrders.delete(orderId);
      
      // Останавливаем мониторинг цены
      if (priceMonitors.has(orderId)) {
        clearInterval(priceMonitors.get(orderId));
        priceMonitors.delete(orderId);
      }
      
      io.emit('orderUpdate', { orderId, status: 'stopped' });
      emitLog(`Ордер #${orderId} остановлен`);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Функция мониторинга цены
function stopMonitor(orderId) {
  if (priceMonitors.has(orderId)) {
    clearInterval(priceMonitors.get(orderId));
    priceMonitors.delete(orderId);
  }
}

function startPriceMonitoring(orderId, orderData, provider, wallet) {
  const monitor = setInterval(async () => {
    try {
      const currentPrice = await getCurrentPrice(provider, orderData.lpPair, orderData.tokenAddress);
      const now = Date.now();
      
      // Отправляем обновление цены
      io.emit('priceUpdate', { 
        orderId, 
        price: currentPrice,
        tokenAddress: orderData.tokenAddress 
      });
      
      // Проверяем cooldown (15 секунд)
      if (orderData.lastAction && (now - orderData.lastAction) < 15000) {
        return;
      }
      
      // Проверяем цену газа
      const feeData = await provider.getFeeData();
      const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
      
      if (gasPriceGwei > 50) {
        return;
      }
      
      // Логика торговли (однократное исполнение с защитой от дублей)
      if (orderData.executing) {
        return;
      }
      if (orderData.mode === 'buy' && currentPrice <= orderData.buyPrice) {
        orderData.executing = true;
        stopMonitor(orderId);
        try {
          console.log(`🟢 Покупка: ${currentPrice.toFixed(8)} <= ${orderData.buyPrice}`);
          await executeZapIn(wallet, orderData.zapAddress, orderData.buyAmount);
          orderData.lastAction = now;
          orderData.status = 'filled';
          io.emit('tradeExecuted', { type: 'limit-buy', orderId, price: currentPrice });
          io.emit('orderUpdate', { orderId, status: 'filled' });
          emitLog(`Лимит BUY исполнен #${orderId} по цене ${currentPrice}`);
        } catch (e) {
          orderData.status = 'error';
          emitLog(`Ошибка исполнения BUY #${orderId}: ${e.message}`);
          io.emit('orderUpdate', { orderId, status: 'error' });
        } finally {
          activeOrders.delete(orderId);
        }
      } else if (orderData.mode === 'sell' && currentPrice >= orderData.sellPrice) {
        orderData.executing = true;
        stopMonitor(orderId);
        try {
          console.log(`🔴 Продажа: ${currentPrice.toFixed(8)} >= ${orderData.sellPrice}`);
          await executeExit(wallet, orderData.zapAddress);
          orderData.lastAction = now;
          orderData.status = 'filled';
          io.emit('tradeExecuted', { type: 'limit-sell', orderId, price: currentPrice });
          io.emit('orderUpdate', { orderId, status: 'filled' });
          emitLog(`Лимит SELL исполнен #${orderId} по цене ${currentPrice}`);
        } catch (e) {
          orderData.status = 'error';
          emitLog(`Ошибка исполнения SELL #${orderId}: ${e.message}`);
          io.emit('orderUpdate', { orderId, status: 'error' });
        } finally {
          activeOrders.delete(orderId);
        }
      }
      
    } catch (error) {
      console.error('Ошибка мониторинга:', error);
    }
  }, 5000); // Проверяем каждые 5 секунд
  
  priceMonitors.set(orderId, monitor);
}

async function executeZapIn(wallet, zapAddress, amountETH) {
  const zap = new ethers.Contract(zapAddress, getZapArtifact().abi, wallet);
  const amountWei = ethers.parseEther(amountETH);
  
  const tx = await zap.zapIn(0n, 0n, 0n, { value: amountWei });
  await tx.wait();
  console.log('УСПЕШНО: zap-in выполнен');
}

async function executeExit(wallet, zapAddress) {
  const zap = new ethers.Contract(zapAddress, getZapArtifact().abi, wallet);
  
  const tx = await zap.exitAndSell(0n, 0n, 0n);
  await tx.wait();
  console.log('УСПЕШНО: выход и продажа выполнены');
}

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('Клиент подключен:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Клиент отключен:', socket.id);
  });
});

// Запуск сервера
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log('📊 Веб-интерфейс доступен в браузере');
});
