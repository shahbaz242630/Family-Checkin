// Expo app config. This was a static `app.json` until CB-027.
//
// It is a module rather than JSON so that `android.googleServicesFile` can read
// `process.env.GOOGLE_SERVICES_JSON`, an EAS file environment variable, which a
// static file cannot do. That line is **not here yet**: no Firebase project
// exists, and pointing `googleServicesFile` at a missing file fails the Android
// build outright. Adding it is CB-031's job, and this conversion is what makes
// it possible. See `docs/providers/store-and-push-keys.md`.
//
// Everything here is public: identifiers, not credentials.
//
// This file is on the protected list in `docs/handoffs/auth-and-accounts.md`
// (it inherited `app.json`'s place there); changes need explicit approval.
module.exports = {
  expo: {
    name: 'Family Check-In',
    slug: 'family-checkin',
    owner: 'shahbaz242630',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    scheme: 'familycheckin',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#4A90D9',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.familycheckin.app',
      // Bumped per store submission. `eas.json` sets `appVersionSource: local`,
      // so EAS reads these from here rather than managing them remotely.
      buildNumber: '1',
      // The camera and photo-library usage strings that used to sit in
      // `infoPlist` were dropped with CB-027: the only feature that would have
      // needed them was the "Change photo" control, deleted in CB-033. A
      // permission prompt no code path can trigger is a question at review time.
      infoPlist: {
        // Declared false so TestFlight uploads skip the export-compliance
        // questionnaire. The app uses only HTTPS and the platform keychain,
        // which is the exemption this flag claims.
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#4A90D9',
      },
      package: 'com.familycheckin.app',
      versionCode: 1,
      edgeToEdgeEnabled: true,
      permissions: ['android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.VIBRATE'],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'familycheckin',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: '*.supabase.co',
              pathPrefix: '/auth/v1/callback',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      [
        'expo-router',
        {
          root: './src/app',
        },
      ],
      'expo-font',
      [
        'expo-notifications',
        {
          sounds: ['./assets/sounds/escalation-siren.wav'],
        },
      ],
      'expo-secure-store',
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: 'ddb699e2-f321-4f9e-8c17-64eeefc4cfd3',
      },
      router: {
        root: './src/app',
      },
    },
  },
};
