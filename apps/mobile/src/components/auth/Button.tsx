// Primary button component for auth forms
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'text';
}

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      style={[
        styles.button,
        variant === 'primary' && styles.primaryButton,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'text' && styles.textButton,
        isDisabled && variant === 'primary' && styles.primaryDisabled,
        isDisabled && variant === 'secondary' && styles.secondaryDisabled,
      ]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.textOnPrimary : colors.primary}
        />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'primary' && styles.primaryText,
            variant === 'secondary' && styles.secondaryText,
            variant === 'text' && styles.textButtonText,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
    minHeight: 50,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  primaryDisabled: {
    backgroundColor: colors.disabled,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  secondaryDisabled: {
    borderColor: colors.disabled,
  },
  textButton: {
    backgroundColor: 'transparent',
  },
  text: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  primaryText: {
    color: colors.textOnPrimary,
  },
  secondaryText: {
    color: colors.primary,
  },
  textButtonText: {
    color: colors.primary,
  },
});
