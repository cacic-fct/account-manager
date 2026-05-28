import { Controller, Get, Session, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { CsrfService } from './csrf.service';
import { SkipCsrf } from './csrf.guard';

interface CsrfSession {
  csrfToken?: string;
  [key: string]: any;
}

/**
 * Controller for CSRF token management
 */
@ApiTags('Security')
@Controller('csrf')
export class CsrfController {
  constructor(private readonly csrfService: CsrfService) {}

  /**
   * Endpoint to get or generate a CSRF token
   * This endpoint is exempt from CSRF validation as it's used to obtain the token
   */
  @ApiOperation({
    summary: 'Get CSRF token',
    description:
      'Returns a CSRF token for the current session. This token must be included in state-changing requests.',
  })
  @ApiResponse({
    status: 200,
    description: 'CSRF token returned successfully',
    schema: {
      type: 'object',
      properties: {
        csrfToken: {
          type: 'string',
          example: 'a1b2c3d4e5f6...',
        },
      },
    },
  })
  @SkipCsrf()
  @Get('token')
  getToken(@Session() session: CsrfSession, @Res() res: Response) {
    // Generate new token if one doesn't exist or regenerate for additional security
    if (!session.csrfToken) {
      session.csrfToken = this.csrfService.generateToken();
    }

    // Set token in cookie as well for double-submit pattern
    res.cookie('XSRF-TOKEN', session.csrfToken, {
      httpOnly: false, // Allow JavaScript to read for sending in headers
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict', // Strict for CSRF cookie
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({ csrfToken: session.csrfToken });
  }
}
