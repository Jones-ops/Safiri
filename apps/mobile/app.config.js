/**
 * Expo app config. Only EXPO_PUBLIC_* values reach the app bundle: never put a secret in one.
 * APP_VARIANT=development builds a separate "Safiri (dev)" app that installs beside the real one.
 */
const IS_DEV = process.env.APP_VARIANT === 'development';

// The public web domain (Slice 1). Links to it open the app when it is installed (Android
// App Links, verified through https://<host>/.well-known/assetlinks.json served by the API).
const WEB_HOST = process.env.WEB_HOST || 'safiri.example';
const APP_LINK_PATHS = ['/p/', '/d/', '/t/', '/i/', '/pay/'];

const plugins = [
  'expo-router',
  'expo-localization',
  'expo-font',
  'expo-image',
  [
    'expo-splash-screen',
    {
      image: './assets/brand/splash-icon.png',
      imageWidth: 160,
      backgroundColor: '#1F5C46',
      dark: { image: './assets/brand/splash-icon.png', backgroundColor: '#121110' },
    },
  ],
  ['expo-notifications', { color: '#1F5C46' }],
  '@maplibre/maplibre-react-native', // offline trip maps (native code: dev and EAS builds only)
];

// Source maps upload to Sentry only when the build has Sentry credentials (EAS secrets).
if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
  plugins.push(['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }]);
}

module.exports = () => ({
  name: IS_DEV ? 'Safiri (dev)' : 'Safiri',
  slug: 'safiri',
  scheme: 'safiri',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/brand/icon.png',
  backgroundColor: '#FAF6EF',
  android: {
    package: IS_DEV ? 'ke.safiri.app.dev' : 'ke.safiri.app',
    adaptiveIcon: { foregroundImage: './assets/brand/adaptive-icon.png', backgroundColor: '#1F5C46' },
    // Keep the install small and the permission list honest. Location and camera arrive with
    // the slices that need them (offline map, uploads).
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: APP_LINK_PATHS.map((pathPrefix) => ({ scheme: 'https', host: WEB_HOST, pathPrefix })),
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  ios: {
    bundleIdentifier: IS_DEV ? 'ke.safiri.app.dev' : 'ke.safiri.app',
    supportsTablet: false,
    associatedDomains: [`applinks:${WEB_HOST}`], // iOS Universal Links (iOS store release is out of scope for Phase 1)
  },
  plugins,
  experiments: { typedRoutes: false },
  extra: {
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
