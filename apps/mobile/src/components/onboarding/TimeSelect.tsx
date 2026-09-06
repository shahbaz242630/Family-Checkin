import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { DEFAULT_MINUTE_STEP, buildTimeOptions } from '../../utils/timeOptions';

interface TimeSelectProps {
  label: string;
  value: string;
  onChange: (time: string) => void;
  disabled?: boolean;
  /** Minutes between options. Defaults to quarter hours (CB-073); a loaded value off the step is still listed. */
  minuteStep?: number;
}

const TIME_ROW_HEIGHT = 44;

export function TimeSelect({ label, value, onChange, disabled, minuteStep = DEFAULT_MINUTE_STEP }: TimeSelectProps) {
  const [showPicker, setShowPicker] = useState(false);
  const options = useMemo(() => buildTimeOptions(minuteStep, value), [minuteStep, value]);
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
              getItemLayout={(_, index) => ({ length: TIME_ROW_HEIGHT, offset: TIME_ROW_HEIGHT * index, index })}
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
    height: TIME_ROW_HEIGHT,
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
