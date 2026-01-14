import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';

export default function SplashScreen() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Check if user is logged in
        const { data: { session } } = await supabase.auth.getSession();

        // Small delay for splash effect
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (session?.user) {
          // User is logged in, go to main app
          router.replace('/(main)');
        } else {
          // No session, go to auth flow
          router.replace('/(auth)/welcome');
        }
      } catch (error) {
        // On error, default to auth flow
        router.replace('/(auth)/welcome');
      } finally {
        setIsChecking(false);
      }
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
