import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { getLanguage, LANGUAGES, type LanguageOption } from '../../data/languages';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface LanguageSelectProps {
  label: string;
  value: string;
  onChange: (language: string) => void;
  disabled?: boolean;
}

export function LanguageSelect({ label, value, onChange, disabled }: LanguageSelectProps) {
  const [showPicker, setShowPicker] = useState(false);
  const selectedLanguage = getLanguage(value) ?? LANGUAGES[0];

  const selectLanguage = (language: LanguageOption) => {
    onChange(language.code);
    setShowPicker(false);
  };

  const renderLanguageItem = ({ item }: { item: LanguageOption }) => (
    <Pressable
      style={[styles.languageItem, item.code === selectedLanguage.code && styles.languageItemSelected]}
      onPress={() => selectLanguage(item)}
    >
      <View style={styles.languageTextGroup}>
        <Text style={styles.languageName}>{item.name}</Text>
        <Text style={styles.languageMeta}>{item.nativeName}</Text>
      </View>
      <Text style={styles.languageCode}>{item.code}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.selector, disabled && styles.selectorDisabled]}
        onPress={() => setShowPicker(true)}
        disabled={disabled}
      >
        <View style={styles.selectorTextGroup}>
          <Text style={styles.selectorLabel}>{selectedLanguage.name}</Text>
          <Text style={styles.selectorMeta}>{selectedLanguage.nativeName}</Text>
        </View>
        <Text style={styles.selectorArrow}>v</Text>
      </Pressable>

      <Modal visible={showPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select language</Text>
              <Pressable onPress={() => setShowPicker(false)}>
                <Text style={styles.modalClose}>Done</Text>
              </Pressable>
            </View>
            <FlatList
              data={LANGUAGES}
              renderItem={renderLanguageItem}
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
  selectorTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  selectorLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  selectorMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  selectorArrow: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
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
    maxHeight: '42%',
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
  languageItem: {
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
  languageItemSelected: {
    backgroundColor: colors.primary + '10',
  },
  languageTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  languageName: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  languageMeta: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  languageCode: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },
});
