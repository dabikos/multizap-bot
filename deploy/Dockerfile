# MultiZap Bot Dockerfile
FROM node:18-alpine

# Установка системных зависимостей
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++

# Создание рабочей директории
WORKDIR /app

# Копирование package.json
COPY package*.json ./

# Установка зависимостей
RUN npm ci --only=production

# Копирование исходного кода
COPY . .

# Компиляция контрактов
RUN npm run compile

# Создание пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S multizap -u 1001

# Создание директории для логов
RUN mkdir -p logs && chown multizap:nodejs logs

# Переключение на пользователя
USER multizap

# Открытие порта
EXPOSE 3000

# Команда запуска
CMD ["node", "bot/telegram-bot.js"]







