module.exports = {
  apps: [
    {
      name: 'clawsgames-api',
      cwd: './backend',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      env: { PORT: 5010 },
    },
    {
      name: 'clawsgames-ui',
      cwd: './frontend',
      script: 'node_modules/.bin/vite',
      args: '--host',
      env: { VITE_BASE_PATH: '/clawsgames/' },
    },
  ],
};
