export interface TotpStatus {
  configured: boolean;
  algorithm: 'SHA512';
  digits: 6;
  periodSeconds: 30;
  serverTime: Date | string;
  createdAt?: Date | string;
  rotatedAt?: Date | string;
}

export interface TotpSeed {
  userId: string;
  primaryEmail: string;
  seed: string;
  algorithm: 'SHA512';
  digits: 6;
  periodSeconds: 30;
  serverTime: Date | string;
}
