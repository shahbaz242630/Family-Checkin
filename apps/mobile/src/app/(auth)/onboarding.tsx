import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, TextInput } from '../../components/auth';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import {
  createReceiver,
  type BackendChannel,
  type BackendRelationshipType,
  type BackendTechProfile,
  type ReceiverSetupInput,
} from '../../services';

const relationshipOptions: Array<{ value: BackendRelationshipType; label: string }> = [
  { value: 'PARENT', label: 'Parent' },
  { value: 'GRANDPARENT', label: 'Grandparent' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'CHILD', label: 'Child' },
  { value: 'FRIEND', label: 'Friend' },
  { value: 'OTHER', label: 'Other' },
];

const profileOptions: Array<{
  value: BackendTechProfile;
  label: string;
  primaryChannel: BackendChannel;
  fallbackChannels: BackendChannel[];
}> = [
  { value: 'WHATSAPP', label: 'WhatsApp first', primaryChannel: 'WHATSAPP', fallbackChannels: ['SMS', 'VOICE'] },
  { value: 'SMS', label: 'SMS first', primaryChannel: 'SMS', fallbackChannels: ['VOICE'] },
  { value: 'VOICE_ONLY', label: 'Voice only', primaryChannel: 'VOICE', fallbackChannels: [] },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('AE');
  const [phoneCountry, setPhoneCountry] = useState('AE');
  const [relationshipType, setRelationshipType] = useState<BackendRelationshipType>('PARENT');
  const [language, setLanguage] = useState('en');
  const [timezone, setTimezone] = useState('Asia/Dubai');
  const [techProfile, setTechProfile] = useState<BackendTechProfile>('WHATSAPP');
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('11:00');
  const [personalNote, setPersonalNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedProfile = profileOptions.find((option) => option.value === techProfile) ?? profileOptions[0];

  const handleSubmit = async () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Missing details', 'Receiver name and phone are required.');
      return;
    }

    if (!selectedProfile) {
      Alert.alert('Missing channel', 'Choose how we should reach this receiver.');
      return;
    }

    const payload: ReceiverSetupInput = {
      name: name.trim(),
      phone: phone.trim(),
      phoneCountry: phoneCountry.trim().toUpperCase(),
      countryCode: countryCode.trim().toUpperCase(),
      relationshipType,
      language: language.trim(),
      timezone: timezone.trim(),
      techProfile,
      primaryChannel: selectedProfile.primaryChannel,
      fallbackChannels: selectedProfile.fallbackChannels,
      scheduleFrequency: 'daily',
      scheduleTimeWindow: {
        start: windowStart.trim(),
        end: windowEnd.trim(),
      },
      personalNote: personalNote.trim() || undefined,
    };

    setIsSubmitting(true);
    try {
      await createReceiver(payload);
      router.replace('/(main)');
    } catch (err) {
      Alert.alert('Unable to add receiver', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.title}>Add receiver</Text>
            <Text style={styles.subtitle}>Consent will be requested before any check-ins begin.</Text>
          </View>

          <View style={styles.form}>
            <TextInput label="Receiver name" placeholder="Fatima Parent" value={name} onChangeText={setName} />
            <TextInput
              label="Receiver phone"
              placeholder="+971501234567"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextInput label="Phone country" placeholder="AE" value={phoneCountry} onChangeText={setPhoneCountry} />
              </View>
              <View style={styles.rowItem}>
                <TextInput label="Receiver country" placeholder="AE" value={countryCode} onChangeText={setCountryCode} />
              </View>
            </View>

            <View>
              <Text style={styles.fieldLabel}>Relationship</Text>
              <View style={styles.optionGrid}>
                {relationshipOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.option, relationshipType === option.value && styles.optionSelected]}
                    onPress={() => setRelationshipType(option.value)}
                  >
                    <Text style={[styles.optionText, relationshipType === option.value && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View>
              <Text style={styles.fieldLabel}>Best channel</Text>
              <View style={styles.optionStack}>
                {profileOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[styles.optionWide, techProfile === option.value && styles.optionSelected]}
                    onPress={() => setTechProfile(option.value)}
                  >
                    <Text style={[styles.optionText, techProfile === option.value && styles.optionTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextInput label="Language" placeholder="en" value={language} onChangeText={setLanguage} />
              </View>
              <View style={styles.rowItem}>
                <TextInput label="Timezone" placeholder="Asia/Dubai" value={timezone} onChangeText={setTimezone} />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <TextInput label="From" placeholder="09:00" value={windowStart} onChangeText={setWindowStart} />
              </View>
              <View style={styles.rowItem}>
                <TextInput label="To" placeholder="11:00" value={windowEnd} onChangeText={setWindowEnd} />
              </View>
            </View>

            <TextInput
              label="Personal note"
              placeholder="Optional message for the consent request"
              value={personalNote}
              onChangeText={setPersonalNote}
            />

            <Button title="Send consent request" onPress={handleSubmit} loading={isSubmitting} disabled={isSubmitting} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  form: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowItem: {
    flex: 1,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionStack: {
    gap: spacing.sm,
  },
  option: {
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionWide: {
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  optionSelected: {
    backgroundColor: colors.primaryLight + '20',
    borderColor: colors.primary,
  },
  optionText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.primary,
  },
});
