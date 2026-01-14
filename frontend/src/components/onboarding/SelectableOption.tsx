// Selectable option component for single/multi select
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface SelectableOptionProps {
  label: string;
  description?: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function SelectableOption({
  label,
  description,
  icon,
  selected,
  onPress,
  disabled = false,
}: SelectableOptionProps) {
  return (
    <Pressable
      style={[
        styles.container,
        selected && styles.containerSelected,
        disabled && styles.containerDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {icon && <Text style={styles.icon}>{icon}</Text>}
      <View style={styles.textContainer}>
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
        {description && (
          <Text style={[styles.description, selected && styles.descriptionSelected]}>
            {description}
          </Text>
        )}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    gap: spacing.md,
  },
  containerSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '08',
  },
  containerDisabled: {
    opacity: 0.5,
  },
  icon: {
    fontSize: 24,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  labelSelected: {
    color: colors.primary,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  descriptionSelected: {
    color: colors.primary + 'AA',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
});
