#!/bin/bash

# Скрипт развертывания MultiZap Bot на сервер
# Запускать на сервере: bash deploy.sh

echo "🚀 Развертывание MultiZap Bot..."

# Создание директории для логов
mkdir -p logs

# Установка зависимостей
echo "📦 Установка зависимостей..."
npm install

# Компиляция контрактов
echo "🔨 Компиляция контрактов..."
npm run compile

# Создание .env файла если его нет
if [ ! -f .env ]; then
    echo "⚠️ Создайте файл .env с настройками:"
    echo "BOT_TOKEN=your_bot_token_here"
    echo "RPC_URL=your_rpc_url_here"
    echo "PRIVATE_KEY=your_private_key_here"
    echo "ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
    echo "FACTORY_ADDRESS=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
    exit 1
fi

# Остановка предыдущего процесса если запущен
pm2 stop multizap-bot 2>/dev/null || true
pm2 delete multizap-bot 2>/dev/null || true

# Запуск бота через PM2
echo "🤖 Запуск бота..."
pm2 start ecosystem.config.js

# Сохранение конфигурации PM2
pm2 save

# Настройка автозапуска
pm2 startup

echo "✅ Бот развернут и запущен!"
echo "📊 Статус: pm2 status"
echo "📝 Логи: pm2 logs multizap-bot"
echo "🔄 Перезапуск: pm2 restart multizap-bot"
echo "⏹️ Остановка: pm2 stop multizap-bot"







