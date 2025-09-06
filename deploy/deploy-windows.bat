@echo off
echo 🚀 MultiZap Bot - Деплой на Windows Server
echo =========================================

echo.
echo 📋 Инструкция по деплою:
echo.
echo 1. Установите Node.js 18.x с https://nodejs.org/
echo 2. Установите PM2 глобально: npm install -g pm2
echo 3. Скопируйте папку проекта на сервер
echo 4. Откройте командную строку в папке проекта
echo 5. Установите зависимости: npm install
echo 6. Создайте .env файл с вашими настройками
echo 7. Запустите бота: npm run pm2:start
echo.

echo 📝 Создание .env файла...
if not exist .env (
    echo # Telegram Bot > .env
    echo TELEGRAM_BOT_TOKEN=your_bot_token_here >> .env
    echo. >> .env
    echo # Ethereum Network >> .env
    echo RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your_api_key >> .env
    echo CHAIN_ID=1 >> .env
    echo ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D >> .env
    echo FACTORY_ADDRESS=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f >> .env
    echo. >> .env
    echo # Private Key (ОСТОРОЖНО!) >> .env
    echo PRIVATE_KEY=your_private_key_here >> .env
    echo. >> .env
    echo # Gas Settings >> .env
    echo MAX_FEE_PER_GAS=50000000000 >> .env
    echo MAX_PRIORITY_FEE_PER_GAS=2000000000 >> .env
    echo GAS_LIMIT=500000 >> .env
    echo. >> .env
    echo # Slippage >> .env
    echo DEFAULT_SLIPPAGE=7 >> .env
    echo MAX_SLIPPAGE=50 >> .env
    echo MIN_SLIPPAGE=0.1 >> .env
    echo.
    echo ✅ .env файл создан!
) else (
    echo ✅ .env файл уже существует
)

echo.
echo 📋 Команды для управления ботом:
echo.
echo npm run pm2:start    - Запустить бота
echo npm run pm2:stop     - Остановить бота
echo npm run pm2:restart  - Перезапустить бота
echo npm run pm2:status   - Статус бота
echo npm run pm2:logs     - Просмотр логов
echo.

echo ⚠️  Не забудьте:
echo 1. Отредактировать .env файл с вашими данными
echo 2. Скомпилировать контракты: npm run compile
echo 3. Запустить бота: npm run pm2:start
echo.

pause
