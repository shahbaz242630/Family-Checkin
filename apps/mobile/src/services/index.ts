export { supabase, getCurrentUser, getSession } from './supabase';
export type { Database } from './database.types';
export {
  exportUserData,
  downloadUserData,
  deleteUserDataOnly,
  deleteUserAccount,
} from './userData';
export {
  isBiometricAvailable,
  isBiometricEnrolled,
  getBiometricType,
  getBiometricName,
  isBiometricEnabled,
  enableBiometric,
  disableBiometric,
  getBiometricUserId,
  authenticateWithBiometric,
  getBiometricStatus,
} from './biometric';
export type { BiometricType, BiometricStatus } from './biometric';
