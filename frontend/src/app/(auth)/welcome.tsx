// Welcome screen - Landing page with Login/Signup tabs
import { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

type Tab = 'login' | 'signup';

export default function WelcomeScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('login');

  const handleContinue = () => {
    if (activeTab === 'login') {
      router.push('/(auth)/login');
    } else {
      router.push('/(auth)/signup');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo & Tagline */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoIcon}>✓</Text>
          </View>
          <Text style={styles.title}>Family Check-In</Text>
          <Text style={styles.tagline}>Peace of mind, one tap away</Text>
        </View>

        {/* Features */}
        <View style={styles.features}>
          <FeatureItem
            icon="🔔"
            text="Daily safety check-ins for your loved ones"
          />
          <FeatureItem
            icon="💬"
            text="Alerts via WhatsApp, SMS & calls"
          />
          <FeatureItem
            icon="👨‍👩‍👧‍👦"
            text="Monitor parents, partners & family"
          />
        </View>

        {/* Tab Selector */}
        <View style={styles.tabContainer}>
          <Pressable
            style={[styles.tab, activeTab === 'login' && styles.tabActive]}
            onPress={() => setActiveTab('login')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'login' && styles.tabTextActive,
              ]}
            >
              Login
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === 'signup' && styles.tabActive]}
            onPress={() => setActiveTab('signup')}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === 'signup' && styles.tabTextActive,
              ]}
            >
              Sign Up
            </Text>
          </Pressable>
        </View>

        {/* Continue Button */}
        <Pressable style={styles.continueButton} onPress={handleContinue}>
          <Text style={styles.continueButtonText}>
            {activeTab === 'login' ? 'Login to your account' : 'Create your account'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
    paddingVertical: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  logoContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoIcon: {
    fontSize: 40,
    color: colors.textOnPrimary,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  tagline: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  features: {
    gap: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.backgroundSecondary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  featureIcon: {
    fontSize: fontSize.xl,
  },
  featureText: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.lg,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.textOnPrimary,
  },
  continueButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  continueButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
});
