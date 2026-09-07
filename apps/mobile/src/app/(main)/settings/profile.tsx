// Profile settings screen
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { Avatar } from '../../../components/common';
import { TextInput, Button } from '../../../components/auth';
import { profileFormChanged, profileFormValues, useProfile } from '../../../hooks/useProfile';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, updateProfile, loading, error } = useProfile();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the form once the profile has actually arrived. Seeding at first render left the fields empty while
  // the profile loaded, and Save then wrote those empty values over the real name and phone (CB-033).
  useEffect(() => {
    const seeded = profileFormValues(profile);
    if (!seeded) {
      return;
    }
    setFullName(seeded.fullName);
    setPhone(seeded.phone);
  }, [profile]);

  const hasChanges = profileFormChanged(profile, { fullName, phone });

  const handleSave = async () => {
    if (!hasChanges) {
      return;
    }

    setIsSaving(true);
    setSaved(false);
    const updated = await updateProfile({ full_name: fullName.trim(), phone: phone.trim() });
    setIsSaving(false);
    setSaved(updated);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Back Button */}
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </Pressable>

      <Text style={styles.title}>Profile</Text>

      {/* Avatar Section — "Change photo" is gone: nothing ever uploaded one (CB-033). */}
      <View style={styles.avatarSection}>
        <Avatar name={fullName || profile?.full_name || ''} size="lg" />
      </View>

      {loading && !profile ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <View style={styles.form}>
          {error ? <Text style={styles.errorText}>{error.message}</Text> : null}

          <TextInput
            label="Full Name"
            placeholder="Your name"
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              setSaved(false);
            }}
            autoCapitalize="words"
          />

          <TextInput
            label="Phone Number"
            placeholder="+1 234 567 8900"
            value={phone}
            onChangeText={(value) => {
              setPhone(value);
              setSaved(false);
            }}
            keyboardType="phone-pad"
          />

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Your phone number is used for SMS and voice call escalations, and for the code that confirms sensitive
              changes.
            </Text>
          </View>

          {saved ? <Text style={styles.savedText}>Profile saved.</Text> : null}

          {/* Always rendered, disabled until something actually changed, so the control never vanishes (CB-033). */}
          <Button title="Save Changes" onPress={handleSave} loading={isSaving} disabled={!hasChanges} />
        </View>
      )}
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
  loadingContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
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
  errorText: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  savedText: {
    fontSize: fontSize.sm,
    color: colors.success,
  },
});
