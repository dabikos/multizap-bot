# 🔄 Миграция с Ethereum на BSC

Этот документ описывает изменения, внесенные для адаптации проекта MultiZap Bot для работы с Binance Smart Chain (BSC).

## 📋 Основные изменения

### 1. Сетевая конфигурация
- **RPC URL**: Изменен с Ethereum на BSC
- **Chain ID**: Изменен с 1 (Ethereum) на 56 (BSC)
- **Router**: Изменен с Uniswap V2 на PancakeSwap V2
- **Factory**: Изменен на PancakeSwap Factory

### 2. Газовые параметры
- **Удален EIP-1559**: BSC не поддерживает EIP-1559
- **Добавлен gasPrice**: Используется legacy gas pricing
- **Увеличен gasLimit**: BSC требует больше газа для сложных операций

### 3. Смарт-контракты
- **WETH → WBNB**: Заменен Wrapped ETH на Wrapped BNB
- **Функции роутера**: Обновлены для работы с PancakeSwap
- **Параметры функций**: Изменены ETH на BNB

### 4. Telegram бот
- **Интерфейс**: Обновлен для отображения BNB вместо ETH
- **Сообщения**: Адаптированы для BSC сети
- **Команды**: Остались без изменений

## 🔧 Файлы, которые были изменены

### Конфигурация
- `env.example` - обновлена для BSC
- `bot/config.js` - изменены сетевые параметры
- `hardhat.config.js` - добавлена сеть BSC

### Смарт-контракты
- `contracts/MultiZap.sol` - адаптирован для BSC
- `contracts/Zap.sol` - адаптирован для BSC

### Скрипты
- `scripts/deploy-multizap.js` - обновлен для BSC
- `scripts/multizap-in.js` - изменен для работы с BNB
- `scripts/exit-and-sell.js` - адаптирован для BSC

### Бот
- `bot/web3Manager.js` - обновлен для BSC
- `bot/telegram-bot.js` - изменены сообщения

### Документация
- `README.md` - обновлен для BSC
- `deploy/README.md` - адаптирован для BSC
- `bot/README.md` - обновлен для BSC

## 🚀 Инструкции по запуску

### 1. Обновите зависимости
```bash
npm install
```

### 2. Скомпилируйте контракты
```bash
npm run compile
```

### 3. Настройте .env файл
```env
# BSC Network Configuration
RPC_URL=https://bsc-dataseed1.binance.org
CHAIN_ID=56
ROUTER_ADDRESS=0x10ED43C718714eb63d5aA57B78B54704E256024E
FACTORY_ADDRESS=0xcA143Ce0Fe65960E6Aa4D42C8D3cE161c2B6604f

# Gas Settings (BSC uses legacy gas)
GAS_PRICE=5000000000
GAS_LIMIT=2000000
```

### 4. Разверните контракт
```bash
npm run deploy-multizap
```

### 5. Запустите бота
```bash
npm run bot
```

## ⚠️ Важные замечания

1. **BNB вместо ETH**: Все операции теперь работают с BNB
2. **PancakeSwap**: Используется PancakeSwap V2 вместо Uniswap V2
3. **Газ**: BSC использует legacy gas pricing
4. **Тестирование**: Рекомендуется сначала протестировать на BSC Testnet

## 🔗 Полезные ссылки

- [BSC Mainnet](https://bscscan.com/)
- [PancakeSwap](https://pancakeswap.finance/)
- [BSC RPC Endpoints](https://docs.bnbchain.org/docs/rpc)
- [BSC Testnet](https://testnet.bscscan.com/)

## 📞 Поддержка

При возникновении проблем:
1. Проверьте правильность RPC URL
2. Убедитесь, что у вас есть BNB для газа
3. Проверьте адреса контрактов PancakeSwap
4. Убедитесь, что токены поддерживаются на BSC









