# 🚀 MultiZap Bot - Деплой на сервер (BSC)

## Быстрый старт

### Linux/Ubuntu сервер:

```bash
# 1. Скачайте и запустите скрипт деплоя
wget https://raw.githubusercontent.com/your-repo/multizap-bot/main/deploy/quick-deploy.sh
chmod +x quick-deploy.sh
sudo ./quick-deploy.sh

# 2. Переключитесь на пользователя zapbot
sudo su - zapbot
cd /home/zapbot/multizap-bot

# 3. Настройте .env файл
nano .env

# 4. Запустите бота
npm run pm2:start
```

### Windows сервер:

```cmd
# 1. Запустите скрипт деплоя
deploy-windows.bat

# 2. Отредактируйте .env файл
notepad .env

# 3. Запустите бота
npm run pm2:start
```

## Настройка .env файла для BSC

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here

# BSC Network Configuration  
RPC_URL=https://bsc-dataseed1.binance.org
CHAIN_ID=56
ROUTER_ADDRESS=0x10ED43C718714eb63d5aA57B78B54704E256024E
FACTORY_ADDRESS=0xcA143Ce0Fe65960E6Aa4D42C8D3cE161c2B6604f

# Private Key (ОСТОРОЖНО!)
PRIVATE_KEY=your_private_key_here

# Gas Settings (BSC uses legacy gas)
GAS_PRICE=5000000000
GAS_LIMIT=2000000

# Slippage
DEFAULT_SLIPPAGE=7
MAX_SLIPPAGE=50
MIN_SLIPPAGE=0.1
```

## Управление ботом

### PM2 команды:
```bash
npm run pm2:start     # Запустить бота
npm run pm2:stop      # Остановить бота
npm run pm2:restart   # Перезапустить бота
npm run pm2:status    # Статус бота
npm run pm2:logs      # Просмотр логов
```

### Прямые PM2 команды:
```bash
pm2 start ecosystem.config.js
pm2 stop multizap-bot
pm2 restart multizap-bot
pm2 status
pm2 logs multizap-bot
```

## Мониторинг

### Проверка статуса:
```bash
pm2 status
```

### Просмотр логов:
```bash
pm2 logs multizap-bot --lines 100
```

### Мониторинг в реальном времени:
```bash
pm2 monit
```

## Автозапуск при перезагрузке

```bash
# Сохраните текущую конфигурацию
pm2 save

# Настройте автозапуск
pm2 startup

# Следуйте инструкциям команды
```

## Безопасность

1. **Никогда не коммитьте .env файл**
2. **Используйте сильные пароли**
3. **Настройте firewall**
4. **Регулярно обновляйте систему**
5. **Мониторьте логи**

## Troubleshooting

### Бот не запускается:
```bash
# Проверьте логи
pm2 logs multizap-bot

# Проверьте .env файл
cat .env

# Проверьте права доступа
ls -la
```

### Ошибки сети:
```bash
# Проверьте RPC подключение
curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' $RPC_URL
```

### Недостаточно газа:
```bash
# Увеличьте GAS_LIMIT в .env
GAS_LIMIT=1000000
```

## Файлы проекта

- `bot/telegram-bot.js` - Основной файл бота
- `bot/web3Manager.js` - Web3 менеджер
- `bot/config.js` - Конфигурация
- `contracts/MultiZap.sol` - Смарт-контракт
- `ecosystem.config.js` - PM2 конфигурация
- `.env` - Переменные окружения

## Поддержка

При возникновении проблем:
1. Проверьте логи: `pm2 logs multizap-bot`
2. Проверьте статус: `pm2 status`
3. Перезапустите бота: `pm2 restart multizap-bot`
4. Проверьте .env файл