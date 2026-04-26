import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { AuthProvider } from '../contexts/AuthContext';
import { ProtectedRoute } from '../components/auth';
import { handleAuthDeepLink } from '../services/supabase';

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Handle deep link when app is opened from a closed state
    const handleInitialURL = async () => {
      const url = await Linking.getInitialURL();
      if (url) {
        handleDeepLink(url);
      }
    };

    // Handle deep link when app receives URL while running
    const handleDeepLink = async (url: string) => {
      // Check if this is a password reset link
      if (url.includes('reset-password') || url.includes('type=recovery')) {
        // Navigate to reset password screen which will handle the token
        router.push('/auth/reset-password');
        return;
      }

      // Check if this is an auth callback (email confirmation, OAuth)
      if (url.includes('auth/callback') || url.includes('access_token')) {
        const result = await handleAuthDeepLink(url);
        if (result.success) {
          // Navigate to main app on success
          router.replace('/(main)');
        } else {
          // Navigate to auth callback screen to show error
          router.push('/auth/callback');
        }
      }
    };

    handleInitialURL();

    // Subscribe to incoming links while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [router]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <AuthProvider>
        <SafeAreaProvider>
          <StatusBar style="auto" />
          <ProtectedRoute>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            >
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(main)" options={{ headerShown: false }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
              <Stack.Screen name="auth/reset-password" options={{ headerShown: false }} />
            </Stack>
          </ProtectedRoute>
        </SafeAreaProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
