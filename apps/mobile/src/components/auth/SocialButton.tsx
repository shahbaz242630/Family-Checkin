// Social login button component
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface SocialButtonProps {
  provider: 'google' | 'apple';
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  mode?: 'signin' | 'signup';
}

const PROVIDER_CONFIG = {
  google: {
    icon: 'G',
    label: 'Google',
    iconColor: '#4285F4',
  },
  apple: {
    icon: '',
    label: 'Apple',
    iconColor: '#000000',
  },
};

export function SocialButton({
  provider,
  onPress,
  loading = false,
  disabled = false,
  mode = 'signin',
}: SocialButtonProps) {
  const config = PROVIDER_CONFIG[provider];
  const actionText = mode === 'signin' ? 'Continue with' : 'Sign up with';

  return (
    <Pressable
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <>
          <Text style={[styles.icon, { color: config.iconColor }]}>
            {config.icon}
          </Text>
          <Text style={styles.label}>
            {actionText} {config.label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  icon: {
    fontSize: fontSize.lg,
    fontWeight: 'bold',
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
});
