import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../theme/colors';
import { useAuthContext } from '../contexts/AuthContext';

export default function SplashScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthContext();

  useEffect(() => {
    // Wait for auth state to be determined
    if (isLoading) return;

    // Small delay for splash effect
    const timer = setTimeout(() => {
      if (isAuthenticated) {
        router.replace('/(main)');
      } else {
        router.replace('/(auth)/welcome');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [isAuthenticated, isLoading]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Family Check-In</Text>
      <Text style={styles.subtitle}>Peace of mind, one tap away</Text>
      <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  loader: {
    marginTop: 20,
  },
});
