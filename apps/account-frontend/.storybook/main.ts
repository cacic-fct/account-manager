import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-onboarding', '@storybook/addon-themes'],
  framework: '@storybook/angular',
  webpackFinal: async (config) => {
    config.resolve = {
      ...config.resolve,
      extensionAlias: { ...config.resolve?.extensionAlias, '.js': ['.ts', '.js'] },
    };
    return config;
  },
};

export default config;
