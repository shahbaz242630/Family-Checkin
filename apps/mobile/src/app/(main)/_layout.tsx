// Main app layout - wraps all authenticated screens with drawer navigation
import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { DrawerProvider } from '../../contexts/DrawerContext';
import { Header, Sidebar, ProfileMenu } from '../../components/layout';
import { useSessionAutoRefresh } from '../../hooks/useSessionAutoRefresh';

export default function MainLayout() {
  // Supabase's token refresh follows the app lifecycle from here: this layout is mounted exactly while there is
  // an authenticated session to refresh (CB-037).
  useSessionAutoRefresh();

  return (
    <DrawerProvider>
      <View style={styles.container}>
        <Header />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="admin-abuse-reports" />
          <Stack.Screen name="admin-operations" />
          <Stack.Screen name="admin-operations/[checkInId]" />
          <Stack.Screen name="receiver-setup" />
          <Stack.Screen name="receivers/[id]" />
          <Stack.Screen name="settings" />
        </Stack>
        <Sidebar />
        <ProfileMenu />
      </View>
    </DrawerProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
