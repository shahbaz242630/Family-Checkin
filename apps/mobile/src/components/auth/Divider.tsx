// Divider with text (e.g., "or continue with email")
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize } from '../../theme';

interface DividerProps {
  text: string;
}

export function Divider({ text }: DividerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.line} />
      <Text style={styles.text}>{text}</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  text: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
