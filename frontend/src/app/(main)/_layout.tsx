// Main app layout - wraps all authenticated screens with drawer navigation
import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { DrawerProvider } from '../../contexts/DrawerContext';
import { Header, Sidebar, ProfileMenu } from '../../components/layout';

export default function MainLayout() {
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
          <Stack.Screen name="loved-ones" />
          <Stack.Screen name="check-ins" />
          <Stack.Screen name="escalations" />
          <Stack.Screen name="pairing" />
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
