# 🚀 Деплой на виртуальный сервер через SSH

## Шаг 1: Отправка изменений в Git репозиторий

На вашем локальном компьютере:

```bash
# Проверить статус
git status

# Отправить изменения на сервер (GitHub/GitLab)
git push origin main
```

## Шаг 2: Подключение к серверу

```bash
# Подключитесь к вашему серверу через SSH
ssh user@your-server-ip
# или
ssh user@your-domain.com
```

## Шаг 3: Переход в директорию проекта

```bash
# Перейдите в директорию проекта
cd /path/to/multizap-bot
# Например: cd ~/multizap-bot или cd /var/www/multizap-bot
```

## Шаг 4: Получение последних изменений

```bash
# Получить последние изменения из репозитория
git pull origin main
```

## Шаг 5: Установка зависимостей (если нужно)

```bash
# Установить новые зависимости (если они были добавлены)
npm install

# Или если используете npm ci для чистой установки
npm ci
```

## Шаг 6: Настройка переменных окружения

Проверьте файл `.env` на сервере. Убедитесь, что там есть все необходимые переменные:

```bash
# Открыть файл .env для редактирования
nano .env
# или
vim .env
```

### Минимальные переменные для мультичейн:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Ethereum
ETH_RPC_URL=https://eth.llamarpc.com
ETH_ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
ETH_FACTORY_ADDRESS=0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f

# Binance Smart Chain
BSC_RPC_URL=https://bsc-dataseed1.binance.org
BSC_ROUTER_ADDRESS=0x10ED43C718714eb63d5aA57B78B54704E256024E
BSC_FACTORY_ADDRESS=0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73

# Base
BASE_RPC_URL=https://mainnet.base.org
BASE_ROUTER_ADDRESS=0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24
BASE_FACTORY_ADDRESS=0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6

# Старые переменные (для обратной совместимости)
RPC_URL=https://bsc-dataseed1.binance.org
CHAIN_ID=56
ROUTER_ADDRESS=0x10ED43C718714eb63d5aA57B78B54704E256024E
FACTORY_ADDRESS=0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73
```

**Сохраните файл** (в nano: `Ctrl+O`, затем `Enter`, затем `Ctrl+X`)

## Шаг 7: Перезапуск бота

### Вариант 1: Если используете PM2

```bash
# Перезапустить бота
pm2 restart multizap-bot

# Или если процесс называется по-другому
pm2 restart all

# Посмотреть статус
pm2 status

# Посмотреть логи
pm2 logs multizap-bot
```

### Вариант 2: Если используете systemd

```bash
# Перезапустить сервис
sudo systemctl restart multizap-bot

# Проверить статус
sudo systemctl status multizap-bot

# Посмотреть логи
sudo journalctl -u multizap-bot -f
```

### Вариант 3: Если запускаете напрямую через node

```bash
# Найти процесс бота
ps aux | grep "telegram-bot"

# Остановить старый процесс (замените PID на реальный)
kill <PID>

# Или убить все процессы node с этим файлом
pkill -f "telegram-bot.js"

# Запустить бота заново
node bot/telegram-bot.js

# Или в фоне с nohup
nohup node bot/telegram-bot.js > bot.log 2>&1 &
```

### Вариант 4: Если используете screen или tmux

```bash
# Для screen:
screen -r multizap-bot
# Нажмите Ctrl+C чтобы остановить
# Затем запустите: node bot/telegram-bot.js
# Нажмите Ctrl+A затем D чтобы отсоединиться

# Для tmux:
tmux attach -t multizap-bot
# Нажмите Ctrl+C чтобы остановить
# Затем запустите: node bot/telegram-bot.js
# Нажмите Ctrl+B затем D чтобы отсоединиться
```

## Шаг 8: Проверка работы бота

```bash
# Посмотреть логи (если используете PM2)
pm2 logs multizap-bot --lines 50

# Или если запускали напрямую
tail -f bot.log

# Проверить, что процесс запущен
ps aux | grep "telegram-bot"
```

## Быстрая команда для деплоя (одной строкой)

Если у вас настроен SSH доступ без пароля, можно деплоить одной командой с локального компьютера:

```bash
# На вашем локальном компьютере
git push origin main && \
ssh user@your-server-ip "cd /path/to/multizap-bot && \
  git pull origin main && \
  npm install && \
  pm2 restart multizap-bot"
```

## Откат изменений (если что-то пошло не так)

```bash
# На сервере
cd /path/to/multizap-bot

# Посмотреть историю коммитов
git log --oneline -10

# Откатиться на предыдущий коммит
git reset --hard HEAD~1

# Или откатиться на конкретный коммит
git reset --hard <commit-hash>

# Перезапустить бота
pm2 restart multizap-bot
```

## Полезные команды для мониторинга

```bash
# Посмотреть использование ресурсов
htop
# или
top

# Посмотреть использование диска
df -h

# Посмотреть использование памяти
free -h

# Посмотреть сетевые соединения
netstat -tulpn | grep node
```

## Настройка автозапуска (если еще не настроено)

### С PM2:

```bash
# Сохранить текущие процессы PM2
pm2 save

# Настроить автозапуск при перезагрузке сервера
pm2 startup
# Выполните команду, которую покажет PM2
```

### С systemd:

Создайте файл `/etc/systemd/system/multizap-bot.service`:

```ini
[Unit]
Description=MultiZap Telegram Bot
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/multizap-bot
Environment=NODE_ENV=production
ExecStart=/usr/bin/node bot/telegram-bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Затем:
```bash
sudo systemctl daemon-reload
sudo systemctl enable multizap-bot
sudo systemctl start multizap-bot
```

## Проверка после деплоя

1. Откройте Telegram бота
2. Отправьте `/start` - должно показать мультичейн возможности
3. Проверьте `/network` - должно быть переключение сетей
4. Проверьте `/home` - должна отображаться текущая сеть
5. Попробуйте развернуть контракт в разных сетях
6. Проверьте покупку/продажу токенов

## Troubleshooting

### Бот не запускается:

```bash
# Проверить логи ошибок
pm2 logs multizap-bot --err

# Проверить синтаксис файлов
node -c bot/telegram-bot.js
node -c bot/web3Manager.js

# Проверить переменные окружения
printenv | grep -E "(ETH_|BSC_|BASE_|TELEGRAM)"
```

### Ошибки с зависимостями:

```bash
# Удалить node_modules и переустановить
rm -rf node_modules package-lock.json
npm install
```

### Проблемы с правами доступа:

```bash
# Убедиться, что у пользователя есть права на директорию
chown -R your-user:your-user /path/to/multizap-bot
```







