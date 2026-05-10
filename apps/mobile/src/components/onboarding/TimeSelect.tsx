import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface TimeSelectProps {
  label: string;
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  minuteStep?: number;
}

function buildTimeOptions(minuteStep: number): string[] {
  const options: string[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += minuteStep) {
      options.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
    }
  }

  return options;
}

export function TimeSelect({ label, value, onChange, disabled, minuteStep = 1 }: TimeSelectProps) {
  const [showPicker, setShowPicker] = useState(false);
  const options = useMemo(() => buildTimeOptions(minuteStep), [minuteStep]);
  const selectedValue = options.includes(value) ? value : '09:00';

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.selector, disabled && styles.selectorDisabled]}
        onPress={() => setShowPicker(true)}
        disabled={disabled}
      >
        <Text style={styles.selectorLabel}>{selectedValue}</Text>
        <Text style={styles.selectorArrow}>v</Text>
      </Pressable>

      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select {label.toLowerCase()}</Text>
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </Pressable>
            </View>
            <FlatList
              data={options}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.timeItem, item === selectedValue && styles.timeItemSelected]}
                  onPress={() => {
                    onChange(item);
                    setShowPicker(false);
                  }}
                >
                  <Text style={[styles.timeText, item === selectedValue && styles.timeTextSelected]}>{item}</Text>
                </Pressable>
              )}
              keyExtractor={(item) => item}
              initialScrollIndex={Math.max(options.indexOf(selectedValue) - 4, 0)}
              getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.text,
  },
  selector: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectorDisabled: {
    opacity: 0.6,
  },
  selectorLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  selectorArrow: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    width: '58%',
    minWidth: 220,
    maxHeight: '46%',
    marginBottom: spacing.lg,
    borderBottomLeftRadius: borderRadius.xl,
    borderBottomRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  modalClose: {
    fontSize: fontSize.md,
    color: colors.primary,
    fontWeight: '600',
  },
  timeItem: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timeItemSelected: {
    backgroundColor: colors.primary + '10',
  },
  timeText: {
    fontSize: fontSize.md,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  timeTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
