import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { PdfVerificationResult } from '../dto/student-verification.dto';

@Injectable()
export class PdfVerificationService {
  private readonly logger = new Logger(PdfVerificationService.name);
  private pythonPath: string | null = null;
  private pythonEnvReady = false;
  private readonly scriptsPath = path.join(process.cwd(), 'scripts');
  private readonly processTimeoutMs = this.readPositiveInteger(process.env.PDF_VERIFICATION_TIMEOUT_MS, 15_000);
  private readonly maxOutputBytes = 1024 * 1024;

  constructor() {
    void this.initializePythonEnvironment();
  }

  private async initializePythonEnvironment(): Promise<void> {
    try {
      const stdout = await this.runPythonProcess('python3', [this.getScriptPath('check_python_env.py')]);
      const result = JSON.parse(stdout) as {
        success: boolean;
        python_path?: string;
        error?: string;
      };

      if (result.success && result.python_path) {
        this.pythonPath = result.python_path;
        this.pythonEnvReady = true;
        this.logger.log('Python environment initialized successfully');
      } else {
        this.logger.error(`Failed to initialize Python environment: ${result.error || 'Unknown error'}`);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Error initializing Python environment: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async ensurePythonEnvironment(): Promise<string> {
    if (this.pythonEnvReady && this.pythonPath) {
      return this.pythonPath;
    }

    await this.initializePythonEnvironment();

    if (!this.pythonEnvReady || !this.pythonPath) {
      throw new Error('Python environment is not available for PDF verification');
    }

    return this.pythonPath;
  }

  async verifyPdfDocument(filePath: string): Promise<PdfVerificationResult> {
    try {
      const pythonPath = await this.ensurePythonEnvironment();
      const stdout = await this.runPythonProcess(pythonPath, [this.getScriptPath('verify_pdf.py'), filePath]);
      return JSON.parse(stdout) as PdfVerificationResult;
    } catch (error: unknown) {
      return this.failureResult(error);
    }
  }

  async verifyPdfDocumentFromBuffer(pdfBuffer: Buffer): Promise<PdfVerificationResult> {
    try {
      const pythonPath = await this.ensurePythonEnvironment();
      const stdout = await this.runPythonProcess(pythonPath, [this.getScriptPath('verify_pdf_buffer.py')], pdfBuffer);
      return JSON.parse(stdout) as PdfVerificationResult;
    } catch (error: unknown) {
      return this.failureResult(error);
    }
  }

  private runPythonProcess(executable: string, args: string[], stdin?: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const stdoutChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const terminate = (message: string): void => {
        child.kill('SIGKILL');
        settle(() => reject(new Error(message)));
      };
      const timeout = setTimeout(() => terminate('PDF verification timed out'), this.processTimeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stdoutBytes += buffer.length;
        if (stdoutBytes > this.maxOutputBytes) {
          terminate('PDF verification output exceeded the allowed size');
          return;
        }
        stdoutChunks.push(buffer);
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (stderrBytes > this.maxOutputBytes) {
          terminate('PDF verification error output exceeded the allowed size');
        }
      });

      child.on('error', (error: Error) => settle(() => reject(error)));
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          settle(() => reject(new Error(`Python process exited with code ${code ?? 'unknown'}`)));
          return;
        }
        settle(() => resolve(Buffer.concat(stdoutChunks).toString('utf8')));
      });

      if (stdin) {
        child.stdin.end(stdin);
      } else {
        child.stdin.end();
      }
    });
  }

  private failureResult(error: unknown): PdfVerificationResult {
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(`PDF verification failed: ${message}`);
    return {
      success: false,
      error: `Failed to verify PDF: ${message}`,
    };
  }

  private getScriptPath(scriptName: string): string {
    return path.join(this.scriptsPath, scriptName);
  }

  private readPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
