import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { getTimezone, searchTimezones, type TimezoneOption } from '../../data/timezones';

interface TimezoneSelectProps {
  value: string;
  onChange: (timezone: string) => void;
  label?: string;
  hint?: string;
}

export function TimezoneSelect({ value, onChange, label, hint }: TimezoneSelectProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedTimezone = getTimezone(value);
  const filteredTimezones = searchTimezones(searchQuery);

  const closePicker = () => {
    setShowPicker(false);
    setSearchQuery('');
  };

  const renderTimezoneItem = ({ item }: { item: TimezoneOption }) => (
    <Pressable
      style={[styles.timezoneItem, item.value === value && styles.timezoneItemSelected]}
      onPress={() => {
        onChange(item.value);
        closePicker();
      }}
    >
      <View style={styles.timezoneInfo}>
        <Text style={styles.timezoneLabel} numberOfLines={1}>
          {item.label}
        </Text>
        <Text style={styles.timezoneOffset}>{item.offset || item.value}</Text>
      </View>
      {item.value === value ? <Text style={styles.checkmark}>*</Text> : null}
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <Pressable style={styles.selector} onPress={() => setShowPicker(true)}>
        <View style={styles.selectorContent}>
          <Text style={styles.selectorLabel} numberOfLines={1}>
            {selectedTimezone?.label || 'Select timezone'}
          </Text>
          {selectedTimezone ? <Text style={styles.selectorOffset}>{selectedTimezone.offset || selectedTimezone.value}</Text> : null}
        </View>
        <Text style={styles.selectorArrow}>v</Text>
      </Pressable>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select timezone</Text>
              <Pressable onPress={closePicker}>
                <Text style={styles.modalClose}>Cancel</Text>
              </Pressable>
            </View>

            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search city or country..."
                placeholderTextColor={colors.textSecondary}
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={filteredTimezones}
              renderItem={renderTimezoneItem}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No timezones found</Text>
                </View>
              }
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
    gap: spacing.sm,
  },
  selectorContent: {
    flex: 1,
    minWidth: 0,
  },
  selectorLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '500',
  },
  selectorOffset: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  selectorArrow: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '58%',
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
  searchContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  timezoneItem: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  timezoneItemSelected: {
    backgroundColor: colors.primary + '10',
  },
  timezoneInfo: {
    flex: 1,
    minWidth: 0,
  },
  timezoneLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  timezoneOffset: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkmark: {
    fontSize: fontSize.lg,
    color: colors.primary,
    fontWeight: 'bold',
  },
  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
});
