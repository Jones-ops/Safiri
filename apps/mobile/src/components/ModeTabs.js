/**
 * The tab bar for Provider and Agency modes (the Traveller tabs live in app/(traveller)).
 * The header carries a "switch mode" button back to the traveller Profile.
 */
import { Pressable } from 'react-native';
import { router, Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { useSettings } from '../state/settings';
import { touchTarget } from '../theme/tokens';

export function ModeTabs({ tabs, hidden = [] }) {
  const { c, type, space } = useTheme();
  const { t } = useTranslation();
  const setMode = useSettings((s) => s.setMode);

  const switchMode = () => {
    setMode('traveller');
    router.replace('/profile');
  };

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerRight: () => (
          <Pressable
            onPress={switchMode}
            accessibilityRole="button"
            accessibilityLabel={t('modes.switch')}
            style={{ minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', marginRight: space.sm }}
          >
            <Ionicons name="swap-horizontal-outline" size={24} color={c.primary} />
          </Pressable>
        ),
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.divider, minHeight: 60 },
        tabBarLabelStyle: { ...type.caption, fontWeight: '500' },
        tabBarAllowFontScaling: true,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      {tabs.map(({ name, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(`tabs.${name}`),
            headerTitleAllowFontScaling: true,
            tabBarLabel: t(`tabs.${name}`),
            tabBarIcon: ({ color, focused, size }) => <Ionicons name={focused ? icon : `${icon}-outline`} color={color} size={size} />,
            tabBarItemStyle: { minHeight: 48 },
            tabBarAccessibilityLabel: t(`tabs.${name}`),
          }}
        />
      ))}
      {hidden.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>
  );
}
