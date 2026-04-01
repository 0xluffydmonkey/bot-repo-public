// ecosystem.config.cjs — PM2 process manager config
module.exports = {
  apps: [
    {
      name:         'perps-bot',
      script:       'src/index.js',
      interpreter:  'node',
      // Reiniciar automaticamente se crashar
      autorestart:  true,
      watch:        false,
      max_memory_restart: '300M',
      // Reiniciar após 10 crashes rápidos (anti-loop)
      max_restarts: 10,
      min_uptime:   '5s',
      // Logs
      out_file:     './logs/pm2-out.log',
      error_file:   './logs/pm2-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Variáveis de ambiente de produção
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
