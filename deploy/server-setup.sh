#!/bin/bash

# Скрипт для настройки сервера под MultiZap Bot
# Запускать с правами root: sudo bash server-setup.sh

echo "🚀 Настройка сервера для MultiZap Bot..."

# Обновление системы
apt update && apt upgrade -y

# Установка Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# Установка PM2 для управления процессами
npm install -g pm2

# Установка Git
apt install -y git

# Создание пользователя для бота
useradd -m -s /bin/bash zapbot
usermod -aG sudo zapbot

# Создание директории для бота
mkdir -p /home/zapbot/multizap-bot
chown zapbot:zapbot /home/zapbot/multizap-bot

echo "✅ Сервер настроен! Теперь переключитесь на пользователя zapbot:"
echo "sudo su - zapbot"
echo "cd /home/zapbot/multizap-bot"







