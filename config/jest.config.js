const { compilerOptions } = require("../tsconfig.json");

module.exports = {
  rootDir: '../src',
  transform: {
    '.(ts|tsx)': 'ts-jest',
  },
  globals: {
    __DEV__: true,
    'ts-jest': {
      diagnostics: true,
      tsconfig: {
        ...compilerOptions,
        allowJs: true,
      },
    },
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  testURL: 'http://localhost',
  setupFiles: ['<rootDir>/config/jest/setup.ts'],
};
