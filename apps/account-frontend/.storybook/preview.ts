import type { Preview } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';
import { withThemeByClassName } from '@storybook/addon-themes';
import { setCompodocJson } from '@storybook/addon-docs/angular';
import { APP_BASE_HREF } from '@angular/common';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

import { credentialsInterceptor } from '../src/app/shared/interceptors/credentials.interceptor';
import { csrfInterceptor } from '../src/app/shared/interceptors/csrf.interceptor';
import { ensureMswReady, withMsw } from '../src/storybook/msw';
import docJson from '../documentation.json';

setCompodocJson(docJson);

const preview: Preview = {
  decorators: [
    applicationConfig({
      providers: [
        { provide: APP_BASE_HREF, useValue: '/' },
        provideRouter([]),
        provideHttpClient(withFetch(), withInterceptors([credentialsInterceptor, csrfInterceptor])),
      ],
    }),
    withThemeByClassName({
      themes: {
        light: 'light-theme',
        dark: 'dark-theme',
      },
      defaultTheme: 'light',
    }),
    (storyFn, context) => {
      const theme = String(context.globals['theme'] ?? 'light');
      document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
      return storyFn();
    },
    withMsw,
  ],
  loaders: [async () => ensureMswReady()],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'app-surface',
      values: [
        { name: 'app-surface', value: '#f5f7fb' },
        { name: 'dark-surface', value: '#121212' },
      ],
    },
    layout: 'centered',
  },
};

export default preview;
