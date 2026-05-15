import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { TextInput } from '../auth';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

interface StepUpCodeModalProps {
  visible: boolean;
  title: string;
  message: string;
  code: string;
  onChangeCode: (code: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function StepUpCodeModal({
  visible,
  title,
  message,
  code,
  onChangeCode,
  onCancel,
  onSubmit,
}: StepUpCodeModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <TextInput
            label="Verification code"
            value={code}
            onChangeText={(value) => onChangeCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            placeholder="123456"
          />
          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.primaryButton} onPress={onSubmit} disabled={code.trim().length === 0}>
              <Text style={styles.primaryButtonText}>Verify</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  dialog: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  message: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  primaryButton: {
    flex: 1,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  primaryButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
