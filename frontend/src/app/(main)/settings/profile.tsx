// Profile settings screen
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { Avatar } from '../../../components/common';
import { TextInput, Button } from '../../../components/auth';
import { useProfile } from '../../../hooks/useProfile';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, updateProfile, loading } = useProfile();

  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await updateProfile({ full_name: fullName, phone });
    setIsSaving(false);
  };

  const hasChanges =
    fullName !== (profile?.full_name || '') || phone !== (profile?.phone || '');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back Button */}
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Profile</Text>

      {/* Avatar Section */}
      <View style={styles.avatarSection}>
        <Avatar name={fullName || profile?.full_name || ''} size="lg" />
        <Pressable style={styles.changeAvatarButton}>
          <Text style={styles.changeAvatarText}>Change photo</Text>
        </Pressable>
      </View>

      {/* Form */}
      <View style={styles.form}>
        <TextInput
          label="Full Name"
          placeholder="Your name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        <TextInput
          label="Phone Number"
          placeholder="+1 234 567 8900"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Your phone number is used for SMS and voice call escalations
          </Text>
        </View>

        {hasChanges && (
          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={isSaving}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  backButton: {
    marginBottom: spacing.lg,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: fontSize.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.xl,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  changeAvatarButton: {
    marginTop: spacing.md,
  },
  changeAvatarText: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  form: {
    gap: spacing.md,
  },
  infoBox: {
    backgroundColor: colors.primary + '10',
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  infoText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});
