// Expo's recommended flat config (React, React Native, hooks, import rules).
import expoConfig from 'eslint-config-expo/flat.js';

export default [
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
      'android/**',
      'ios/**',
      'coverage/**',
      'expo-env.d.ts',
    ],
  },
  ...expoConfig,
];
