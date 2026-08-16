import { EventEmitter } from 'events';

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

type FakeChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: jest.Mock };
  kill: jest.Mock;
};

const createFakeChildProcess = (): FakeChildProcess => {
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn() };
  child.kill = jest.fn();
  return child;
};

const completePythonEnvironment = async (
  startupProcess: FakeChildProcess,
  pythonPath = '/tmp/scripts/venv/bin/python',
): Promise<void> => {
  startupProcess.stdout.emit(
    'data',
    JSON.stringify({
      success: true,
      python_path: pythonPath,
    }),
  );
  startupProcess.emit('close', 0);
  await flushPromises();
};

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('PdfVerificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(undefined);
    delete process.env.PDF_VERIFICATION_TIMEOUT_MS;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes the Python environment from strict JSON output', async () => {
    const startupProcess = createFakeChildProcess();
    mockSpawn.mockReturnValueOnce(startupProcess);

    const service = new PdfVerificationService();

    await completePythonEnvironment(startupProcess);

    await expect((service as unknown as ServiceInternals).ensurePythonEnvironment()).resolves.toBe(
      '/tmp/scripts/venv/bin/python',
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('passes buffer input to the Python verifier and parses its result', async () => {
    const startupProcess = createFakeChildProcess();
    const verificationProcess = createFakeChildProcess();
    mockSpawn.mockReturnValueOnce(startupProcess).mockReturnValueOnce(verificationProcess);

    const service = new PdfVerificationService();
    await completePythonEnvironment(startupProcess);

    const pdfBuffer = Buffer.from('%PDF-test');
    const resultPromise = service.verifyPdfDocumentFromBuffer(pdfBuffer);
    await flushPromises();
    verificationProcess.stdout.emit(
      'data',
      JSON.stringify({
        success: true,
        enrollment: '12345678',
      }),
    );
    verificationProcess.emit('close', 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      enrollment: '12345678',
    });
    expect(verificationProcess.stdin.end).toHaveBeenCalledWith(pdfBuffer);
    expect(mockSpawn).toHaveBeenNthCalledWith(
      2,
      '/tmp/scripts/venv/bin/python',
      [expect.stringContaining('verify_pdf_buffer.py')],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('kills a verifier process that exceeds the configured timeout', async () => {
    jest.useFakeTimers();
    process.env.PDF_VERIFICATION_TIMEOUT_MS = '25';
    const startupProcess = createFakeChildProcess();
    const verificationProcess = createFakeChildProcess();
    mockSpawn.mockReturnValueOnce(startupProcess).mockReturnValueOnce(verificationProcess);

    const service = new PdfVerificationService();
    await completePythonEnvironment(startupProcess);

    const resultPromise = service.verifyPdfDocumentFromBuffer(Buffer.from('%PDF-test'));
    await flushPromises();
    jest.advanceTimersByTime(25);
    await flushPromises();

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(verificationProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills a verifier process when stdout exceeds the output cap', async () => {
    const startupProcess = createFakeChildProcess();
    const verificationProcess = createFakeChildProcess();
    mockSpawn.mockReturnValueOnce(startupProcess).mockReturnValueOnce(verificationProcess);

    const service = new PdfVerificationService();
    await completePythonEnvironment(startupProcess);

    const resultPromise = service.verifyPdfDocumentFromBuffer(Buffer.from('%PDF-test'));
    await flushPromises();
    verificationProcess.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 'x'));

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('output exceeded');
    expect(verificationProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('returns a failure result when the verifier exits unsuccessfully', async () => {
    const startupProcess = createFakeChildProcess();
    const verificationProcess = createFakeChildProcess();
    mockSpawn.mockReturnValueOnce(startupProcess).mockReturnValueOnce(verificationProcess);

    const service = new PdfVerificationService();
    await completePythonEnvironment(startupProcess);

    const resultPromise = service.verifyPdfDocumentFromBuffer(Buffer.from('%PDF-test'));
    await flushPromises();
    verificationProcess.emit('close', 7);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('code 7');
    expect(verificationProcess.kill).not.toHaveBeenCalled();
  });

  it('bounds Python environment startup with the same process timeout', async () => {
    jest.useFakeTimers();
    process.env.PDF_VERIFICATION_TIMEOUT_MS = '25';
    const startupProcess = createFakeChildProcess();
    mockSpawn.mockReturnValueOnce(startupProcess);

    new PdfVerificationService();
    jest.advanceTimersByTime(25);
    await flushPromises();

    expect(startupProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
