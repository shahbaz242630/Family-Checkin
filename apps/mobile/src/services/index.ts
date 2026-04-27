export { supabase, getCurrentUser, getSession } from './supabase';
export type { Database } from './database.types';
export {
  createReceiver,
  getReceiver,
  listReceivers,
  pauseReceiver,
  resumeReceiver,
  syncAuthenticatedUser,
  updateReceiver,
  type BackendChannel,
  type BackendCheckInStatus,
  type BackendConsentStatus,
  type BackendReceiverDetail,
  type BackendReceiverSummary,
  type BackendRelationshipType,
  type BackendTechProfile,
  type CreatedReceiver,
  type ReceiverSetupInput,
  type ReceiverUpdateInput,
  type SyncedBackendUser,
} from './backendApi';
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
