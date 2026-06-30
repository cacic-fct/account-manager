export interface Environment {
  production: boolean;
  apiUrl: string;
  sentryDsn?: string;
  sentryEnvironment?: string;
}

export const environment: Environment = {
  production: true,
  apiUrl: '/api',
};
