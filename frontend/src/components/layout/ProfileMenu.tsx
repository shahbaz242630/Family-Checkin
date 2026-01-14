// ProfileMenu component - right side profile dropdown/modal
import { View, Text, Pressable, StyleSheet, Modal, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { Avatar, MenuItem } from '../common';
import { useDrawer } from '../../contexts/DrawerContext';
import { useProfile } from '../../hooks/useProfile';
import { useAuth } from '../../hooks/useAuth';

const PROFILE_MENU_ITEMS = [
  { icon: '👤', label: 'Profile', path: '/(main)/settings/profile' },
  { icon: '💳', label: 'Billing', path: '/(main)/settings/billing' },
  { icon: '🎨', label: 'Appearance', path: '/(main)/settings/appearance' },
  { icon: '🌐', label: 'Language', path: '/(main)/settings/language' },
];

export function ProfileMenu() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isProfileMenuOpen, closeProfileMenu } = useDrawer();
  const { profile } = useProfile();
  const { signOut } = useAuth();
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isProfileMenuOpen ? 0 : 300,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isProfileMenuOpen, slideAnim]);

  const handleNavigate = (path: string) => {
    closeProfileMenu();
    router.push(path as any);
  };

  const handleSignOut = async () => {
    closeProfileMenu();
    await signOut();
    router.replace('/(auth)/welcome');
  };

  return (
    <Modal
      visible={isProfileMenuOpen}
      transparent
      animationType="none"
      onRequestClose={closeProfileMenu}
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={closeProfileMenu} />

      {/* Menu Content */}
      <Animated.View
        style={[
          styles.menu,
          { paddingTop: insets.top + spacing.md, transform: [{ translateX: slideAnim }] },
        ]}
      >
        {/* Profile Header */}
        <View style={styles.header}>
          <Avatar name={profile?.full_name || ''} size="lg" />
          <Text style={styles.name}>{profile?.full_name || 'Set up profile'}</Text>
          <Text style={styles.email}>{profile?.phone || 'Add phone number'}</Text>
        </View>

        {/* Menu Items */}
        <View style={styles.items}>
          {PROFILE_MENU_ITEMS.map((item) => (
            <MenuItem
              key={item.path}
              icon={item.icon}
              label={item.label}
              onPress={() => handleNavigate(item.path)}
              showChevron
            />
          ))}
        </View>

        {/* Logout */}
        <View style={styles.footer}>
          <Pressable style={styles.logoutButton} onPress={handleSignOut}>
            <Text style={styles.logoutIcon}>🚪</Text>
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menu: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 300,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
  },
  email: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  items: {
    flex: 1,
    gap: spacing.xs,
  },
  footer: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  logoutIcon: {
    fontSize: fontSize.lg,
    width: 24,
    textAlign: 'center',
  },
  logoutText: {
    fontSize: fontSize.md,
    color: colors.error,
    fontWeight: '500',
  },
});
