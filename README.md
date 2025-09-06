# 🤖 MultiZap Bot

Telegram бот для автоматизации DeFi операций с поддержкой zap-in и exit операций на Ethereum.

## ✨ Возможности

- 🚀 **Zap-in операции** - покупка токенов + добавление в LP
- 🔄 **Exit операции** - продажа LP + получение ETH
- 🛡️ **MEV защита** - 7% slippage по умолчанию
- ⚡ **EIP-1559** - оптимизированные газовые параметры
- 🎯 **Автоматический подбор** slippage для разных токенов
- 📱 **Telegram интерфейс** - удобное управление
- 🔧 **Мульти-токен** - один контракт для всех токенов

## 🚀 Быстрый старт

### Локальная разработка:

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/your-username/multizap-bot.git
cd multizap-bot

# 2. Установите зависимости
npm install

# 3. Скомпилируйте контракты
npm run compile

# 4. Настройте .env файл
cp .env.example .env
nano .env

# 5. Запустите бота
npm run bot
```

### Деплой на сервер:

```bash
# Linux/Ubuntu
wget https://raw.githubusercontent.com/your-username/multizap-bot/main/deploy/quick-deploy.sh
chmod +x quick-deploy.sh
sudo ./quick-deploy.sh

# Windows
deploy-windows.bat
```

## ⚙️ Настройка

Создайте `.env` файл:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Ethereum Network
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your_api_key
CHAIN_ID=1
ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
FACTORY_ADDRESS=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f

# Private Key (ОСТОРОЖНО!)
PRIVATE_KEY=your_private_key_here

# Gas Settings
MAX_FEE_PER_GAS=50000000000
MAX_PRIORITY_FEE_PER_GAS=2000000000
GAS_LIMIT=500000

# Slippage
DEFAULT_SLIPPAGE=7
MAX_SLIPPAGE=50
MIN_SLIPPAGE=0.1
```

## 📱 Команды бота

- `/start` - Начать работу с ботом
- `/home` - Главное меню
- `/menu` - Меню команд
- `/register` - Регистрация (добавить приватный ключ)
- `/deploy` - Развернуть контракт
- `/addtoken` - Добавить токен
- `/tokens` - Список токенов
- `/positions` - Мои позиции
- `/zapin` - Купить токены
- `/exit` - Продать позиции
- `/balance` - Балансы
- `/help` - Помощь

## 🏗️ Архитектура

```
├── bot/
│   ├── telegram-bot.js    # Основной файл бота
│   ├── web3Manager.js     # Web3 менеджер
│   ├── userManager.js     # Менеджер пользователей
│   └── config.js          # Конфигурация
├── contracts/
│   └── MultiZap.sol       # Смарт-контракт
├── deploy/
│   ├── quick-deploy.sh    # Скрипт деплоя Linux
│   ├── deploy-windows.bat # Скрипт деплоя Windows
│   ├── ecosystem.config.js # PM2 конфигурация
│   └── Dockerfile         # Docker конфигурация
└── scripts/
    └── deploy.js          # Скрипт деплоя контракта
```

## 🔧 Разработка

### Установка зависимостей:
```bash
npm install
```

### Компиляция контрактов:
```bash
npm run compile
```

### Деплой контракта:
```bash
npm run deploy
```

### Запуск бота:
```bash
npm run bot
```

### Тестирование:
```bash
npm test
```

## 🛡️ Безопасность

- ✅ **EIP-1559** - современные газовые параметры
- ✅ **MEV защита** - 7% slippage по умолчанию
- ✅ **Проверка лимитов** - защита от переплат
- ✅ **Валидация входных данных** - защита от ошибок
- ✅ **Логирование** - отслеживание операций

## 📊 Мониторинг

### PM2 команды:
```bash
npm run pm2:start     # Запустить бота
npm run pm2:stop      # Остановить бота
npm run pm2:restart   # Перезапустить бота
npm run pm2:status    # Статус бота
npm run pm2:logs      # Просмотр логов
```

### Логи:
```bash
pm2 logs multizap-bot --lines 100
```

## 🤝 Вклад в проект

1. Fork репозиторий
2. Создайте ветку для фичи (`git checkout -b feature/amazing-feature`)
3. Commit изменения (`git commit -m 'Add amazing feature'`)
4. Push в ветку (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

## 📄 Лицензия

Этот проект лицензирован под MIT License - см. файл [LICENSE](LICENSE) для деталей.

## ⚠️ Отказ от ответственности

Этот бот предназначен для образовательных целей. Используйте на свой страх и риск. Авторы не несут ответственности за потери средств.

## 📞 Поддержка

При возникновении проблем:
1. Проверьте [Issues](https://github.com/your-username/multizap-bot/issues)
2. Создайте новый Issue с описанием проблемы
3. Приложите логи и конфигурацию

## 🚀 Roadmap

- [ ] Поддержка других сетей (BSC, Polygon)
- [ ] Flashbots интеграция
- [ ] Web интерфейс
- [ ] Мобильное приложение
- [ ] API для внешних интеграций

---

**Сделано с ❤️ для DeFi сообщества**
