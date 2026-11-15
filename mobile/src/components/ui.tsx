import { ActivityIndicator, Pressable, StyleSheet, Text, TextProps, View, ViewProps } from 'react-native';
import { STATUS_LABEL } from '@/lib/money';
import { useColors } from '@/lib/theme';
import type { OrderStatus } from '@/lib/types';

export function Txt({
  style,
  muted,
  weight,
  size = 15,
  color,
  ...props
}: TextProps & { muted?: boolean; weight?: '400' | '600' | '700' | '800' | '900'; size?: number; color?: string }) {
  const c = useColors();
  return (
    <Text
      {...props}
      style={[{ color: color ?? (muted ? c.muted : c.text), fontSize: size, fontWeight: weight ?? '400' }, style]}
    />
  );
}

export function Card({ style, ...props }: ViewProps) {
  const c = useColors();
  return (
    <View
      {...props}
      style={[{ backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: 16 }, style]}
    />
  );
}

export function Button({
  title,
  onPress,
  disabled,
  variant = 'primary',
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  style?: ViewProps['style'];
}) {
  const c = useColors();
  const primary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: primary ? c.brand : c.surface,
          borderColor: primary ? c.brand : c.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <Text style={{ color: primary ? '#fff' : c.text, fontWeight: '700', fontSize: 16 }}>{title}</Text>
    </Pressable>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={{ padding: 48, alignItems: 'center' }}>
      <ActivityIndicator color={c.brand} />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const c = useColors();
  if (!message) return null;
  return <Txt style={{ color: c.red, marginVertical: 8 }}>{message}</Txt>;
}

export function VegDot({ veg }: { veg: boolean }) {
  const color = veg ? '#16a34a' : '#dc2626';
  return (
    <View style={[styles.vegBox, { borderColor: color }]}>
      <View style={[styles.vegDot, { backgroundColor: color }]} />
    </View>
  );
}

const PILL: Record<OrderStatus, [string, string]> = {
  pending_payment: ['#fef9c3', '#854d0e'],
  placed: ['#dbeafe', '#1e40af'],
  preparing: ['#ffedd5', '#9a3412'],
  ready: ['#dcfce7', '#166534'],
  completed: ['#e7e5e4', '#44403c'],
  cancelled: ['#fee2e2', '#b91c1c'],
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const [bg, fg] = PILL[status];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegBox: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
});
