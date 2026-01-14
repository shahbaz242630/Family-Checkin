import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, fontSize, borderRadius } from '../../theme';

// Mock data
const MOCK_HISTORY = [
  { id: '1', date: 'Today', time: '9:00 AM', status: 'confirmed', method: 'app' },
  { id: '2', date: 'Yesterday', time: '9:15 AM', status: 'confirmed', method: 'whatsapp' },
  { id: '3', date: 'Jan 12', time: '9:00 AM', status: 'confirmed', method: 'app' },
  { id: '4', date: 'Jan 11', time: '10:30 AM', status: 'snoozed', method: 'app' },
  { id: '5', date: 'Jan 10', time: '9:00 AM', status: 'confirmed', method: 'app' },
];

export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Check-In History</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {MOCK_HISTORY.map((item) => (
          <HistoryItem key={item.id} item={item} />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function HistoryItem({ item }: { item: typeof MOCK_HISTORY[0] }) {
  const statusConfig = {
    confirmed: { color: colors.safe, label: 'Confirmed' },
    snoozed: { color: colors.pending, label: 'Snoozed' },
    missed: { color: colors.alert, label: 'Missed' },
  };

  const config = statusConfig[item.status as keyof typeof statusConfig];

  return (
    <View style={styles.historyItem}>
      <View style={styles.historyLeft}>
        <View style={[styles.statusIndicator, { backgroundColor: config.color }]} />
        <View>
          <Text style={styles.historyDate}>{item.date}</Text>
          <Text style={styles.historyTime}>{item.time}</Text>
        </View>
      </View>
      <View style={styles.historyRight}>
        <Text style={[styles.historyStatus, { color: config.color }]}>
          {config.label}
        </Text>
        <Text style={styles.historyMethod}>via {item.method}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.text,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  historyDate: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.text,
  },
  historyTime: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  historyRight: {
    alignItems: 'flex-end',
  },
  historyStatus: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  historyMethod: {
    fontSize: fontSize.xs,
    color: colors.textLight,
  },
});
