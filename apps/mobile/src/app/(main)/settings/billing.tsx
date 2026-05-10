import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthContext } from '../../../contexts/AuthContext';
import { colors, spacing, fontSize, borderRadius } from '../../../theme';
import { getBillingStatus, syncAuthenticatedUser, type BackendBillingStatus } from '../../../services/backendApi';
import {
  getRevenueCatPlanOptions,
  purchaseRevenueCatPackage,
  restoreRevenueCatPurchases,
  revenueCatAvailability,
  type RevenueCatPlanOption,
  type RevenueCatPurchaseInterval,
} from '../../../services/revenueCat';

const PLANS: Array<{
  interval: RevenueCatPurchaseInterval;
  name: string;
  description: string;
  price: string | null;
}> = [
  {
    interval: 'MONTHLY',
    name: 'Monthly',
    description: 'Flexible monthly access through App Store or Google Play billing.',
    price: null,
  },
  {
    interval: 'ANNUAL',
    name: 'Annual',
    description: 'One yearly subscription through App Store or Google Play billing.',
    price: null,
  },
];

export default function BillingScreen() {
  const router = useRouter();
  const { user } = useAuthContext();
  const [status, setStatus] = useState<BackendBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<RevenueCatPlanOption[]>([]);
  const [revenueCatAppUserId, setRevenueCatAppUserId] = useState<string | null>(null);
  const availability = revenueCatAvailability();

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      setMessage(null);
      const billingStatus = await getBillingStatus();
      setStatus(billingStatus);
      setRevenueCatAppUserId(billingStatus.revenueCatAppUserId);
      if (availability.configured) {
        setPlanOptions(await getRevenueCatPlanOptions(billingStatus.revenueCatAppUserId));
      } else {
        setPlanOptions([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load billing status');
    } finally {
      setLoading(false);
    }
  }, [availability.configured, user?.id]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function purchase(interval: RevenueCatPurchaseInterval) {
    const appUserId = await ensureRevenueCatAppUserId();
    if (!appUserId) {
      setMessage('You need to sign in again');
      return;
    }

    try {
      setBusyAction(interval);
      setMessage(null);
      const result = await purchaseRevenueCatPackage(appUserId, interval);
      setMessage(result.entitled ? 'Subscription active. Syncing status...' : 'Purchase completed. Waiting for entitlement sync.');
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start purchase');
    } finally {
      setBusyAction(null);
    }
  }

  async function restore() {
    const appUserId = await ensureRevenueCatAppUserId();
    if (!appUserId) {
      setMessage('You need to sign in again');
      return;
    }

    try {
      setBusyAction('RESTORE');
      setMessage(null);
      const result = await restoreRevenueCatPurchases(appUserId);
      setMessage(result.entitled ? 'Purchases restored. Syncing status...' : 'No active Nearby subscription was found.');
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to restore purchases');
    } finally {
      setBusyAction(null);
    }
  }

  async function ensureRevenueCatAppUserId(): Promise<string | null> {
    if (!user?.id) {
      return null;
    }
    if (revenueCatAppUserId) {
      return revenueCatAppUserId;
    }

    const syncedUser = await syncAuthenticatedUser();
    setRevenueCatAppUserId(syncedUser.id);
    return syncedUser.id;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Billing</Text>
      <Text style={styles.subtitle}>Subscriptions are handled by the App Store or Google Play.</Text>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <View style={styles.statusPanel}>
          <Text style={styles.statusLabel}>{status?.entitled ? 'Active access' : 'No active subscription'}</Text>
          {status?.subscription ? (
            <Text style={styles.statusText}>
              {status.subscription.tier.replace('_', ' ')} · {status.subscription.billingInterval ?? 'Subscription'} ·{' '}
              {status.subscription.willRenew ? 'renews' : 'does not renew'}
            </Text>
          ) : (
            <Text style={styles.statusText}>Choose monthly or annual access to enable paid Nearby features.</Text>
          )}
        </View>
      )}

      {!availability.configured && <Text style={styles.notice}>{availability.reason}</Text>}
      {message && <Text style={styles.notice}>{message}</Text>}

      {(planOptions.length > 0 ? planOptions : PLANS).map((plan) => (
        <View key={plan.interval} style={styles.planCard}>
          <Text style={styles.planName}>{plan.name}</Text>
          {plan.price && <Text style={styles.planPrice}>{plan.price}</Text>}
          <Text style={styles.planDescription}>{plan.description}</Text>
          <Pressable
            style={[styles.selectButton, (!availability.configured || busyAction !== null) && styles.buttonDisabled]}
            disabled={!availability.configured || busyAction !== null}
            onPress={() => purchase(plan.interval)}
          >
            <Text style={styles.selectButtonText}>
              {busyAction === plan.interval ? 'Opening...' : `Continue ${plan.name}`}
            </Text>
          </Pressable>
        </View>
      ))}

      <Pressable
        style={[styles.restoreButton, (!availability.configured || busyAction !== null) && styles.buttonDisabled]}
        disabled={!availability.configured || busyAction !== null}
        onPress={restore}
      >
        <Text style={styles.restoreButtonText}>{busyAction === 'RESTORE' ? 'Restoring...' : 'Restore purchases'}</Text>
      </Pressable>

      <Text style={styles.footer}>Cancel or manage renewal from your App Store or Google Play subscription settings.</Text>
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
    gap: spacing.md,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: colors.primary,
    fontSize: fontSize.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  statusPanel: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  statusLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  statusText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  notice: {
    fontSize: fontSize.sm,
    color: colors.warning,
  },
  planCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  planName: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  planPrice: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.primary,
  },
  planDescription: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  selectButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  selectButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  restoreButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  restoreButtonText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  footer: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
});
