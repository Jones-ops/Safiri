/** Small form controls: Checkbox, SwitchRow, ListRow and SegmentedControl. All 48dp+ targets. */
import { Pressable, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { touchTarget } from '../theme/tokens';
import { AppText } from './AppText';

export function Checkbox({ checked, onChange, label, required }) {
  const { c, radius, space } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: touchTarget, paddingVertical: space.sm }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          marginTop: 2,
          borderRadius: radius.input / 2,
          borderWidth: 2,
          borderColor: checked ? c.primary : c.inputBorder,
          backgroundColor: checked ? c.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Ionicons name="checkmark" size={18} color={c.onPrimary} /> : null}
      </View>
      <AppText variant="body" style={{ flex: 1, fontWeight: required ? '600' : '400' }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function SwitchRow({ label, hint, value, onChange }) {
  const { c, space } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: touchTarget, gap: space.md, paddingVertical: space.sm }}
    >
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        {hint ? (
          <AppText variant="caption" tone="textMuted">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.primary, false: c.inputBorder }}
        thumbColor={c.surface}
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

export function ListRow({ icon, label, value, onPress, tone = 'text', chevron = true }) {
  const { c, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        minHeight: touchTarget + 8,
        paddingVertical: space.sm,
        opacity: pressed ? 0.7 : 1,
        borderBottomWidth: 1,
        borderBottomColor: c.divider,
      })}
    >
      {icon ? <Ionicons name={icon} size={22} color={c[tone] ?? c.text} /> : null}
      <AppText variant="body" tone={tone} style={{ flex: 1 }}>
        {label}
      </AppText>
      {value ? (
        <AppText variant="label" tone="textMuted">
          {value}
        </AppText>
      ) : null}
      {onPress && chevron ? <Ionicons name="chevron-forward" size={18} color={c.textMuted} /> : null}
    </Pressable>
  );
}

/** options: [{ value, label }] */
export function SegmentedControl({ options, value, onChange, accessibilityLabel }) {
  const { c, radius, space } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', backgroundColor: c.bg, borderRadius: radius.input, padding: 4, borderWidth: 1, borderColor: c.inputBorder }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            style={{
              flex: 1,
              minHeight: touchTarget - 8,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.input - 2,
              backgroundColor: selected ? c.primary : 'transparent',
              paddingHorizontal: space.sm,
            }}
          >
            <AppText variant="label" tone={selected ? 'onPrimary' : 'text'}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Filter chip: selected state shown by fill AND a check icon, not colour alone. */
export function Chip({ label, selected, onPress, icon }) {
  const { c, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        minHeight: touchTarget - 8,
        paddingHorizontal: space.lg,
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.inputBorder,
        backgroundColor: selected ? c.primarySoft : c.surface,
      }}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={c.primary} /> : icon ? <Ionicons name={icon} size={16} color={c.textMuted} /> : null}
      <AppText variant="label" tone={selected ? 'primary' : 'text'}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** - n + with 48dp buttons. */
export function Stepper({ label, hint, value, min = 1, max = 20, onChange }) {
  const { c, radius, space } = useTheme();
  const button = (icon, next, disabled, a11y) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{
        width: touchTarget,
        height: touchTarget,
        borderRadius: radius.input,
        borderWidth: 1.5,
        borderColor: disabled ? c.divider : c.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color={disabled ? c.textMuted : c.primary} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget }} accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        {hint ? <AppText variant="caption" tone="textMuted">{hint}</AppText> : null}
      </View>
      {button('remove', value - 1, value <= min, `${label} -1`)}
      <AppText variant="heading" tabular style={{ minWidth: 32, textAlign: 'center' }} accessibilityLiveRegion="polite">
        {value}
      </AppText>
      {button('add', value + 1, value >= max, `${label} +1`)}
    </View>
  );
}
