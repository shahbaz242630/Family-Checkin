import { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../theme/colors';

export default function SplashScreen() {
  const router = useRouter();

  useEffect(() => {
    // TODO: Check auth state and redirect accordingly
    const checkAuth = async () => {
      // Simulate auth check
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // For now, always go to auth flow
      // Later: check if user is logged in -> go to (app)
      router.replace('/(auth)/welcome');
    };

    checkAuth();
  }, []);

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
