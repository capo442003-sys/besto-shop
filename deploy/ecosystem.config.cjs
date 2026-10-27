/** PM2 — pm2 start deploy/ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'bmb-api',
      cwd: require('path').join(__dirname, '..'),
      script: 'backend/src/index.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        SERVE_CLIENT: '1',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      error_file: 'logs/bmb-error.log',
      out_file: 'logs/bmb-out.log',
    },
  ],
};