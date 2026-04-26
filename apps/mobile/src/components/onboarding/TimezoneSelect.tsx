// Timezone selector with search
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  StyleSheet,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { TIMEZONES, searchTimezones, getTimezone, TimezoneOption } from '../../data/timezones';

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

  const renderTimezoneItem = ({ item }: { item: TimezoneOption }) => (
    <Pressable
      style={[styles.timezoneItem, item.value === value && styles.timezoneItemSelected]}
      onPress={() => {
        onChange(item.value);
        setShowPicker(false);
        setSearchQuery('');
      }}
    >
      <View style={styles.timezoneInfo}>
        <Text style={styles.timezoneLabel}>{item.label}</Text>
        <Text style={styles.timezoneOffset}>{item.offset}</Text>
      </View>
      {item.value === value && <Text style={styles.checkmark}>✓</Text>}
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}

      <Pressable style={styles.selector} onPress={() => setShowPicker(true)}>
        <View style={styles.selectorContent}>
          <Text style={styles.selectorLabel}>
            {selectedTimezone?.label || 'Select timezone'}
          </Text>
          {selectedTimezone && (
            <Text style={styles.selectorOffset}>{selectedTimezone.offset}</Text>
          )}
        </View>
        <Text style={styles.selectorArrow}>▼</Text>
      </Pressable>

      {hint && <Text style={styles.hint}>{hint}</Text>}

      {/* Timezone Picker Modal */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Timezone</Text>
              <Pressable onPress={() => { setShowPicker(false); setSearchQuery(''); }}>
                <Text style={styles.modalClose}>Cancel</Text>
              </Pressable>
            </View>

            {/* Search Input */}
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
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  selector: {
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
  selectorContent: {
    flex: 1,
  },
  selectorLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  selectorOffset: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  selectorArrow: {
    fontSize: 12,
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.background,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
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
    padding: spacing.md,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timezoneItemSelected: {
    backgroundColor: colors.primary + '10',
  },
  timezoneInfo: {
    flex: 1,
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
