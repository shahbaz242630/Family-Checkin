// Onboarding layout - wraps all onboarding screens
import { Stack } from 'expo-router';
import { OnboardingProvider } from '../../contexts/OnboardingContext';

export default function OnboardingLayout() {
  return (
    <OnboardingProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: false, // Prevent swipe back during onboarding
        }}
      >
        <Stack.Screen name="trial-welcome" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="add-loved-one" />
        <Stack.Screen name="checkin-schedule" />
        <Stack.Screen name="safety-net" />
        <Stack.Screen name="all-set" />
      </Stack>
    </OnboardingProvider>
  );
}
