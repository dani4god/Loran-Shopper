import React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Switch,
  type TextInputProps,
} from "react-native";
export const c = {
  green: "#154e3e",
  lime: "#dceab3",
  orange: "#cf672f",
  bg: "#f7f7ef",
  ink: "#1f352c",
  muted: "#657269",
  line: "#dbe1d5",
};
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.buttonText, secondary && { color: c.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 90, textAlignVertical: "top" },
          props.style,
        ]}
        placeholderTextColor="#889286"
      />
    </View>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.toggle}>
      <Text style={[s.text, { flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.green, false: "#c4cbbd" }}
      />
    </View>
  );
}
export function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: 22, paddingBottom: 80 },
  header: {
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  brand: { fontSize: 24, fontWeight: "800", color: c.green },
  h1: { fontSize: 32, fontWeight: "800", color: c.ink, marginVertical: 14 },
  h2: { fontSize: 22, fontWeight: "700", color: c.ink, marginBottom: 12 },
  h3: { fontSize: 17, fontWeight: "700", color: c.ink, marginVertical: 10 },
  text: { color: c.muted, lineHeight: 23, fontSize: 14 },
  small: { color: c.muted, fontSize: 12, lineHeight: 19 },
  card: {
    backgroundColor: "white",
    padding: 20,
    borderRadius: 18,
    marginVertical: 9,
    borderWidth: 1,
    borderColor: c.line,
  },
  button: {
    backgroundColor: c.green,
    padding: 15,
    borderRadius: 10,
    marginTop: 12,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  secondary: { backgroundColor: c.bg, borderWidth: 1, borderColor: c.line },
  buttonText: { color: "white", fontWeight: "700", fontSize: 14 },
  field: { marginVertical: 8 },
  label: { fontSize: 13, fontWeight: "600", color: c.ink, marginBottom: 7 },
  input: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: "white",
    padding: 13,
    borderRadius: 9,
    fontSize: 15,
    color: c.ink,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  row: { flexDirection: "row", gap: 12, alignItems: "center" },
  error: {
    backgroundColor: "#fff0e9",
    color: "#a33e26",
    padding: 14,
    borderRadius: 10,
    marginVertical: 10,
  },
  badge: {
    color: c.green,
    backgroundColor: c.lime,
    padding: 8,
    borderRadius: 7,
    alignSelf: "flex-start",
    fontWeight: "700",
    fontSize: 12,
  },
  line: { height: 1, backgroundColor: c.line, marginVertical: 14 },
  link: { color: c.green, fontWeight: "700", paddingVertical: 8 },
  photo: { width: 68, height: 68, borderRadius: 34 },
  price: { fontSize: 22, fontWeight: "800", color: c.green },
  code: { fontSize: 14, fontWeight: "700", color: c.green, lineHeight: 24 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 15 },
});
