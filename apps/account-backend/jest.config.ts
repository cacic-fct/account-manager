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
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
    '!src/**/*.module.ts',
    '!src/**/interfaces/**/*.ts',
    '!src/**/interfaces.ts',
    '!src/main.ts',
  ],
  coverageReporters: ['json', 'lcov', 'text', 'clover'],
};
