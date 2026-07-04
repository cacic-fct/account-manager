import {
  Controller,
  Post,
  Get,
  Patch,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  Res,
  Session,
  BadRequestException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { StudentVerificationService } from './student-verification.service';
import { UploadResponseDto, VerificationStatusDto, UpdateVerificationStatusDto } from './dto/student-verification.dto';
import { SessionUser } from '../auth/interfaces/auth.interface';
import { AccountPermissions, Auth, UniversityValidation } from '../auth/guards/auth.decorator';
import { AccountManagerPermission } from '@cacic/shared-types';
import { FileValidationService } from '../auth/services/file-validation.service';
import { CsrfGuard, SkipCsrf } from '../auth/csrf/csrf.guard';

interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  destroy: (callback: (err?: Error) => void) => void;
}

const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME_TYPES = new Set(['application/pdf']);

const studentVerificationUploadOptions = {
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimeTypes = new Set(ALLOWED_DOCUMENT_MIME_TYPES);

    if (process.env.NODE_ENV === 'development') {
      allowedMimeTypes.add('text/plain');
    }

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(
        new BadRequestException(
          `Tipo de arquivo não permitido. Tipos aceitos: ${Array.from(allowedMimeTypes).join(', ')}`,
        ),
        false,
      );
      return;
    }

    callback(null, true);
  },
};

@ApiTags('student-verification')
@Controller('student-verification')
export class StudentVerificationController {
  private readonly logger = new Logger(StudentVerificationController.name);

  constructor(
    private readonly studentVerificationService: StudentVerificationService,
    private readonly fileValidationService: FileValidationService,
  ) {}

  @UniversityValidation()
  @UseGuards(CsrfGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('document', studentVerificationUploadOptions))
  @ApiOperation({
    summary: 'Upload document for student verification',
    description:
      'Upload a PDF document for verification. Requires authentication and university role verification must not be completed.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Document file to upload',
    schema: {
      type: 'object',
      properties: {
        document: {
          type: 'string',
          format: 'binary',
          description: 'Document file (PDF, up to 10MB)',
        },
        isManualFallback: {
          type: 'boolean',
          description: 'Enable manual fallback (development only)',
          default: false,
        },
      },
      example: {
        document: '<binary PDF file>',
        isManualFallback: false,
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Document uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        documentId: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
        authenticationCode: { type: 'string' },
        extractedName: { type: 'string' },
      },
      example: {
        message: 'Document uploaded successfully',
        documentId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        status: 'pending',
        authenticationCode: 'ABC123456',
        extractedName: 'Maria Silva',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid file or file validation failed',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Authentication required',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - University role verification already completed',
  })
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Session() session: AuthSession,
    @Body() body?: { isManualFallback?: boolean },
  ): Promise<UploadResponseDto> {
    // File validation is now handled by the guard, but we still validate here for completeness
    if (!file) {
      throw new BadRequestException('Nenhum arquivo foi enviado.');
    }

    // Only allow manual fallback from frontend in development mode
    const isManualFallback = process.env.NODE_ENV === 'development' && (body?.isManualFallback || false);

    // Validate file using the security service
    this.fileValidationService.validateFile(file, isManualFallback);

    return this.studentVerificationService.uploadDocument(
      file,
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      isManualFallback,
    );
  }

  @Auth()
  @SkipCsrf()
  @Get('status')
  @ApiOperation({
    summary: 'Get verification status',
    description: 'Get the verification status for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification status retrieved successfully',
    type: VerificationStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Authentication required',
  })
  async getVerificationStatus(@Session() session: AuthSession): Promise<VerificationStatusDto> {
    return this.studentVerificationService.getVerificationStatus(
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
    );
  }

  @AccountPermissions([AccountManagerPermission.StudentVerificationRead])
  @SkipCsrf()
  @Get('admin/pending')
  @ApiOperation({
    summary: 'Get all pending verification documents (Admin only)',
    description: 'Retrieve all documents pending verification. Requires admin privileges.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pending documents retrieved successfully',
    type: [VerificationStatusDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Authentication required',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin privileges required',
  })
  async getAllPendingDocuments() {
    return this.studentVerificationService.getAllPendingDocuments();
  }

  @AccountPermissions([AccountManagerPermission.StudentVerificationReview])
  @UseGuards(CsrfGuard)
  @Patch('admin/:documentId/verify')
  @ApiOperation({
    summary: 'Update document verification status (Admin only)',
    description: 'Update the verification status of a document. Requires admin privileges.',
  })
  @ApiParam({
    name: 'documentId',
    description: 'UUID of the document to update',
    type: 'string',
  })
  @ApiBody({
    type: UpdateVerificationStatusDto,
    description: 'New verification status and optional reason',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification status updated successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Authentication required',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin privileges required',
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async updateVerificationStatus(
    @Param('documentId') documentId: string,
    @Body() updateDto: UpdateVerificationStatusDto,
    @Session() session: AuthSession,
  ) {
    return this.studentVerificationService.updateVerificationStatus(
      documentId,
      updateDto,
      session.user!.email, // Safe to use ! because AuthGuard ensures user exists
    );
  }

  @AccountPermissions([AccountManagerPermission.StudentVerificationDownload])
  @Get('admin/:documentId/download')
  @ApiOperation({
    summary: 'Download verification document (Admin only)',
    description: 'Download a verification document file. Requires admin privileges.',
  })
  @ApiParam({
    name: 'documentId',
    description: 'UUID of the document to download',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Document downloaded successfully',
    headers: {
      'Content-Type': {
        description: 'MIME type of the document',
        schema: { type: 'string' },
      },
      'Content-Disposition': {
        description: 'Attachment filename',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Authentication required',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin privileges required',
  })
  @ApiResponse({
    status: 404,
    description: 'Document not found',
  })
  async downloadDocument(@Param('documentId') documentId: string, @Res() res: Response) {
    const document = await this.studentVerificationService.getDocumentFile(documentId);

    // Properly encode filename for UTF-8 support (handles accents)
    const encodedFilename = encodeURIComponent(document.originalFileName);
    const asciiFilename = document.originalFileName.replace(/[^\u0020-\u007E]/g, ''); // ASCII fallback

    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    );

    // Stream the file from S3
    document.stream.pipe(res);

    document.stream.on('error', (error) => {
      this.logger.error(
        `Error streaming file for document ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao baixar o arquivo' });
      }
    });
  }
}
