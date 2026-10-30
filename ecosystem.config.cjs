/**
 * PM2 process file for the EC2 host.
 * `script` is the tsc output of src/server.ts (tsconfig outDir dist, rootDir src).
 * dist/ is gitignored. `npm run build` must succeed before `pm2 start`.
 * PORT and NODE_ENV here override the same keys in .env because dotenv does not
 * replace variables that are already set. JWT_SECRET stays in the host .env.
 */
module.exports = {
  apps: [
    {
      name: 'ripskis-backend',
      cwd: '/home/ubuntu/cos-backend',
      script: 'dist/server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '5000',
      },
    },
  ],
};
