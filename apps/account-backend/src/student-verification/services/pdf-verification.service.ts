import { Injectable, Logger } from '@nestjs/common';
import { PdfVerificationResult } from '../dto/student-verification.dto';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

@Injectable()
export class PdfVerificationService {
  private readonly logger = new Logger(PdfVerificationService.name);
  private pythonPath: string | null = null;
  private pythonEnvReady = false;
  private readonly scriptsPath = path.join(process.cwd(), 'scripts');

  constructor() {
    // Initialize Python environment asynchronously
    this.initializePythonEnvironment().catch((error) => {
      this.logger.error(
        `Failed to initialize Python environment: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }

  private async initializePythonEnvironment(): Promise<void> {
    try {
      const scriptPath = this.getScriptPath('check_python_env.py');
      const { stdout } = await execAsync(`python3 "${scriptPath}"`);
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
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async ensurePythonEnvironment(): Promise<string> {
    if (this.pythonEnvReady && this.pythonPath) {
      return this.pythonPath;
    }

    // Try to initialize again
    await this.initializePythonEnvironment();

    if (!this.pythonEnvReady || !this.pythonPath) {
      throw new Error('Python environment is not available for PDF verification');
    }

    return this.pythonPath;
  }

  async verifyPdfDocument(filePath: string): Promise<PdfVerificationResult> {
    try {
      // Ensure Python environment is ready
      const pythonPath = await this.ensurePythonEnvironment();

      const scriptPath = this.getScriptPath('verify_pdf.py');
      const { stdout, stderr } = await execAsync(`"${pythonPath}" "${scriptPath}" "${filePath}"`);

      if (stderr) {
        this.logger.warn(`Python script stderr: ${stderr}`);
      }

      const result = JSON.parse(stdout) as PdfVerificationResult;
      return result;
    } catch (error: unknown) {
      this.logger.error(
        `Error executing Python script: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        success: false,
        error: `Failed to verify PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async verifyPdfDocumentFromBuffer(pdfBuffer: Buffer): Promise<PdfVerificationResult> {
    try {
      // Ensure Python environment is ready
      const pythonPath = await this.ensurePythonEnvironment();

      const scriptPath = this.getScriptPath('verify_pdf_buffer.py');

      return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonPath, [scriptPath]);
        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        pythonProcess.on('close', (code: number) => {
          if (code !== 0) {
            this.logger.error(`Python buffer verification process exited with code ${code}. stderr: ${stderr}`);
            reject(new Error(`Python process exited with code ${code}. stderr: ${stderr}`));
            return;
          }

          try {
            const result = JSON.parse(stdout) as PdfVerificationResult;
            resolve(result);
          } catch (parseError) {
            const message = parseError instanceof Error ? parseError.message : String(parseError);
            this.logger.error(`Failed to parse Python script output: ${message}`);
            reject(new Error(`Failed to parse Python script output: ${message}`));
          }
        });

        pythonProcess.on('error', (error: Error) => {
          this.logger.error(`Failed to start Python process: ${error.message}`, error.stack);
          reject(new Error(`Failed to start Python process: ${error.message}`));
        });

        // Send PDF buffer to Python script via stdin
        pythonProcess.stdin.write(pdfBuffer);
        pythonProcess.stdin.end();
      });
    } catch (error: unknown) {
      this.logger.error(
        `Error executing Python script with buffer: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        success: false,
        error: `Failed to verify PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private getScriptPath(scriptName: string): string {
    return path.join(this.scriptsPath, scriptName);
  }
}
