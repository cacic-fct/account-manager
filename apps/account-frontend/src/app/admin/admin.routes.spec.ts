import { adminRoutes } from './admin.routes';

describe('adminRoutes', () => {
  it('exposes the lazy-loaded account merge screen', () => {
    const route = adminRoutes.find(({ path }) => path === 'account-merges');

    expect(route?.loadComponent).toBeTypeOf('function');
  });
});
