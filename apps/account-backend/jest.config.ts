export default {
  displayName: 'account-backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/account-backend',
  collectCoverageFrom: [
    'src/app.controller.ts',
    'src/auth/account-linking/account-linking.controller.ts',
    'src/auth/guards/discord-admin.guard.ts',
    'src/auth/guards/university-validation.guard.ts',
    'src/auth/services/account-permission.service.ts',
    'src/discord/services/discord-role-management.service.ts',
    'src/feature-flags/feature-flags.service.ts',
    'src/student-verification/services/admin-operations.service.ts',
    'src/student-verification/services/document-management.service.ts',
    'src/student-verification/services/document-upload.service.ts',
    'src/student-verification/services/status-management.service.ts',
  ],
};
