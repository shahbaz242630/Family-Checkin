// MenuItem component - for sidebar and profile menu items
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface MenuItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
}

export function MenuItem({
  icon,
  label,
  onPress,
  isActive = false,
  showChevron = false,
  rightElement,
}: MenuItemProps) {
  return (
    <Pressable
      style={[styles.container, isActive && styles.containerActive]}
      onPress={onPress}
    >
      <View style={styles.left}>
        <Text style={[styles.icon, isActive && styles.iconActive]}>{icon}</Text>
        <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
      </View>
      <View style={styles.right}>
        {rightElement}
        {showChevron && <Text style={styles.chevron}>›</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  containerActive: {
    backgroundColor: colors.primary + '15',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  icon: {
    fontSize: fontSize.lg,
    width: 24,
    textAlign: 'center',
  },
  iconActive: {
    color: colors.primary,
  },
  label: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  chevron: {
    fontSize: fontSize.lg,
    color: colors.textLight,
  },
});
