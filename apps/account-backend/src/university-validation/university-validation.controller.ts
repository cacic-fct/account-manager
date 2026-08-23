import {
  Body,
  Controller,
  Post,
  Session,
  Param,
  Logger,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  InternalServerErrorException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  HttpStatus,
  HttpException,
  UseGuards,
  ServiceUnavailableException,
  ParseUUIDPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { UniversityValidationService } from './university-validation.service';
import { AtomicValidationDto, CaptchaSession, RefreshCaptchaDto } from './university-validation.types';
import { UserService } from '../auth/services/user.service';
import { KeycloakService } from '../auth/services/keycloak.service';
import { AuthSession } from '../auth/auth.controller';
import { CaptchaService } from './services/captcha.service';
import { Auth, UniversityValidation } from '../auth/guards/auth.decorator';
import { CsrfGuard } from '../auth/csrf/csrf.guard';
import { FileValidationService } from '../auth/services/file-validation.service';
import { StudentVerificationService } from '../student-verification/student-verification.service';
import { ExternalVerificationUnavailableError } from './services/external-verification-resilience.service';
import { randomUUID } from 'crypto';
import { UniversityVerificationRateLimitService } from './services/university-verification-rate-limit.service';

type LoggedRequest = Request<Record<string, string>, unknown, unknown>;

const MAX_PDF_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;
const PDF_UPLOAD_OPTIONS = {
  limits: {
    fileSize: MAX_PDF_UPLOAD_FILE_SIZE,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (file.mimetype !== 'application/pdf') {
      callback(new BadRequestException('Tipo de arquivo não permitido. Envie um PDF.'), false);
      return;
    }

    callback(null, true);
  },
};

// Simple request logging interceptor
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('RequestLoggingInterceptor');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<LoggedRequest>();
    const { method, url, body, headers } = request;

    this.logger.debug(`=== INCOMING HTTP REQUEST ===`);
    this.logger.debug(`${method} ${url}`);
    this.logger.debug(`Headers:`, {
      'content-type': headers['content-type'],
      'content-length': headers['content-length'],
      'user-agent': headers['user-agent'],
    });
    this.logger.debug(`Body metadata:`, {
      bodyType: typeof body,
      bodyKeys: body && typeof body === 'object' ? Object.keys(body) : 'not object',
    });

    return next.handle().pipe(tap(() => this.logger.debug(`Request completed successfully`)));
  }
}

@ApiTags('university-validation')
@Controller('university-validation')
export class UniversityValidationController {
  private readonly logger = new Logger(UniversityValidationController.name);

  constructor(
    private readonly universityValidationService: UniversityValidationService,
    private readonly userService: UserService,
    private readonly captchaService: CaptchaService,
    private readonly keycloakService: KeycloakService,
    private readonly fileValidationService: FileValidationService,
    private readonly studentVerificationService: StudentVerificationService,
    private readonly universityVerificationRateLimit: UniversityVerificationRateLimitService,
  ) {}

  private async queueManualFallback(file: Express.Multer.File, userId: string): Promise<never> {
    const result = await this.studentVerificationService.uploadDocument(file, userId, true);
    throw new BadRequestException({
      message:
        'A validação automática está temporariamente indisponível. Seu documento foi enviado para análise manual.',
      fallbackToManual: true,
      manualApprovalId: result.documentId,
    });
  }

  @UniversityValidation()
  @UseGuards(CsrfGuard)
  @Post('captcha')
  @UseInterceptors(FileInterceptor('pdfFile', PDF_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload PDF file to extract authCode and get captcha',
    type: 'multipart/form-data',
    schema: {
      type: 'object',
      properties: {
        pdfFile: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload PDF and get captcha for university validation',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF processed and captcha obtained successfully',
    schema: {
      type: 'object',
      properties: {
        captchaImage: { type: 'string' },
        sessionId: { type: 'string' },
        authCode: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - University role verification already completed',
  })
  async getCaptcha(
    @Session() session: AuthSession & { universityValidationId?: string },
    @UploadedFile() pdfFile?: Express.Multer.File,
  ): Promise<{
    captchaImage: string;
    sessionId: string;
    enrollmentNumber?: string;
  }> {
    if (!pdfFile) {
      throw new BadRequestException('PDF file is required');
    }

    this.fileValidationService.validateFile(pdfFile);

    // AuthGuard ensures user is authenticated
    const userId = session.user?.keycloakId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    await this.universityVerificationRateLimit.consumeCaptchaRequest(userId);

    // Check cooldown before processing captcha request
    const cooldownStatus = await this.captchaService.isUserInCooldown(userId);
    if (cooldownStatus.inCooldown) {
      throw new BadRequestException(
        `Aguarde ${cooldownStatus.remainingSeconds} segundos antes de solicitar um novo captcha`,
      );
    }

    // Get current user's enrollment number
    let enrollmentNumber: string | undefined;

    try {
      // Check if user is authenticated
      if (session.user?.keycloakId) {
        const userProfile = await this.userService.findById(session.user.keycloakId);
        enrollmentNumber = userProfile?.enrollmentNumber;
        this.logger.debug('Retrieved enrollment status for authenticated user', {
          hasEnrollmentNumber: !!enrollmentNumber,
        });
      } else {
        this.logger.warn('No authenticated user found in session');
      }
    } catch (error) {
      this.logger.error('Error retrieving user enrollment number:', error);
      throw new ServiceUnavailableException('Não foi possível consultar o perfil acadêmico. Tente novamente.');
    }

    // Extract authCode from PDF
    const authCode = await this.universityValidationService.extractAuthCodeFromPdf(pdfFile.buffer);

    if (!authCode || !/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/i.test(authCode)) {
      throw new BadRequestException(
        'Código de autenticidade não encontrado no PDF. Verifique se o documento é válido e contém um código de autenticidade.',
      );
    }

    // Extract enrollment number from PDF
    const pdfEnrollmentNumber = await this.universityValidationService.extractEnrollmentFromPdf(pdfFile.buffer);

    // Use PDF enrollment if available, otherwise fall back to user's enrollment
    const sessionEnrollmentNumber = pdfEnrollmentNumber || enrollmentNumber;

    const sessionId =
      session.universityValidationId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.universityValidationId)
        ? session.universityValidationId
        : randomUUID();
    session.universityValidationId = sessionId;

    let captchaSession: CaptchaSession;
    try {
      captchaSession = await this.universityValidationService.getCaptcha(
        sessionId,
        userId,
        authCode,
        sessionEnrollmentNumber,
      );
    } catch (error) {
      if (error instanceof ExternalVerificationUnavailableError) {
        return await this.queueManualFallback(pdfFile, userId);
      }
      throw error;
    }

    // Record captcha request attempt to start cooldown for next request
    await this.captchaService.recordCaptchaRequest(userId);

    if (!captchaSession.captchaImageBase64) {
      throw new InternalServerErrorException('Não foi possível obter a imagem do captcha');
    }

    return {
      captchaImage: captchaSession.captchaImageBase64,
      sessionId: captchaSession.sessionId,
      enrollmentNumber,
    };
  }

  @Auth()
  @UseGuards(CsrfGuard)
  @Post('clear-session/:sessionId')
  @ApiOperation({ summary: 'Limpar sessão de validação' })
  @ApiResponse({
    status: 200,
    description: 'Sessão limpa com sucesso',
    type: Object,
  })
  async clearSession(
    @Session() session: AuthSession & { universityValidationId?: string },
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) paramSessionId: string,
  ): Promise<{ success: boolean }> {
    // AuthGuard ensures user is authenticated
    const userId = session.user?.keycloakId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    await this.universityValidationService.clearSession(paramSessionId, userId);
    if (session.universityValidationId === paramSessionId) {
      delete session.universityValidationId;
    }
    return { success: true };
  }

  @UniversityValidation()
  @UseGuards(CsrfGuard)
  @Post('cooldown-status')
  @ApiOperation({ summary: 'Get captcha cooldown status for current user' })
  @ApiResponse({
    status: 200,
    description: 'Cooldown status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        inCooldown: { type: 'boolean' },
        remainingSeconds: { type: 'number' },
        attempts: { type: 'number' },
        nextCooldownSeconds: { type: 'number' },
      },
    },
  })
  async getCooldownStatus(@Session() session: AuthSession): Promise<{
    inCooldown: boolean;
    remainingSeconds: number;
    attempts: number;
    nextCooldownSeconds: number;
  }> {
    // AuthGuard ensures user is authenticated
    const userId = session.user?.keycloakId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    return this.captchaService.getCooldownStatus(userId);
  }

  @UniversityValidation()
  @UseGuards(CsrfGuard)
  @Post('validate-atomic')
  @ApiOperation({
    summary: 'Atomic validation - get captcha and validate in one flow',
    description: 'This endpoint handles captcha and validation atomically to avoid server-side session issues',
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result or captcha for user input',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        isValid: { type: 'boolean' },
        captchaImage: { type: 'string' },
        needsCaptcha: { type: 'boolean' },
        error: { type: 'string' },
        pdfUrl: { type: 'string' },
      },
    },
  })
  async validateAtomic(
    @Body() body: AtomicValidationDto,
    @Session() session: AuthSession,
  ): Promise<{
    success: boolean;
    valid?: boolean;
    isValid?: boolean;
    captchaImage?: string;
    needsCaptcha?: boolean;
    error?: string;
    message?: string;
    pdfUrl?: string;
    fallbackToManual?: boolean;
    manualApprovalId?: string;
  }> {
    // AuthGuard ensures user is authenticated
    const userId = session.user?.keycloakId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    try {
      await this.universityVerificationRateLimit.consumeValidationAttempt(userId, body.sessionId);

      const validationCooldown = await this.captchaService.isUserInCooldown(userId);
      if (validationCooldown.inCooldown) {
        throw new HttpException(
          `Aguarde ${validationCooldown.remainingSeconds} segundos antes de tentar novamente`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      // Consume the attempt synchronously before any external I/O. This closes
      // the direct-POST and concurrent-request bypass of the frontend cooldown.
      await this.captchaService.recordCaptchaRequest(userId);

      const user = await this.userService.findById(userId);
      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // CRITICAL: Always fetch fresh user attributes from Keycloak to avoid caching issues
      // This ensures validation uses the most up-to-date enrollment number
      this.logger.debug('Fetching fresh user attributes from Keycloak to avoid cache');
      let freshAttributes: Record<string, string[]>;
      try {
        freshAttributes = await this.keycloakService.getUserAttributes(userId);
      } catch (error) {
        this.logger.error('Unable to retrieve fresh Keycloak attributes for validation', error);
        throw new ServiceUnavailableException('Não foi possível consultar o perfil acadêmico. Tente novamente.');
      }
      const enrollmentNumber = freshAttributes.enrollmentNumber?.[0];

      this.logger.debug('Fresh enrollment number from Keycloak:', {
        hasEnrollmentNumber: !!enrollmentNumber,
        source: 'keycloak_fresh_fetch',
        cacheMismatch: user.enrollmentNumber !== enrollmentNumber,
      });

      // Ensure we have an enrollment number
      if (!enrollmentNumber) {
        throw new UnprocessableEntityException('Número de matrícula não encontrado no perfil do usuário');
      }

      this.logger.debug('About to call validateDocument with stored session:', {
        captchaCodeLength: body.captchaCode.length,
        hasEnrollmentNumber: !!enrollmentNumber,
      });

      // validateDocument uses the stored session with cookies from captcha generation
      // and retrieves the auth code internally from the session
      const result = await this.universityValidationService.validateDocument(
        body.sessionId,
        enrollmentNumber, // Now guaranteed to be defined
        body.captchaCode,
        userId,
      );

      // Handle cooldown based on validation result
      if (result.success && result.isValid) {
        // Success: clear cooldown
        await this.captchaService.recordSuccessfulAttempt(userId);
      }

      // Transform the result to match the expected response format
      return {
        success: result.success,
        valid: result.isValid,
        isValid: result.isValid,
        error: result.error,
        message: result.error, // Use error as message for consistency
        needsCaptcha: result.needsNewCaptcha,
        pdfUrl: result.pdfUrl,
        fallbackToManual: result.fallbackToManual,
        manualApprovalId: result.manualApprovalId,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Atomic validation failed', error instanceof Error ? error.message : String(error));
      throw new InternalServerErrorException('Erro interno do servidor');
    }
  }

  @UniversityValidation()
  @UseGuards(CsrfGuard)
  @Post('atomic-captcha')
  @UseInterceptors(FileInterceptor('pdfFile', PDF_UPLOAD_OPTIONS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload PDF file to extract authCode and get initial captcha for atomic flow',
    type: 'multipart/form-data',
    schema: {
      type: 'object',
      properties: {
        pdfFile: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Get captcha for atomic validation flow',
    description: 'Processes PDF to extract auth code and returns initial captcha image',
  })
  @ApiResponse({
    status: 200,
    description: 'PDF processed and captcha obtained for atomic flow',
    schema: {
      type: 'object',
      properties: {
        authCode: { type: 'string' },
        captchaImage: { type: 'string' },
        sessionId: { type: 'string' },
      },
    },
  })
  async getAtomicCaptcha(
    @Session() userSession: AuthSession,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ captchaImage: string; sessionId: string }> {
    try {
      if (!file) {
        throw new BadRequestException('Arquivo PDF é obrigatório');
      }

      this.fileValidationService.validateFile(file);

      // AuthGuard ensures user is authenticated
      const userId = userSession.user?.keycloakId;
      if (!userId) {
        throw new BadRequestException('User authentication required');
      }

      await this.universityVerificationRateLimit.consumeCaptchaRequest(userId);

      // Check cooldown before processing captcha request
      const cooldownStatus = await this.captchaService.isUserInCooldown(userId);
      if (cooldownStatus.inCooldown) {
        throw new BadRequestException(
          `Aguarde ${cooldownStatus.remainingSeconds} segundos antes de solicitar um novo captcha`,
        );
      }

      // Extract auth code from PDF
      const authCode = await this.universityValidationService.extractAuthCodeFromPdf(file.buffer);

      // Extract enrollment number from PDF
      const enrollmentNumber = await this.universityValidationService.extractEnrollmentFromPdf(file.buffer);

      if (!authCode || !/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/i.test(authCode)) {
        throw new BadRequestException(
          'Código de autenticação não encontrado no arquivo PDF. Verifique se o arquivo é um comprovante de matrícula válido.',
        );
      }

      // Generate a session ID
      const sessionId = randomUUID();

      // Get captcha and create session with both auth code and enrollment
      const session = await this.universityValidationService.getCaptcha(
        sessionId,
        userId,
        authCode,
        enrollmentNumber || undefined,
      );

      if (!session.captchaImageBase64) {
        throw new InternalServerErrorException('Não foi possível obter a imagem do captcha');
      }

      // Record captcha request attempt to start cooldown for next request
      await this.captchaService.recordCaptchaRequest(userId);

      return {
        captchaImage: `data:image/jpeg;base64,${session.captchaImageBase64}`,
        sessionId: sessionId,
      };
    } catch (error) {
      this.logger.error('Error in atomic captcha', error instanceof Error ? error.message : String(error));

      if (error instanceof ExternalVerificationUnavailableError) {
        const userId = userSession.user?.keycloakId;
        if (!userId) {
          throw new BadRequestException('User authentication required');
        }
        return await this.queueManualFallback(file, userId);
      }

      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException('Erro ao processar arquivo PDF');
    }
  }

  @UniversityValidation()
  @UseGuards(CsrfGuard)
  @Post('refresh-captcha')
  @ApiOperation({ summary: 'Get a new captcha for existing session' })
  @ApiBody({
    description: 'Session ID to refresh captcha for',
    type: 'object',
    schema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session ID from previous captcha request',
        },
      },
      required: ['sessionId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'New captcha generated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid session or cooldown active',
  })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async refreshCaptcha(
    @Body() body: RefreshCaptchaDto,
    @Session() session: AuthSession,
  ): Promise<{ captchaImage: string; sessionId: string }> {
    // AuthGuard ensures user is authenticated
    const userId = session.user?.keycloakId;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    const { sessionId } = body;

    if (!sessionId) {
      throw new BadRequestException('SessionId is required');
    }

    this.logger.debug('Refreshing university captcha');

    await this.universityVerificationRateLimit.consumeCaptchaRequest(userId);

    // Check if user is in cooldown period
    const cooldownStatus = await this.captchaService.isUserInCooldown(userId);
    if (cooldownStatus.inCooldown) {
      throw new BadRequestException(
        `Aguarde ${cooldownStatus.remainingSeconds} segundos antes de solicitar um novo captcha`,
      );
    }

    try {
      // Get a new captcha for the existing session
      const newSession = await this.universityValidationService.refreshCaptcha(sessionId, userId);

      if (!newSession.captchaImageBase64) {
        throw new InternalServerErrorException('Não foi possível obter a nova imagem do captcha');
      }

      // Record captcha request attempt to start cooldown for next request
      await this.captchaService.recordCaptchaRequest(userId);

      return {
        captchaImage: `data:image/jpeg;base64,${newSession.captchaImageBase64}`,
        sessionId: sessionId,
      };
    } catch (error) {
      this.logger.error('Error refreshing captcha', error instanceof Error ? error.message : String(error));

      if (error instanceof ExternalVerificationUnavailableError) {
        this.logger.warn('Network error during captcha refresh');

        throw new ServiceUnavailableException({
          message: 'Erro de conexão com o servidor da universidade durante a atualização do captcha.',
          isNetworkError: true,
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Erro ao atualizar captcha');
    }
  }
}
