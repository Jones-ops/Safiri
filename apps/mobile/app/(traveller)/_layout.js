/** Traveller mode (the default): Explore, Trips, Pay, Profile. Provider and Agency modes arrive in Slice 5. */
import { Redirect, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useSettings } from '../../src/state/settings';

const TABS = [
  { name: 'explore', icon: 'compass' },
  { name: 'trips', icon: 'map' },
  { name: 'pay', icon: 'wallet' },
  { name: 'profile', icon: 'person-circle' },
];

export default function TravellerTabs() {
  const { c, type } = useTheme();
  const { t } = useTranslation();
  const welcomeDone = useSettings((s) => s.welcomeDone);

  if (!welcomeDone) return <Redirect href="/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.divider, minHeight: 60 },
        tabBarLabelStyle: { ...type.caption, fontWeight: '500' },
        tabBarAllowFontScaling: true,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      {TABS.map(({ name, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(`tabs.${name}`),
            headerShown: name !== 'explore',
            headerTitleAllowFontScaling: true,
            tabBarLabel: t(`tabs.${name}`),
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? icon : `${icon}-outline`} color={color} size={size} />
            ),
            tabBarItemStyle: { minHeight: 48 },
            tabBarLabelStyle: { ...type.caption, fontWeight: '500' },
            tabBarAccessibilityLabel: t(`tabs.${name}`),
          }}
        />
      ))}
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
