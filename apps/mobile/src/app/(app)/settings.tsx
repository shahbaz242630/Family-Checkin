import { View, Text, StyleSheet, ScrollView, Pressable, Switch } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

export default function SettingsScreen() {
  const [largeText, setLargeText] = useState(false);
  const [notifications, setNotifications] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection title="Account">
          <SettingsItem label="Edit Profile" onPress={() => {}} />
          <SettingsItem label="Subscription" value="Free Plan" onPress={() => {}} />
          <SettingsItem label="Language" value="English" onPress={() => {}} />
        </SettingsSection>

        <SettingsSection title="Check-In Settings">
          <SettingsItem label="Default Check-In Time" value="9:00 AM" onPress={() => {}} />
          <SettingsItem label="Timezone" value="Asia/Dubai" onPress={() => {}} />
          <SettingsItem label="Escalation Rules" onPress={() => {}} />
        </SettingsSection>

        <SettingsSection title="Accessibility">
          <SettingsToggle
            label="Large Text Mode"
            description="Increase text size for easier reading"
            value={largeText}
            onValueChange={setLargeText}
          />
          <SettingsToggle
            label="Push Notifications"
            description="Receive check-in reminders"
            value={notifications}
            onValueChange={setNotifications}
          />
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsItem label="Privacy Policy" onPress={() => {}} />
          <SettingsItem label="Terms of Service" onPress={() => {}} />
          <SettingsItem label="App Version" value="1.0.0" />
        </SettingsSection>

        <Pressable style={styles.logoutButton}>
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function SettingsItem({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.item} onPress={onPress} disabled={!onPress}>
      <Text style={styles.itemLabel}>{label}</Text>
      <View style={styles.itemRight}>
        {value && <Text style={styles.itemValue}>{value}</Text>}
        {onPress && <Text style={styles.itemArrow}>→</Text>}
      </View>
    </Pressable>
  );
}

function SettingsToggle({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleItem}>
      <View style={styles.toggleText}>
        <Text style={styles.itemLabel}>{label}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primaryLight }}
        thumbColor={value ? colors.primary : colors.textLight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  sectionContent: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  itemLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemValue: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  itemArrow: {
    fontSize: fontSize.md,
    color: colors.textLight,
  },
  toggleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  toggleText: {
    flex: 1,
    marginRight: spacing.md,
  },
  toggleDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  logoutButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  logoutButtonText: {
    fontSize: fontSize.md,
    color: colors.error,
    fontWeight: '500',
  },
});
