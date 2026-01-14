// Settings layout - wraps all settings screens
import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="profile" />
      <Stack.Screen name="billing" />
      <Stack.Screen name="appearance" />
      <Stack.Screen name="language" />
      <Stack.Screen name="data-privacy" />
      <Stack.Screen name="security" />
    </Stack>
  );
}
