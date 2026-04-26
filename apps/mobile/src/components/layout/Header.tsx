// Header component - top bar with hamburger menu and profile button
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize } from '../../theme';
import { Avatar } from '../common';
import { useDrawer } from '../../contexts/DrawerContext';
import { useProfile } from '../../hooks/useProfile';

interface HeaderProps {
  title?: string;
}

export function Header({ title = 'Family Check-In' }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const { toggleSidebar, toggleProfileMenu } = useDrawer();
  const { profile } = useProfile();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* Hamburger Menu */}
      <Pressable onPress={toggleSidebar} style={styles.iconButton}>
        <Text style={styles.hamburger}>☰</Text>
      </Pressable>

      {/* Title */}
      <Text style={styles.title}>{title}</Text>

      {/* Profile Button */}
      <Pressable onPress={toggleProfileMenu} style={styles.profileButton}>
        <Avatar name={profile?.full_name || ''} size="sm" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburger: {
    fontSize: 24,
    color: colors.text,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  profileButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
