import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COUNTRIES } from '../../data/constants';
import type { CountryOption } from '../../data/countries';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface CountrySelectProps {
  label?: string;
  value: string;
  onChange: (isoCode: string) => void;
  disabled?: boolean;
  showDialCode?: boolean;
  compactDialCode?: boolean;
}

export function CountrySelect({ label, value, onChange, disabled, showDialCode = true, compactDialCode }: CountrySelectProps) {
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState('');
  const selectedCountry = COUNTRIES.find((country) => country.isoCode === value.toUpperCase()) ?? COUNTRIES[0];

  const filteredCountries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return COUNTRIES;
    }

    return COUNTRIES.filter((country) =>
      [country.country, country.isoCode, country.dialCode].some((part) => part.toLowerCase().includes(normalizedQuery)),
    );
  }, [query]);

  const selectCountry = (country: CountryOption) => {
    onChange(country.isoCode);
    setQuery('');
    setShowPicker(false);
  };

  const renderCountryItem = ({ item }: { item: CountryOption }) => (
    <Pressable
      style={[styles.countryItem, item.isoCode === selectedCountry.isoCode && styles.countryItemSelected]}
      onPress={() => selectCountry(item)}
    >
      <View style={styles.countryIdentity}>
        <Text style={styles.countryName} numberOfLines={1}>
          {item.country}
        </Text>
        <Text style={styles.countryMeta}>{item.isoCode}</Text>
      </View>
      {showDialCode ? <Text style={styles.countryDialCode}>{item.dialCode}</Text> : null}
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        style={[styles.selector, compactDialCode && styles.selectorCompact, disabled && styles.selectorDisabled]}
        onPress={() => setShowPicker(true)}
        disabled={disabled}
      >
        <View style={[styles.selectorTextGroup, compactDialCode && styles.selectorTextGroupCompact]}>
          <Text style={[styles.selectorLabel, compactDialCode && styles.selectorLabelCompact]} numberOfLines={1}>
            {compactDialCode ? selectedCountry.dialCode : selectedCountry.country}
          </Text>
          {!compactDialCode ? (
            <Text style={styles.selectorMeta}>
              {selectedCountry.isoCode}
              {showDialCode ? ` ${selectedCountry.dialCode}` : ''}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.selectorArrow, compactDialCode && styles.selectorArrowCompact]}>v</Text>
      </Pressable>

      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select country</Text>
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search by country, ISO, or code"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
            <FlatList
              data={filteredCountries}
              renderItem={renderCountryItem}
              keyExtractor={(item) => item.isoCode}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<Text style={styles.emptyText}>No countries found</Text>}
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
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  selectorDisabled: {
    opacity: 0.6,
  },
  selectorCompact: {
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  selectorTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  selectorTextGroupCompact: {
    alignItems: 'center',
  },
  selectorLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  selectorLabelCompact: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  selectorMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  selectorArrow: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  selectorArrowCompact: {
    fontSize: fontSize.sm,
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
    maxHeight: '56%',
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
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    margin: spacing.md,
    marginBottom: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  countryItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  countryItemSelected: {
    backgroundColor: colors.primary + '10',
  },
  countryIdentity: {
    flex: 1,
    minWidth: 0,
  },
  countryName: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  countryMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  countryDialCode: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },
  emptyText: {
    padding: spacing.lg,
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
});
