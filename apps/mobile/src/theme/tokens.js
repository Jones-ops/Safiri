/**
 * Design tokens from the Part A design system. Contrast ratios (WCAG AA) were calculated for
 * every text pairing; see docs in the build plan. Rules worth repeating:
 *   - accent (amber) is a FILL only, always with dark text on top. Amber text on sand is 2.3:1.
 *   - divider is decorative; inputBorder (3.8 / 3.2) is the minimum for controls.
 *   - status is always icon + word, never colour alone.
 */

export const colors = {
  light: {
    bg: '#FAF6EF',
    surface: '#FFFFFF',
    text: '#1C1A16',
    textMuted: '#5F584D',
    primary: '#1F5C46',
    onPrimary: '#FFFFFF',
    primarySoft: '#E3EFE8',
    accent: '#E8913A',
    onAccent: '#1C1A16',
    success: '#2E7D4F',
    warning: '#9A5B00',
    danger: '#B42318',
    inputBorder: '#8A8276',
    divider: '#E6DFD3',
    scrim: 'rgba(18, 17, 16, 0.55)', // over photos, so white text stays readable
    skeleton: '#EDE6DA',
  },
  dark: {
    bg: '#121110',
    surface: '#1C1B19',
    text: '#F4EFE6',
    textMuted: '#B3AB9E',
    primary: '#6CC19A',
    onPrimary: '#0E1F17',
    primarySoft: '#1E3A2E',
    accent: '#F0A35E',
    onAccent: '#121110',
    success: '#5CC48A',
    warning: '#E3A64A',
    danger: '#F28B7D',
    inputBorder: '#6F695F',
    divider: '#2E2C28',
    scrim: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#2A2825',
  },
};

// System font (Roboto on Android): nothing extra to download.
export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const radius = { input: 8, card: 12, sheet: 20, chip: 999 };

export const elevation = {
  card: { elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  sheet: { elevation: 8, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: -2 } },
};

// Durations in ms. Set to 0 when the phone's Reduce Motion setting is on (see ThemeProvider).
export const motion = { press: 150, sheet: 250 };

export const touchTarget = 48; // dp, minimum for anything tappable

// Text can scale up to 200% with the phone's font size setting.
export const maxFontScale = 2;
