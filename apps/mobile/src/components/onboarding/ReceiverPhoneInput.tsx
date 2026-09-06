import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../../theme';
import { CountrySelect } from './CountrySelect';

interface ReceiverPhoneInputProps {
  phoneCountry: string;
  phone: string;
  onChangePhoneCountry: (isoCode: string) => void;
  onChangePhone: (phone: string) => void;
  error?: string;
  disabled?: boolean;
  /** Field label. Defaults to the receiver's number; pass the owner of the number when it is someone else (CB-072). */
  label?: string;
}

export function ReceiverPhoneInput({
  phoneCountry,
  phone,
  onChangePhoneCountry,
  onChangePhone,
  error,
  disabled,
  label = 'Receiver phone',
}: ReceiverPhoneInputProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <View style={styles.countryPicker}>
          <CountrySelect value={phoneCountry} onChange={onChangePhoneCountry} disabled={disabled} compactDialCode />
        </View>
        <View style={[styles.phoneInputContainer, error && styles.phoneInputError]}>
          <TextInput
            style={styles.phoneInput}
            value={phone}
            onChangeText={onChangePhone}
            placeholder="559871662"
            placeholderTextColor={colors.textSecondary}
            keyboardType="phone-pad"
            editable={!disabled}
          />
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
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
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  countryPicker: {
    width: 112,
  },
  phoneInputContainer: {
    minHeight: 52,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
  },
  phoneInputError: {
    borderColor: colors.error,
  },
  phoneInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: colors.text,
  },
  errorText: {
    fontSize: fontSize.xs,
    color: colors.error,
  },
});
