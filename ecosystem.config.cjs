module.exports = {
  apps: [
    {
      name: 'clawsgames-api',
      cwd: './backend',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      env_file: '.env',
      env: {
        PORT: 5010,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
      },
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
