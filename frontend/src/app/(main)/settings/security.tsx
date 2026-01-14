// Security settings screen - biometric authentication toggle
import { View, Text, StyleSheet, Switch, Alert, ActivityIndicator } from 'react-native';
import { useState, useEffect, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { ScreenHeader } from '../../../components/common';
import { useAuth } from '../../../hooks/useAuth';
import {
  getBiometricStatus,
  getBiometricName,
  enableBiometric,
  disableBiometric,
  authenticateWithBiometric,
  BiometricStatus,
} from '../../../services/biometric';

export default function SecurityScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState<BiometricStatus | null>(null);

  const loadBiometricStatus = useCallback(async () => {
    try {
      const status = await getBiometricStatus();
      setBiometricStatus(status);
    } catch (error) {
      console.error('Error loading biometric status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBiometricStatus();
  }, [loadBiometricStatus]);

  const handleToggleBiometric = async (value: boolean) => {
    if (!user?.id || toggling) return;

    setToggling(true);

    try {
      if (value) {
        // Enabling biometric - authenticate first to confirm
        const authResult = await authenticateWithBiometric(
          `Enable ${getBiometricName(biometricStatus?.biometricType || 'none')} login`
        );

        if (!authResult.success) {
          Alert.alert('Authentication Failed', authResult.error || 'Could not verify your identity');
          setToggling(false);
          return;
        }

        const success = await enableBiometric(user.id);
        if (success) {
          setBiometricStatus(prev => prev ? { ...prev, isEnabled: true } : null);
          Alert.alert('Success', `${getBiometricName(biometricStatus?.biometricType || 'none')} login enabled`);
        } else {
          Alert.alert('Error', 'Could not enable biometric login');
        }
      } else {
        // Disabling biometric
        const success = await disableBiometric();
        if (success) {
          setBiometricStatus(prev => prev ? { ...prev, isEnabled: false } : null);
          Alert.alert('Success', 'Biometric login disabled');
        } else {
          Alert.alert('Error', 'Could not disable biometric login');
        }
      }
    } catch (error) {
      console.error('Error toggling biometric:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setToggling(false);
    }
  };

  const biometricName = getBiometricName(biometricStatus?.biometricType || 'none');
  const canUseBiometric = biometricStatus?.isAvailable && biometricStatus?.isEnrolled;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Security" showBack />

      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            {/* Biometric Section */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Biometric Login</Text>
              <Text style={styles.sectionDescription}>
                Use {biometricName} to quickly and securely log in to the app.
              </Text>

              {!biometricStatus?.isAvailable && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningIcon}>!</Text>
                  <Text style={styles.warningText}>
                    Biometric authentication is not available on this device.
                  </Text>
                </View>
              )}

              {biometricStatus?.isAvailable && !biometricStatus?.isEnrolled && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningIcon}>!</Text>
                  <Text style={styles.warningText}>
                    No {biometricName.toLowerCase()} enrolled. Please set up {biometricName} in your device settings first.
                  </Text>
                </View>
              )}

              {canUseBiometric && (
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Text style={styles.settingIcon}>
                      {biometricStatus?.biometricType === 'facial' ? '👤' : '👆'}
                    </Text>
                    <View>
                      <Text style={styles.settingLabel}>Enable {biometricName}</Text>
                      <Text style={styles.settingHint}>
                        {biometricStatus?.isEnabled ? 'Tap to disable' : 'Tap to enable'}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    value={biometricStatus?.isEnabled || false}
                    onValueChange={handleToggleBiometric}
                    disabled={toggling}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.background}
                  />
                </View>
              )}
            </View>

            {/* Additional Security Info */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Security Info</Text>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device Support</Text>
                <Text style={[styles.infoValue, { color: biometricStatus?.isAvailable ? colors.success : colors.error }]}>
                  {biometricStatus?.isAvailable ? 'Supported' : 'Not Supported'}
                </Text>
              </View>

              {biometricStatus?.isAvailable && (
                <>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Biometric Type</Text>
                    <Text style={styles.infoValue}>{biometricName}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Enrollment Status</Text>
                    <Text style={[styles.infoValue, { color: biometricStatus?.isEnrolled ? colors.success : colors.warning }]}>
                      {biometricStatus?.isEnrolled ? 'Enrolled' : 'Not Enrolled'}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Security Tips */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Security Tips</Text>
              <View style={styles.tipsList}>
                <Text style={styles.tip}>• Keep your device passcode secure</Text>
                <Text style={styles.tip}>• Don't share your login credentials</Text>
                <Text style={styles.tip}>• Log out when using shared devices</Text>
                <Text style={styles.tip}>• Review connected devices regularly</Text>
              </View>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  sectionDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.warningLight || '#FFF3E0',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  warningIcon: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.warning,
  },
  warningText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.warning,
    lineHeight: 20,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  settingIcon: {
    fontSize: 24,
    width: 32,
    textAlign: 'center',
  },
  settingLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  settingHint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  tipsList: {
    gap: spacing.xs,
  },
  tip: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
