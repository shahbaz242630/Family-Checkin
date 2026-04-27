import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize } from '../../theme';

interface ScreenHeaderProps {
  title: string;
  showBack?: boolean;
}

export function ScreenHeader({ title, showBack = false }: ScreenHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {showBack ? (
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      ) : (
        <View style={styles.backButton} />
      )}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backButton: {
    minWidth: 56,
  },
  backText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
});
