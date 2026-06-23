const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  mode: 'production',
  output: {
    clean: true,
    path: join(__dirname, 'dist'),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: 'apps/account-backend/src/main.ts',
      tsConfig: 'apps/account-backend/tsconfig.build.json',
      outputFileName: 'main.js',
      buildLibsFromSource: true,
      externalDependencies: 'all',
      generatePackageJson: false,
      optimization: false,
      outputHashing: 'none',
      sourceMap: true,
      typeCheckOptions: {
        async: false,
      },
    }),
  ],
};
