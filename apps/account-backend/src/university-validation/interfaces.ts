export interface CaptchaResponse {
  captchaImage: string; // Base64 encoded image
  sessionId: string;
}

export interface ValidationRequest {
  authCode: string;
  captchaCode: string;
  enrollmentNumber?: string;
}

export interface ValidationResponse {
  success: boolean;
  valid?: boolean;
  message?: string;
  needsNewCaptcha?: boolean;
}
