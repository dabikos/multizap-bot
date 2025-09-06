# 🚀 Загрузка проекта на GitHub

## 1. Создание репозитория на GitHub

1. Перейдите на [GitHub.com](https://github.com)
2. Нажмите "New repository"
3. Заполните данные:
   - **Repository name**: `multizap-bot`
   - **Description**: `Telegram bot for DeFi zap-in/exit operations on Ethereum`
   - **Visibility**: Public (или Private)
   - **Initialize**: НЕ ставьте галочки (у нас уже есть файлы)

## 2. Инициализация Git в проекте

```bash
# В папке проекта
git init
git add .
git commit -m "Initial commit: MultiZap Bot with EIP-1559 and MEV protection"
```

## 3. Подключение к GitHub

```bash
# Замените your-username на ваш GitHub username
git remote add origin https://github.com/your-username/multizap-bot.git
git branch -M main
git push -u origin main
```

## 4. Обновление ссылок в файлах

После загрузки обновите ссылки в файлах:

### В `deploy/quick-deploy.sh`:
```bash
# Замените your-username на ваш GitHub username
git clone https://github.com/your-username/multizap-bot.git multizap-bot
```

### В `README.md`:
```markdown
# Замените your-username на ваш GitHub username
git clone https://github.com/your-username/multizap-bot.git
```

### В `deploy/deploy-guide.md`:
```bash
# Замените your-username на ваш GitHub username
wget https://raw.githubusercontent.com/your-username/multizap-bot/main/deploy/quick-deploy.sh
```

## 5. Создание релиза

1. Перейдите в раздел "Releases" на GitHub
2. Нажмите "Create a new release"
3. Заполните:
   - **Tag version**: `v1.0.0`
   - **Release title**: `MultiZap Bot v1.0.0`
   - **Description**: 
     ```
     🚀 Первый релиз MultiZap Bot!
     
     ✨ Возможности:
     - Zap-in операции с MEV защитой
     - EIP-1559 поддержка
     - Автоматический подбор slippage
     - Telegram интерфейс
     - Деплой скрипты для Linux/Windows
     ```

## 6. Настройка GitHub Pages (опционально)

1. Перейдите в Settings → Pages
2. Выберите source: "Deploy from a branch"
3. Выберите branch: "main"
4. Выберите folder: "/ (root)"
5. Нажмите "Save"

## 7. Настройка GitHub Actions (опционально)

Создайте файл `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm install
      
    - name: Compile contracts
      run: npm run compile
      
    - name: Run tests
      run: npm test
```

## 8. Обновление скриптов деплоя

После загрузки на GitHub обновите ссылки:

```bash
# В deploy/quick-deploy.sh замените:
wget https://raw.githubusercontent.com/your-username/multizap-bot/main/deploy/quick-deploy.sh

# В deploy/deploy-guide.md замените:
wget https://raw.githubusercontent.com/your-username/multizap-bot/main/deploy/quick-deploy.sh
```

## 9. Проверка деплоя

После загрузки на GitHub протестируйте деплой:

```bash
# На сервере
wget https://raw.githubusercontent.com/your-username/multizap-bot/main/deploy/quick-deploy.sh
chmod +x quick-deploy.sh
sudo ./quick-deploy.sh
```

## 10. Документация

Не забудьте обновить:
- README.md с правильными ссылками
- deploy/README.md с инструкциями
- Все ссылки на репозиторий

---

**Готово! Теперь ваш проект доступен на GitHub и готов к деплою!** 🎉
