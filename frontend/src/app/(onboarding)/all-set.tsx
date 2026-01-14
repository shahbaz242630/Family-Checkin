// All Set screen - Step 5 (Completion)
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { useOnboarding } from '../../contexts/OnboardingContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { supabase } from '../../services';
import { StepProgress } from '../../components/onboarding';
import { TRIAL_DAYS, getRelationshipLabel, CHECKIN_FREQUENCIES, TIME_OF_DAY, WAIT_TIMES } from '../../data/constants';
import { getTimezone } from '../../data/timezones';

export default function AllSetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, resetOnboarding } = useOnboarding();
  const { user } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

  // Calculate trial end date
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + TRIAL_DAYS);

  // Get display values
  const lovedOneTimezone = getTimezone(data.lovedOne.timezone);
  const frequency = CHECKIN_FREQUENCIES.find((f) => f.value === data.schedule.frequency);
  const timeOfDay = TIME_OF_DAY.find((t) => t.value === data.schedule.timeOfDay);
  const waitTime = WAIT_TIMES.find((w) => w.value === data.escalation.waitTime);

  const handleStartCheckins = async () => {
    if (!user?.id) return;

    setIsLoading(true);

    try {
      // 1. Update user profile
      const { error: profileError } = await supabase.from('users').upsert({
        id: user.id,
        full_name: data.profile.fullName,
        phone: `${data.profile.countryCode}${data.profile.phone}`,
        timezone: data.profile.timezone,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      });

      if (profileError) throw profileError;

      // 2. Create loved one profile
      const { data: lovedOne, error: lovedOneError } = await supabase
        .from('loved_one_profiles')
        .insert({
          owner_user_id: user.id,
          name: data.lovedOne.name,
          phone: `${data.lovedOne.countryCode}${data.lovedOne.phone}`,
          timezone: data.lovedOne.timezone,
        })
        .select()
        .single();

      if (lovedOneError) throw lovedOneError;

      // 3. Create relationship
      const { data: relationship, error: relationshipError } = await supabase
        .from('relationships')
        .insert({
          owner_user_id: user.id,
          loved_one_id: lovedOne.id,
          relationship_type: data.lovedOne.relationship,
          status: 'active',
        })
        .select()
        .single();

      if (relationshipError) throw relationshipError;

      // 4. Create check-in schedule
      const { error: scheduleError } = await supabase.from('checkin_schedules').insert({
        relationship_id: relationship.id,
        frequency: data.schedule.frequency,
        preferred_time: data.schedule.specificTime,
        notification_method: data.schedule.method,
        is_active: true,
      });

      if (scheduleError) throw scheduleError;

      // 5. Create escalation plan
      const waitMinutes = WAIT_TIMES.find((w) => w.value === data.escalation.waitTime)?.minutes || 60;

      const { error: escalationError } = await supabase.from('escalation_plans').insert({
        relationship_id: relationship.id,
        escalation_delay_minutes: waitMinutes,
        notify_owner: data.escalation.action === 'notify_me' || data.escalation.action === 'both',
        notify_emergency_contact: data.escalation.action === 'call_emergency' || data.escalation.action === 'both',
        is_active: true,
      });

      if (escalationError) throw escalationError;

      // 6. Create emergency contact if needed
      if (
        (data.escalation.action === 'call_emergency' || data.escalation.action === 'both') &&
        data.escalation.emergencyContact.phone
      ) {
        await supabase.from('contact_points').insert({
          owner_user_id: user.id,
          contact_type: 'emergency',
          contact_name: data.escalation.emergencyContact.name,
          contact_value: `${data.escalation.emergencyContact.countryCode}${data.escalation.emergencyContact.phone}`,
          is_primary: true,
        });
      }

      // 7. Create trial subscription
      await supabase.from('subscriptions').insert({
        user_id: user.id,
        plan_type: 'trial',
        status: 'active',
        trial_ends_at: trialEndDate.toISOString(),
      });

      // Reset onboarding context and navigate to main app
      resetOnboarding();
      router.replace('/(main)/dashboard');
    } catch (error) {
      console.error('Error completing onboarding:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StepProgress currentStep={5} totalSteps={5} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Success Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>🎉</Text>
        </View>

        <Text style={styles.title}>You're all set!</Text>
        <Text style={styles.subtitle}>Here's a summary of your setup</Text>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          {/* Your Profile */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>Your Profile</Text>
            <Text style={styles.summaryValue}>{data.profile.fullName}</Text>
            <Text style={styles.summarySubvalue}>
              {data.profile.countryCode} {data.profile.phone}
            </Text>
          </View>

          <View style={styles.divider} />

          {/* Loved One */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>Checking in on</Text>
            <Text style={styles.summaryValue}>
              {data.lovedOne.name} ({getRelationshipLabel(data.lovedOne.relationship)})
            </Text>
            <Text style={styles.summarySubvalue}>{lovedOneTimezone?.label}</Text>
          </View>

          <View style={styles.divider} />

          {/* Schedule */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>Check-in Schedule</Text>
            <Text style={styles.summaryValue}>
              {frequency?.label} • {timeOfDay?.label}
            </Text>
            <Text style={styles.summarySubvalue}>via {data.schedule.method.toUpperCase()}</Text>
          </View>

          <View style={styles.divider} />

          {/* Safety Net */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryLabel}>Safety Net</Text>
            <Text style={styles.summaryValue}>Wait {waitTime?.label} before escalating</Text>
            {data.escalation.emergencyContact.name && (
              <Text style={styles.summarySubvalue}>
                Emergency: {data.escalation.emergencyContact.name}
              </Text>
            )}
          </View>
        </View>

        {/* Trial Badge */}
        <View style={styles.trialBadge}>
          <Text style={styles.trialIcon}>🎁</Text>
          <View>
            <Text style={styles.trialText}>Your trial ends on</Text>
            <Text style={styles.trialDate}>
              {trialEndDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Start Button */}
      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          style={styles.startButton}
          onPress={handleStartCheckins}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.startButtonText}>Start Checking In</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  iconContainer: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    fontSize: fontSize.xxl || 28,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summarySection: {
    paddingVertical: spacing.sm,
  },
  summaryLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  summarySubvalue: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '15',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  trialIcon: {
    fontSize: 32,
  },
  trialText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  trialDate: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.primary,
  },
  bottomContainer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  startButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md + 4,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
