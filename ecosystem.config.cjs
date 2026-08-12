module.exports = {
  apps: [
    {
      name: 'fovi-next',
      script: 'node_modules/.bin/next',
      args: 'start --port 3002',
      cwd: '/home/lightworld/webapps/fovi',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
