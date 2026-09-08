import type { Response } from 'express';
import { CsrfController } from './csrf.controller';
import { CsrfService } from './csrf.service';

describe(CsrfController.name, () => {
  it('returns a non-cacheable token cookie available to the application path', () => {
    const controller = new CsrfController(new CsrfService());
    const session: { csrfToken?: string } = {};
    const cookie = jest.fn();
    const json = jest.fn();
    const setHeader = jest.fn();
    const response = {
      cookie,
      json,
      setHeader,
    } as unknown as Response;

    controller.getToken(session, response);

    expect(session.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).toHaveBeenCalledWith(
      'XSRF-TOKEN',
      session.csrfToken,
      expect.objectContaining({
        httpOnly: false,
        path: '/',
        sameSite: 'strict',
      }),
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
    expect(json).toHaveBeenCalledWith({ csrfToken: session.csrfToken });
  });
});
