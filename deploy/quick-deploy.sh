#!/bin/bash

# 🚀 MultiZap Bot - Быстрый деплой
# Использование: ./quick-deploy.sh

set -e

echo "🚀 MultiZap Bot - Быстрый деплой"
echo "================================="

# Проверка, что скрипт запущен от root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Запустите скрипт с правами root: sudo ./quick-deploy.sh"
    exit 1
fi

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Функция для вывода сообщений
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 1. Обновление системы
print_status "Обновление системы..."
apt update && apt upgrade -y

# 2. Установка Node.js 18.x
print_status "Установка Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Проверка версии Node.js
NODE_VERSION=$(node --version)
print_status "Node.js установлен: $NODE_VERSION"

# 3. Установка PM2
print_status "Установка PM2..."
npm install -g pm2

# 4. Установка Git
print_status "Установка Git..."
apt install -y git

# 5. Создание пользователя для бота
print_status "Создание пользователя zapbot..."
if id "zapbot" &>/dev/null; then
    print_warning "Пользователь zapbot уже существует"
else
    useradd -m -s /bin/bash zapbot
    usermod -aG sudo zapbot
    print_status "Пользователь zapbot создан"
fi

# 6. Создание директории для бота
print_status "Создание директории для бота..."
mkdir -p /home/zapbot/multizap-bot
chown zapbot:zapbot /home/zapbot/multizap-bot

# 7. Клонирование проекта с GitHub
print_status "Клонирование проекта с GitHub..."
if [ -d "../bot" ] && [ -d "../contracts" ]; then
    # Если файлы уже есть локально
    cp -r ../bot /home/zapbot/multizap-bot/
    cp -r ../contracts /home/zapbot/multizap-bot/
    cp -r ../artifacts /home/zapbot/multizap-bot/
    cp ../package.json /home/zapbot/multizap-bot/
    cp ../hardhat.config.js /home/zapbot/multizap-bot/
    cp ../.env /home/zapbot/multizap-bot/ 2>/dev/null || print_warning ".env файл не найден, создайте его вручную"
    chown -R zapbot:zapbot /home/zapbot/multizap-bot
    print_status "Файлы скопированы"
else
    # Клонируем с GitHub
    print_status "Клонирование с GitHub..."
    sudo -u zapbot bash -c "cd /home/zapbot && git clone https://github.com/your-username/multizap-bot.git multizap-bot"
    print_status "Проект клонирован с GitHub"
fi

# 8. Установка зависимостей
print_status "Установка зависимостей..."
sudo -u zapbot bash -c "cd /home/zapbot/multizap-bot && npm install"

# 9. Создание .env файла если его нет
if [ ! -f "/home/zapbot/multizap-bot/.env" ]; then
    print_warning "Создание шаблона .env файла..."
    cat > /home/zapbot/multizap-bot/.env << EOF
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
EOF
    chown zapbot:zapbot /home/zapbot/multizap-bot/.env
    print_status "Шаблон .env создан"
fi

# 10. Копирование PM2 конфигурации
print_status "Настройка PM2..."
cp ecosystem.config.js /home/zapbot/multizap-bot/
chown zapbot:zapbot /home/zapbot/multizap-bot/ecosystem.config.js

# 11. Создание директории для логов
print_status "Создание директории для логов..."
mkdir -p /home/zapbot/multizap-bot/logs
chown zapbot:zapbot /home/zapbot/multizap-bot/logs

echo ""
echo "🎉 Деплой завершен!"
echo "==================="
echo ""
print_status "Следующие шаги:"
echo "1. Переключитесь на пользователя zapbot: sudo su - zapbot"
echo "2. Перейдите в директорию: cd /home/zapbot/multizap-bot"
echo "3. Отредактируйте .env файл: nano .env"
echo "4. Запустите бота: npm run pm2:start"
echo "5. Проверьте статус: npm run pm2:status"
echo ""
print_warning "Не забудьте настроить .env файл с вашими данными!"
echo ""
