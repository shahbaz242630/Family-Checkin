// Sidebar component - left drawer menu with check-in features
import { View, Text, Pressable, StyleSheet, Modal, Animated } from 'react-native';
import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { MenuItem } from '../common';
import { useDrawer } from '../../contexts/DrawerContext';

const MENU_ITEMS = [
  { icon: '🏠', label: 'Dashboard', path: '/(main)' },
  { icon: '👨‍👩‍👧‍👦', label: 'Loved Ones', path: '/(main)/loved-ones' },
  { icon: '✓', label: 'Check-ins', path: '/(main)/check-ins' },
  { icon: '🔔', label: 'Escalations', path: '/(main)/escalations' },
  { icon: '🔗', label: 'Add Loved One', path: '/(main)/pairing' },
];

export function Sidebar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { isSidebarOpen, closeSidebar } = useDrawer();
  const slideAnim = useRef(new Animated.Value(-300)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isSidebarOpen ? 0 : -300,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isSidebarOpen, slideAnim]);

  const handleNavigate = (path: string) => {
    closeSidebar();
    router.push(path as any);
  };

  const isActive = (path: string) => {
    if (path === '/(main)') return pathname === '/(main)' || pathname === '/';
    return pathname.startsWith(path);
  };

  return (
    <Modal
      visible={isSidebarOpen}
      transparent
      animationType="none"
      onRequestClose={closeSidebar}
    >
      {/* Backdrop */}
      <Pressable style={styles.backdrop} onPress={closeSidebar} />

      {/* Sidebar Content */}
      <Animated.View
        style={[
          styles.sidebar,
          { paddingTop: insets.top + spacing.md, transform: [{ translateX: slideAnim }] },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>Family Check-In</Text>
        </View>

        {/* Menu Items */}
        <View style={styles.menu}>
          {MENU_ITEMS.map((item) => (
            <MenuItem
              key={item.path}
              icon={item.icon}
              label={item.label}
              onPress={() => handleNavigate(item.path)}
              isActive={isActive(item.path)}
            />
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.version}>Version 1.0.0</Text>
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
  sidebar: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 280,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  header: {
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  logo: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.primary,
  },
  menu: {
    flex: 1,
    gap: spacing.xs,
  },
  footer: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  version: {
    fontSize: fontSize.xs,
    color: colors.textLight,
    textAlign: 'center',
  },
});
