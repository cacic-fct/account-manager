const mockExec = jest.fn();
const mockExecAsync = jest.fn();
const mockSpawn = jest.fn();
const mockPromisifyCustom = Symbol.for('nodejs.util.promisify.custom');

Object.defineProperty(mockExec, mockPromisifyCustom, {
  value: mockExecAsync,
});

jest.mock('child_process', () => ({
  exec: mockExec,
  spawn: mockSpawn,
}));

import { PdfVerificationService } from './pdf-verification.service';

type ServiceInternals = {
  ensurePythonEnvironment: () => Promise<string>;
};

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('PdfVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(undefined);
  });

  it('initializes the Python environment from strict JSON output', async () => {
    mockExecAsync.mockResolvedValue({
      stdout: JSON.stringify({
        success: true,
        python_path: '/tmp/scripts/venv/bin/python',
      }),
      stderr: '',
    });

    const service = new PdfVerificationService();

    await flushPromises();

    await expect(
      (service as unknown as ServiceInternals).ensurePythonEnvironment(),
    ).resolves.toBe('/tmp/scripts/venv/bin/python');
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
  });
});
