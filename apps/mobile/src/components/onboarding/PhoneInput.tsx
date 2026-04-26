// Phone input with country code selector
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
import { COUNTRY_CODES } from '../../data/constants';

interface PhoneInputProps {
  value: string;
  countryCode: string;
  onChangePhone: (phone: string) => void;
  onChangeCountryCode: (code: string) => void;
  placeholder?: string;
  label?: string;
}

export function PhoneInput({
  value,
  countryCode,
  onChangePhone,
  onChangeCountryCode,
  placeholder = 'Phone number',
  label,
}: PhoneInputProps) {
  const [showPicker, setShowPicker] = useState(false);

  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];

  const renderCountryItem = ({ item }: { item: (typeof COUNTRY_CODES)[number] }) => (
    <Pressable
      style={[styles.countryItem, item.code === countryCode && styles.countryItemSelected]}
      onPress={() => {
        onChangeCountryCode(item.code);
        setShowPicker(false);
      }}
    >
      <Text style={styles.countryFlag}>{item.flag}</Text>
      <Text style={styles.countryName}>{item.country}</Text>
      <Text style={styles.countryCode}>{item.code}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.inputRow}>
        {/* Country Code Picker */}
        <Pressable style={styles.countryPicker} onPress={() => setShowPicker(true)}>
          <Text style={styles.countryPickerFlag}>{selectedCountry.flag}</Text>
          <Text style={styles.countryPickerCode}>{selectedCountry.code}</Text>
          <Text style={styles.countryPickerArrow}>▼</Text>
        </Pressable>

        {/* Phone Input */}
        <TextInput
          style={styles.phoneInput}
          value={value}
          onChangeText={onChangePhone}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType="phone-pad"
        />
      </View>

      {/* Country Picker Modal */}
      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </Pressable>
            </View>
            <FlatList
              data={COUNTRY_CODES}
              renderItem={renderCountryItem}
              keyExtractor={(item) => item.code}
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
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  countryPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  countryPickerFlag: {
    fontSize: 18,
  },
  countryPickerCode: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  countryPickerArrow: {
    fontSize: 10,
    color: colors.textSecondary,
    marginLeft: 2,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
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
    maxHeight: '70%',
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
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  countryItemSelected: {
    backgroundColor: colors.primary + '10',
  },
  countryFlag: {
    fontSize: 24,
  },
  countryName: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
  },
  countryCode: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    fontWeight: '500',
  },
});
