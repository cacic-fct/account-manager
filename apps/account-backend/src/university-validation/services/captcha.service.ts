import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { CaptchaSession } from '../university-validation.types';
import { S3Service } from '../../common/services/s3.service';

interface UserCooldown {
  userId: string;
  attempts: number;
  lastAttemptTime: number;
  cooldownUntil: number;
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly baseUrl = 'https://sistemas.unesp.br';
  private readonly captchaUrl = `${this.baseUrl}/academico/captcha.jpg`;

  // Cooldown management
  private readonly userCooldowns = new Map<string, UserCooldown>();
  private readonly baseCooldownSeconds = 1; // 1^2 = 1 second initially

  constructor(private readonly s3Service: S3Service) {}

  /**
   * Check if user is in cooldown period
   */
  isUserInCooldown(userId: string): {
    inCooldown: boolean;
    remainingSeconds: number;
  } {
    const cooldown = this.userCooldowns.get(userId);
    if (!cooldown) {
      return { inCooldown: false, remainingSeconds: 0 };
    }

    const now = Date.now();
    if (now >= cooldown.cooldownUntil) {
      // Cooldown expired, but don't delete the user data yet
      // Keep the attempt history for progressive cooldown
      return { inCooldown: false, remainingSeconds: 0 };
    }

    const remainingMs = cooldown.cooldownUntil - now;
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    return { inCooldown: true, remainingSeconds };
  }

  /**
   * Record a failed captcha attempt and update cooldown
   */
  recordFailedAttempt(userId: string): { cooldownSeconds: number } {
    const now = Date.now();
    let cooldown = this.userCooldowns.get(userId);

    if (!cooldown) {
      cooldown = {
        userId,
        attempts: 0,
        lastAttemptTime: now,
        cooldownUntil: now,
      };
    } else {
      // If it's been more than 10 minutes since last attempt, reset attempts
      const timeSinceLastAttempt = now - cooldown.lastAttemptTime;
      const resetThreshold = 10 * 60 * 1000; // 10 minutes

      if (timeSinceLastAttempt > resetThreshold) {
        this.logger.debug('Resetting attempts due to inactivity', {
          userId,
          timeSinceLastAttempt: Math.round(timeSinceLastAttempt / 1000),
          resetThresholdSeconds: resetThreshold / 1000,
        });
        cooldown.attempts = 0;
      }
    }

    cooldown.attempts += 1;
    cooldown.lastAttemptTime = now;

    // Calculate exponential cooldown: attempts^2 seconds (1², 2², 3², etc.)
    const cooldownSeconds = Math.pow(cooldown.attempts, 2);
    cooldown.cooldownUntil = now + cooldownSeconds * 1000;

    this.userCooldowns.set(userId, cooldown);

    this.logger.debug('Recorded failed captcha attempt', {
      userId,
      attempts: cooldown.attempts,
      cooldownSeconds,
      cooldownUntil: new Date(cooldown.cooldownUntil).toISOString(),
    });

    return { cooldownSeconds };
  }

  /**
   * Record a captcha request attempt and update cooldown
   */
  recordCaptchaRequest(userId: string): { cooldownSeconds: number } {
    const now = Date.now();
    let cooldown = this.userCooldowns.get(userId);

    if (!cooldown) {
      cooldown = {
        userId,
        attempts: 0,
        lastAttemptTime: now,
        cooldownUntil: now,
      };
    } else {
      // If it's been more than 10 minutes since last attempt, reset attempts
      const timeSinceLastAttempt = now - cooldown.lastAttemptTime;
      const resetThreshold = 10 * 60 * 1000; // 10 minutes

      if (timeSinceLastAttempt > resetThreshold) {
        this.logger.debug('Resetting attempts due to inactivity', {
          userId,
          timeSinceLastAttempt: Math.round(timeSinceLastAttempt / 1000),
          resetThresholdSeconds: resetThreshold / 1000,
        });
        cooldown.attempts = 0;
      }
    }

    // For captcha requests, we increment attempts to prevent spam
    cooldown.attempts += 1;
    cooldown.lastAttemptTime = now;

    // Calculate exponential cooldown: attempts^2 seconds (1², 2², 3², etc.)
    const cooldownSeconds = Math.pow(cooldown.attempts, 2);
    cooldown.cooldownUntil = now + cooldownSeconds * 1000;

    this.userCooldowns.set(userId, cooldown);

    this.logger.debug('Recorded captcha request', {
      userId,
      attempts: cooldown.attempts,
      cooldownSeconds,
      cooldownUntil: new Date(cooldown.cooldownUntil).toISOString(),
    });

    return { cooldownSeconds };
  }

  /**
   * Record a successful captcha attempt and reset cooldown
   */
  recordSuccessfulAttempt(userId: string): void {
    this.userCooldowns.delete(userId);
    this.logger.debug('Cleared cooldown for successful captcha attempt', {
      userId,
    });
  }

  /**
   * Get current cooldown status for a user
   */
  getCooldownStatus(userId: string): {
    inCooldown: boolean;
    remainingSeconds: number;
    attempts: number;
    nextCooldownSeconds: number;
  } {
    const cooldownCheck = this.isUserInCooldown(userId);
    const cooldown = this.userCooldowns.get(userId);
    const attempts = cooldown?.attempts || 0;
    const nextCooldownSeconds = Math.pow(attempts + 1, 2);

    return {
      inCooldown: cooldownCheck.inCooldown,
      remainingSeconds: cooldownCheck.remainingSeconds,
      attempts,
      nextCooldownSeconds,
    };
  }

  /**
   * Save successful captcha input to training dataset in S3
   */
  async saveCaptchaTrainingData(
    captchaImageBase64: string,
    userInput: string,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const sanitizedTimestamp = timestamp.replace(/[:.]/g, '-');
      const randomId = Math.random().toString(36).substring(2, 8);
      const baseFilename = `captcha_${sanitizedTimestamp}_${randomId}`;

      // Create simplified training data JSON
      const trainingData = {
        solution: userInput,
        timestamp,
      };

      // Upload JSON metadata to S3
      const jsonKey = `captcha-training-data/${baseFilename}.json`;
      await this.s3Service.uploadFile(
        jsonKey,
        Buffer.from(JSON.stringify(trainingData, null, 2)),
        'application/json',
      );

      // Upload image file to S3
      const imageKey = `captcha-training-data/${baseFilename}.jpg`;
      const imageBuffer = Buffer.from(captchaImageBase64, 'base64');
      await this.s3Service.uploadFile(imageKey, imageBuffer, 'image/jpeg');

      this.logger.debug('Captcha training data saved successfully to S3', {
        jsonKey,
        imageKey,
        inputLength: userInput.length,
        imageSizeBytes: imageBuffer.length,
      });
    } catch (error) {
      // Don't throw error here as this is not critical for the main flow
      this.logger.error('Failed to save captcha training data to S3:', error);
    }
  }

  /**
   * Get captcha for the document validation process
   */
  async getCaptcha(
    sessionId: string,
    userId?: string,
  ): Promise<{
    success: boolean;
    data?: {
      captchaImageBase64: string;
      sessionToken: string;
    };
    sessionData?: CaptchaSession;
    error?: string;
    cooldown?: {
      inCooldown: boolean;
      remainingSeconds: number;
    };
  }> {
    this.logger.debug('Getting captcha for session:', sessionId);

    // Check cooldown if userId is provided
    if (userId) {
      const cooldownStatus = this.isUserInCooldown(userId);
      if (cooldownStatus.inCooldown) {
        return {
          success: false,
          error: `Please wait ${cooldownStatus.remainingSeconds} seconds before requesting a new captcha`,
          cooldown: cooldownStatus,
        };
      }
    }

    try {
      // Create a new cookie jar for this session
      const cookieJar = new CookieJar();
      const documentUrl = `${this.baseUrl}/academico/publico/documento.action`;

      // Create axios instance with cookie jar
      const axiosInstance = axios.create({
        timeout: 30000,
        validateStatus: () => true, // Don't throw on any status code
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      // Step 1: Access the document page to establish session
      this.logger.debug('Step 1: Accessing document page...');
      const documentResponse = await axiosInstance.get(documentUrl);

      if (documentResponse.status !== 200) {
        this.logger.error('Failed to access document page:', {
          status: documentResponse.status,
          statusText: documentResponse.statusText,
        });
        return {
          success: false,
          error: `Failed to access document page: ${documentResponse.status}`,
        };
      }

      // Create session data object to store form information
      const sessionData: CaptchaSession = {
        sessionId,
        cookieJar,
        createdAt: new Date(),
      };

      // Parse the document page HTML to extract form data
      const pageHtml = documentResponse.data as string;
      const $ = cheerio.load(pageHtml);

      // Extract hidden form inputs
      const hiddenInputs: Record<string, string> = {};
      $('input[type="hidden"]').each((_, element) => {
        const name = $(element).attr('name');
        const value = $(element).attr('value');
        if (name && value !== undefined) {
          hiddenInputs[name] = value;
        }
      });

      this.logger.debug('Extracted form data:', {
        hiddenInputsCount: Object.keys(hiddenInputs).length,
        hiddenInputKeys: Object.keys(hiddenInputs),
      });

      // Store form data in session
      sessionData.pageHtml = pageHtml;
      sessionData.hiddenInputs = hiddenInputs;
      sessionData.pageUrl = documentUrl;

      // Extract session cookies
      const setCookieHeaders = documentResponse.headers['set-cookie'];
      if (setCookieHeaders) {
        for (const cookie of setCookieHeaders) {
          try {
            await sessionData.cookieJar.setCookie(cookie, documentUrl);
          } catch (cookieError) {
            this.logger.debug('Failed to set cookie:', cookieError);
          }
        }
      }

      const initialCookies: string =
        await sessionData.cookieJar.getCookieString(documentUrl);

      this.logger.debug('Initial cookies established:', {
        cookieCount: setCookieHeaders?.length || 0,
        cookieString: initialCookies.substring(0, 100),
      });

      // Step 2: Get the captcha image
      this.logger.debug('Step 2: Fetching captcha image...');

      // Get cookies before captcha request
      const cookiesBeforeCaptcha: string =
        await sessionData.cookieJar.getCookieString(documentUrl);

      this.logger.debug('Cookies before captcha request:', {
        cookies: cookiesBeforeCaptcha,
      });

      const captchaResponse = await axiosInstance.get(this.captchaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Referer: documentUrl,
          Cookie: await sessionData.cookieJar.getCookieString(documentUrl),
        },
      });

      if (captchaResponse.status !== 200) {
        this.logger.error('Failed to fetch captcha:', {
          status: captchaResponse.status,
          statusText: captchaResponse.statusText,
        });
        return {
          success: false,
          error: `Failed to fetch captcha: ${captchaResponse.status}`,
        };
      }

      // Handle additional cookies from captcha response
      const captchaSetCookies = captchaResponse.headers['set-cookie'];
      if (captchaSetCookies) {
        for (const cookie of captchaSetCookies) {
          try {
            await sessionData.cookieJar.setCookie(cookie, documentUrl);
          } catch (cookieError) {
            this.logger.debug('Failed to set captcha cookie:', cookieError);
          }
        }
      }

      // Convert captcha image to base64
      const captchaBuffer = Buffer.from(captchaResponse.data);
      const captchaImageBase64 = captchaBuffer.toString('base64');

      this.logger.debug('Captcha fetched successfully:', {
        size: captchaBuffer.length,
        base64Length: captchaImageBase64.length,
      });

      // Extract session token (JSESSIONID)
      const cookiesAfterCaptcha: string =
        await sessionData.cookieJar.getCookieString(documentUrl);
      const sessionToken = this.extractJSESSIONID(cookiesAfterCaptcha);

      if (!sessionToken) {
        this.logger.warn('No JSESSIONID found in cookies after captcha');
      }

      // Update session data with captcha and session token
      sessionData.captchaImageBase64 = captchaImageBase64;
      sessionData.sessionToken = sessionToken || undefined;

      // Store session data - this should be done by the calling service
      // Note: The calling service will handle session storage via sessionManagementService
      this.logger.debug('Session data prepared with form fields and captcha', {
        sessionId,
        hasPageHtml: !!sessionData.pageHtml,
        hasHiddenInputs: !!sessionData.hiddenInputs,
        hiddenInputsCount: sessionData.hiddenInputs
          ? Object.keys(sessionData.hiddenInputs).length
          : 0,
        hasSessionToken: !!sessionData.sessionToken,
      });

      return {
        success: true,
        data: {
          captchaImageBase64,
          sessionToken: sessionToken || '',
        },
        sessionData, // Return the complete session data for storage
      };
    } catch (error) {
      this.logger.error('Error getting captcha:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        code:
          error instanceof AxiosError ? (error.code ?? 'UNKNOWN') : 'UNKNOWN',
        status:
          error instanceof AxiosError ? error.response?.status : undefined,
        statusText:
          error instanceof AxiosError ? error.response?.statusText : undefined,
        url: error instanceof AxiosError ? error.config?.url : undefined,
      });

      return {
        success: false,
        error: `Failed to get captcha: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Extract JSESSIONID from cookie string
   */
  private extractJSESSIONID(cookieString: string): string | null {
    if (!cookieString) {
      return null;
    }
    const match = cookieString.match(/JSESSIONID=([^;]+)/);
    return match ? match[1] : null;
  }
}
