// Biometric authentication service (Face ID / Fingerprint)
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
const BIOMETRIC_USER_ID_KEY = 'biometric_user_id';

export type BiometricType = 'fingerprint' | 'facial' | 'iris' | 'none';

export interface BiometricStatus {
  isAvailable: boolean;
  isEnrolled: boolean;
  biometricType: BiometricType;
  isEnabled: boolean;
}

/**
 * Check if device supports biometric authentication
 */
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    return compatible;
  } catch (error) {
    console.error('Error checking biometric availability:', error);
    return false;
  }
}

/**
 * Check if user has enrolled biometrics on device
 */
export async function isBiometricEnrolled(): Promise<boolean> {
  try {
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return enrolled;
  } catch (error) {
    console.error('Error checking biometric enrollment:', error);
    return false;
  }
}

/**
 * Get the type of biometric available
 */
export async function getBiometricType(): Promise<BiometricType> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();

    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'facial';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'fingerprint';
    }
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      return 'iris';
    }
    return 'none';
  } catch (error) {
    console.error('Error getting biometric type:', error);
    return 'none';
  }
}

/**
 * Get friendly name for biometric type
 */
export function getBiometricName(type: BiometricType): string {
  switch (type) {
    case 'facial':
      return 'Face ID';
    case 'fingerprint':
      return 'Fingerprint';
    case 'iris':
      return 'Iris Scanner';
    default:
      return 'Biometric';
  }
}

/**
 * Check if biometric login is enabled for the app
 */
export async function isBiometricEnabled(): Promise<boolean> {
  try {
    const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
    return enabled === 'true';
  } catch (error) {
    console.error('Error checking biometric enabled status:', error);
    return false;
  }
}

/**
 * Enable biometric login for a user
 */
export async function enableBiometric(userId: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, 'true');
    await SecureStore.setItemAsync(BIOMETRIC_USER_ID_KEY, userId);
    return true;
  } catch (error) {
    console.error('Error enabling biometric:', error);
    return false;
  }
}

/**
 * Disable biometric login
 */
export async function disableBiometric(): Promise<boolean> {
  try {
    await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
    await SecureStore.deleteItemAsync(BIOMETRIC_USER_ID_KEY);
    return true;
  } catch (error) {
    console.error('Error disabling biometric:', error);
    return false;
  }
}

/**
 * Get the user ID associated with biometric login
 */
export async function getBiometricUserId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(BIOMETRIC_USER_ID_KEY);
  } catch (error) {
    console.error('Error getting biometric user ID:', error);
    return null;
  }
}

/**
 * Authenticate using biometrics
 */
export async function authenticateWithBiometric(
  promptMessage: string = 'Authenticate to continue'
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check availability first
    const available = await isBiometricAvailable();
    if (!available) {
      return { success: false, error: 'Biometric authentication not available on this device' };
    }

    // Check enrollment
    const enrolled = await isBiometricEnrolled();
    if (!enrolled) {
      return { success: false, error: 'No biometrics enrolled on this device' };
    }

    // Perform authentication
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    if (result.success) {
      return { success: true };
    }

    // Handle different error types
    if (result.error === 'user_cancel') {
      return { success: false, error: 'Authentication cancelled' };
    }
    if (result.error === 'user_fallback') {
      return { success: false, error: 'User chose to use passcode' };
    }
    if (result.error === 'lockout') {
      return { success: false, error: 'Too many attempts. Try again later.' };
    }

    return { success: false, error: result.error || 'Authentication failed' };
  } catch (error) {
    console.error('Biometric authentication error:', error);
    return { success: false, error: 'An error occurred during authentication' };
  }
}

/**
 * Get full biometric status
 */
export async function getBiometricStatus(): Promise<BiometricStatus> {
  const [isAvailable, isEnrolled, biometricType, isEnabled] = await Promise.all([
    isBiometricAvailable(),
    isBiometricEnrolled(),
    getBiometricType(),
    isBiometricEnabled(),
  ]);

  return {
    isAvailable,
    isEnrolled,
    biometricType,
    isEnabled,
  };
}
