import React, { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type SelectMenuProps<T extends string> = {
  label: string;
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  testID?: string;
};

export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  testID,
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false);

  const currentLabel = useMemo(() => {
    return options.find((o) => o.value === value)?.label ?? "";
  }, [options, value]);

  return (
    <>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.button,
          disabled ? styles.buttonDisabled : null,
          { opacity: pressed ? 0.75 : 1 },
        ]}
      >
        <View style={styles.buttonText}>
          <ThemedText style={styles.label}>{label}</ThemedText>
          <ThemedText style={styles.value} numberOfLines={1}>
            {currentLabel}
          </ThemedText>
        </View>
        <Feather name="chevron-down" size={16} color={Colors.light.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>{label}</ThemedText>
            <Pressable onPress={() => setOpen(false)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Feather name="x" size={20} color={Colors.light.text} />
            </Pressable>
          </View>

          {options.map((o) => {
            const selected = o.value === value;
            return (
              <Pressable
                key={o.value}
                style={({ pressed }) => [styles.optionRow, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <ThemedText style={styles.optionText}>{o.label}</ThemedText>
                <Feather
                  name={selected ? "check" : "circle"}
                  size={18}
                  color={selected ? Colors.light.accent : Colors.light.textTertiary}
                />
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: BorderRadius.md,
    minWidth: 130,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    flex: 1,
  },
  label: {
    ...Typography.caption,
    color: Colors.light.textSecondary,
    fontSize: 11,
  },
  value: {
    ...Typography.caption,
    color: Colors.light.text,
    fontWeight: "600",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  modalCard: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    top: "20%",
    backgroundColor: Colors.light.backgroundRoot,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  modalTitle: {
    ...Typography.title,
    fontSize: 16,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.light.border,
  },
  optionText: {
    ...Typography.body,
    color: Colors.light.text,
    flex: 1,
    paddingRight: Spacing.md,
  },
});


