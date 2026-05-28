export interface Environment {
  production: boolean;
  apiUrl: string;
}

export const environment: Environment = {
  production: false,
  // In development, use '/api' to leverage proxy.conf.json
  // Proxy rewrites /api/* to http://localhost:3000/*
  apiUrl: 'http://localhost:3000/api',
};
