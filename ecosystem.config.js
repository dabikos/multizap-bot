module.exports = {
  apps: [{
    name: 'multizap-bot',
    script: 'bot/telegram-bot.js',
    cwd: '/home/zapbot/multizap-bot',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
