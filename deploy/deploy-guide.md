# 🚀 MultiZap Bot - Деплой на сервер

## Вариант 1: Простой деплой с PM2 (рекомендуется)

### 1. Подготовка сервера

```bash
# Подключитесь к серверу
ssh root@your-server-ip

# Запустите скрипт настройки
wget https://raw.githubusercontent.com/your-repo/multizap-bot/main/deploy/server-setup.sh
chmod +x server-setup.sh
sudo bash server-setup.sh
```

### 2. Клонирование и настройка

```bash
# Переключитесь на пользователя zapbot
sudo su - zapbot
cd /home/zapbot

# Клонируйте репозиторий
git clone https://github.com/your-repo/multizap-bot.git
cd multizap-bot

# Установите зависимости
npm install

# Скомпилируйте контракты
npm run compile
```

### 3. Настройка переменных окружения

```bash
# Создайте .env файл
nano .env
```

Добавьте в .env:
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

### 4. Запуск с PM2

```bash
# Запустите бота
npm run pm2:start

# Проверьте статус
npm run pm2:status

# Посмотрите логи
npm run pm2:logs
```

### 5. Настройка автозапуска

```bash
# Сохраните текущую конфигурацию PM2
pm2 save

# Настройте автозапуск при перезагрузке сервера
pm2 startup

# Следуйте инструкциям, которые покажет команда
```

---

## Вариант 2: Деплой с Docker

### 1. Подготовка сервера

```bash
# Установите Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Установите Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

### 2. Настройка Docker Compose

Создайте `docker-compose.yml`:
```yaml
version: '3.8'

services:
  multizap-bot:
    build: .
    container_name: multizap-bot
    restart: unless-stopped
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - RPC_URL=${RPC_URL}
      - PRIVATE_KEY=${PRIVATE_KEY}
      - DEFAULT_SLIPPAGE=7
    volumes:
      - ./logs:/app/logs
      - ./bot/users.json:/app/bot/users.json
    networks:
      - multizap-network

networks:
  multizap-network:
    driver: bridge
```

### 3. Запуск

```bash
# Создайте .env файл (как в варианте 1)
nano .env

# Запустите контейнер
docker-compose up -d

# Проверьте логи
docker-compose logs -f
```

---

## Мониторинг и управление

### PM2 команды:
```bash
npm run pm2:status    # Статус процессов
npm run pm2:logs      # Просмотр логов
npm run pm2:restart   # Перезапуск
npm run pm2:stop      # Остановка
npm run pm2:delete    # Удаление
```

### Docker команды:
```bash
docker-compose ps           # Статус контейнеров
docker-compose logs -f      # Логи
docker-compose restart      # Перезапуск
docker-compose down         # Остановка
```

---

## Безопасность

1. **Никогда не коммитьте .env файл**
2. **Используйте сильные пароли**
3. **Настройте firewall**
4. **Регулярно обновляйте систему**
5. **Мониторьте логи**

---

## Troubleshooting

### Проблема: Бот не запускается
```bash
# Проверьте логи
npm run pm2:logs

# Проверьте .env файл
cat .env

# Проверьте права доступа
ls -la
```

### Проблема: Ошибки сети
```bash
# Проверьте RPC подключение
curl -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' $RPC_URL
```

### Проблема: Недостаточно газа
```bash
# Увеличьте GAS_LIMIT в .env
GAS_LIMIT=1000000
```
