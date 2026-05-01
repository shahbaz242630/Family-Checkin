# Dashboard and Operations Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing sender dashboard, receiver detail, and admin operations views accurately reflect full cascade state without adding new product systems.

**Architecture:** Keep backend data contracts unchanged except for mobile type alignment around existing `attempts`. Mobile will consume current receiver and operations APIs, rename local legacy concepts, and render cascade attempts as a first-class operational timeline. Legacy placeholder routes will be removed from active navigation or redirected to real screens without touching protected auth files.

**Tech Stack:** Expo Router, React Native, TypeScript, NestJS, Prisma, Vitest.

---

## File Map

- Modify `apps/mobile/src/services/backendApi.ts`: add `BackendCheckInAttemptStatus`, `BackendOperationsCheckInAttemptDetail`, and `attempts` on `BackendOperationsCheckInDetail`.
- Modify `apps/mobile/src/utils/adminOperations.ts`: add labels for cascade attempt statuses and provider failure reasons.
- Modify `apps/mobile/src/utils/adminOperations.spec.ts`: cover `NEEDS_ATTENTION` ordering and attempt status labels.
- Modify `apps/mobile/src/hooks/useLovedOnes.ts`: rename exported local concepts to receiver terminology while keeping data mapping to `listReceivers`.
- Modify `apps/mobile/src/hooks/index.ts`: export the renamed receiver hook/types.
- Modify `apps/mobile/src/app/(main)/index.tsx`: replace loved-one labels/icons with receiver/check-in copy and use the renamed hook.
- Modify `apps/mobile/src/app/(main)/receivers/[id].tsx`: include `NEEDS_ATTENTION` in action eligibility and add a clear latest-check-in action panel.
- Modify `apps/mobile/src/app/(main)/admin-operations/[checkInId].tsx`: render cascade attempts above backup escalation attempts.
- Modify `apps/mobile/src/components/layout/Sidebar.tsx`: remove active links to stale placeholder pages and use Nearby/receiver terminology.
- Modify `apps/mobile/src/app/(main)/_layout.tsx`: remove stale placeholder stack screens from active registration where safe.
- Modify `apps/mobile/src/app/(main)/loved-ones.tsx`, `apps/mobile/src/app/(main)/check-ins.tsx`, `apps/mobile/src/app/(main)/escalations.tsx`, and `apps/mobile/src/app/(main)/pairing.tsx`: convert to redirects to real screens or remove from active navigation.
- Modify `docs/PROJECT_HANDOFF.md`: record completed cascade and dashboard/operations hardening.

---

### Task 1: Mobile Operations Attempt Types and Formatters

**Files:**
- Modify: `apps/mobile/src/services/backendApi.ts`
- Modify: `apps/mobile/src/utils/adminOperations.ts`
- Test: `apps/mobile/src/utils/adminOperations.spec.ts`

- [ ] **Step 1: Write failing formatter tests**

Add attempt status assertions to `apps/mobile/src/utils/adminOperations.spec.ts`:

```ts
import {
  attemptStatusLabel,
  escalationResultLabel,
  failureReasonLabel,
  formatOperationsDateTime,
  operationsStatusLabel,
  sortStatusCounts,
} from './adminOperations';

it('maps cascade attempt statuses and failure reasons to readable labels', () => {
  expect(attemptStatusLabel('PENDING')).toBe('Scheduled');
  expect(attemptStatusLabel('SENT')).toBe('Sent');
  expect(attemptStatusLabel('RESPONDED')).toBe('Responded');
  expect(attemptStatusLabel('FAILED')).toBe('Failed');
  expect(attemptStatusLabel('TIMED_OUT')).toBe('Timed out');
  expect(attemptStatusLabel('SKIPPED')).toBe('Skipped');
  expect(failureReasonLabel('response_window_elapsed')).toBe('Response window elapsed');
  expect(failureReasonLabel('provider_send_failed')).toBe('Provider send failed');
  expect(failureReasonLabel(undefined)).toBe('None');
});

it('sorts needs-attention before failed and skipped operational states', () => {
  expect(sortStatusCounts({ SKIPPED: 1, NEEDS_ATTENTION: 2, FAILED: 3 }).map((item) => item.status)).toEqual([
    'NEEDS_ATTENTION',
    'FAILED',
    'SKIPPED',
  ]);
});
```

- [ ] **Step 2: Run formatter tests and confirm they fail**

Run:

```powershell
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
```

Expected: fail because `attemptStatusLabel` and `failureReasonLabel` are not exported.

- [ ] **Step 3: Add mobile operation attempt API types**

In `apps/mobile/src/services/backendApi.ts`, add:

```ts
export type BackendCheckInAttemptStatus = 'PENDING' | 'SENT' | 'RESPONDED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';

export interface BackendOperationsCheckInAttemptDetail {
  id: string;
  attemptNumber: number;
  channel: BackendChannel;
  status: BackendCheckInAttemptStatus;
  scheduledAt: string;
  sentAt?: string;
  completedAt?: string;
  providerStatus?: string;
  failureReason?: string;
}
```

Then add this field to `BackendOperationsCheckInDetail`:

```ts
attempts: BackendOperationsCheckInAttemptDetail[];
```

- [ ] **Step 4: Add formatter functions**

In `apps/mobile/src/utils/adminOperations.ts`, add:

```ts
export function attemptStatusLabel(status?: string): string {
  switch (status) {
    case 'PENDING':
      return 'Scheduled';
    case 'SENT':
      return 'Sent';
    case 'RESPONDED':
      return 'Responded';
    case 'FAILED':
      return 'Failed';
    case 'TIMED_OUT':
      return 'Timed out';
    case 'SKIPPED':
      return 'Skipped';
    default:
      return status ? operationsStatusLabel(status) : 'Unknown';
  }
}

export function failureReasonLabel(reason?: string): string {
  switch (reason) {
    case 'response_window_elapsed':
      return 'Response window elapsed';
    case 'provider_send_failed':
      return 'Provider send failed';
    case 'cascade_closed':
      return 'Check-in already closed';
    case 'superseded_by_response':
      return 'Receiver responded';
    default:
      return reason ? operationsStatusLabel(reason) : 'None';
  }
}
```

- [ ] **Step 5: Run formatter tests and type check**

Run:

```powershell
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
npm.cmd --prefix apps/mobile run type-check
```

Expected: both pass.

---

### Task 2: Admin Operations Detail Cascade Timeline

**Files:**
- Modify: `apps/mobile/src/app/(main)/admin-operations/[checkInId].tsx`
- Test: `apps/mobile/src/utils/adminOperations.spec.ts`

- [ ] **Step 1: Update imports**

In `apps/mobile/src/app/(main)/admin-operations/[checkInId].tsx`, update the formatter import:

```ts
import {
  attemptStatusLabel,
  escalationResultLabel,
  failureReasonLabel,
  formatOperationsDateTime,
  operationsStatusLabel,
} from '../../../utils/adminOperations';
```

- [ ] **Step 2: Add cascade attempts section above escalation attempts**

Insert this section before the current `Escalation Attempts` section:

```tsx
<View style={styles.section}>
  <Text style={styles.sectionTitle}>Cascade Attempts</Text>
  {detail.attempts.length > 0 ? (
    <View style={styles.escalationList}>
      {detail.attempts.map((attempt) => (
        <View key={attempt.id} style={styles.escalationItem}>
          <View style={styles.recentHeader}>
            <Text style={styles.statusText}>
              {attempt.channel} attempt {attempt.attemptNumber}
            </Text>
            <Text style={styles.attemptText}>{attemptStatusLabel(attempt.status)}</Text>
          </View>
          <InfoRow label="Scheduled" value={formatOperationsDateTime(attempt.scheduledAt)} />
          <InfoRow label="Sent" value={formatOperationsDateTime(attempt.sentAt)} />
          <InfoRow label="Completed" value={formatOperationsDateTime(attempt.completedAt)} />
          <InfoRow label="Provider status" value={attempt.providerStatus ?? 'Not reported'} />
          <InfoRow label="Failure reason" value={failureReasonLabel(attempt.failureReason)} />
        </View>
      ))}
    </View>
  ) : (
    <Text style={styles.emptyText}>No cascade attempts recorded.</Text>
  )}
</View>
```

- [ ] **Step 3: Rename backup section title**

Change:

```tsx
<Text style={styles.sectionTitle}>Escalation Attempts</Text>
```

to:

```tsx
<Text style={styles.sectionTitle}>Backup Escalation Attempts</Text>
```

- [ ] **Step 4: Run mobile type check**

Run:

```powershell
npm.cmd --prefix apps/mobile run type-check
```

Expected: pass with `detail.attempts` recognized from `BackendOperationsCheckInDetail`.

---

### Task 3: Sender Dashboard Naming Cleanup

**Files:**
- Modify: `apps/mobile/src/hooks/useLovedOnes.ts`
- Modify: `apps/mobile/src/hooks/index.ts`
- Modify: `apps/mobile/src/app/(main)/index.tsx`
- Modify: `apps/mobile/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Rename local hook exports while preserving implementation**

In `apps/mobile/src/hooks/useLovedOnes.ts`, rename:

```ts
export interface LovedOne {
```

to:

```ts
export interface ReceiverDashboardItem {
```

Rename `UseLovedOnesReturn` to:

```ts
interface UseReceiversReturn {
  receivers: ReceiverDashboardItem[];
  loading: boolean;
  error: Error | null;
  refreshReceivers: () => Promise<void>;
}
```

Rename `useLovedOnes()` to:

```ts
export function useReceivers(): UseReceiversReturn {
```

Rename state and return values:

```ts
const [receivers, setReceivers] = useState<ReceiverDashboardItem[]>([]);
...
setReceivers(receiversFromBackend.map(toReceiverDashboardItem));
...
return {
  receivers,
  loading,
  error,
  refreshReceivers: fetchReceivers,
};
```

Keep backwards-compatible exports at the bottom for any untouched imports:

```ts
export type LovedOne = ReceiverDashboardItem;
export const useLovedOnes = useReceivers;
```

- [ ] **Step 2: Rename mapper**

Rename:

```ts
function toLovedOne(receiver: BackendReceiverSummary): LovedOne {
```

to:

```ts
function toReceiverDashboardItem(receiver: BackendReceiverSummary): ReceiverDashboardItem {
```

- [ ] **Step 3: Update hook barrel**

In `apps/mobile/src/hooks/index.ts`, export the new names:

```ts
export { useReceivers, useLovedOnes } from './useLovedOnes';
export type { ReceiverDashboardItem, LovedOne } from './useLovedOnes';
```

- [ ] **Step 4: Update dashboard imports and copy**

In `apps/mobile/src/app/(main)/index.tsx`, change:

```ts
import { useProfile, useLovedOnes, LovedOne } from '../../hooks';
```

to:

```ts
import { useProfile, useReceivers, type ReceiverDashboardItem } from '../../hooks';
```

Change:

```ts
const { lovedOnes, loading, refreshLovedOnes } = useLovedOnes();
```

to:

```ts
const { receivers, loading, refreshReceivers } = useReceivers();
```

Change labels:

```tsx
title="Add receiver"
subtitle="Set up check-ins"
...
title="Review receivers"
subtitle="Latest check-in status"
...
{hasReceivers ? 'Receivers' : 'Status Overview'}
...
<Text style={styles.statusTitle}>No receivers yet</Text>
<Text style={styles.statusSubtitle}>Add your first receiver to start daily check-ins.</Text>
```

- [ ] **Step 5: Rename card component locally**

Rename `LovedOneCard` to `ReceiverCard`, its prop to:

```ts
interface ReceiverCardProps {
  receiver: ReceiverDashboardItem;
}
```

Inside the card, use `receiver` variable names but keep field reads unchanged.

- [ ] **Step 6: Update sidebar labels and active routes**

In `apps/mobile/src/components/layout/Sidebar.tsx`, replace `MENU_ITEMS` with:

```ts
const MENU_ITEMS = [
  { icon: 'H', label: 'Dashboard', path: '/(main)' },
  { icon: '+', label: 'Add receiver', path: '/(main)/receiver-setup' },
  { icon: 'O', label: 'Admin Operations', path: '/(main)/admin-operations' },
  { icon: '!', label: 'Abuse Reports', path: '/(main)/admin-abuse-reports' },
];
```

Change:

```tsx
<Text style={styles.logo}>Family Check-In</Text>
```

to:

```tsx
<Text style={styles.logo}>Nearby</Text>
```

- [ ] **Step 7: Run mobile type check**

Run:

```powershell
npm.cmd --prefix apps/mobile run type-check
```

Expected: pass.

---

### Task 4: Receiver Detail NEEDS_ATTENTION Action Panel

**Files:**
- Modify: `apps/mobile/src/app/(main)/receivers/[id].tsx`
- Test: `apps/mobile/src/utils/receiverStatus.ts`

- [ ] **Step 1: Update action eligibility arrays**

In `apps/mobile/src/app/(main)/receivers/[id].tsx`, replace the three boolean definitions with:

```ts
const latestStatus = receiver.latestCheckIn?.status ?? '';
const needsAttention = latestStatus === 'NEEDS_ATTENTION';
const canResolveLatestCheckIn = ['RESPONDED_HELP', 'ESCALATED', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(latestStatus);
const canAlertBackupForLatestCheckIn = ['RESPONDED_HELP', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(latestStatus);
const canTryLatestCheckInLater = ['SENT', 'RESPONDED_HELP', 'NEEDS_ATTENTION', 'FAILED', 'SKIPPED'].includes(latestStatus);
```

- [ ] **Step 2: Add clear latest check-in summary text**

Inside the `Latest Check-in` section, above the first `InfoRow`, add:

```tsx
{needsAttention ? (
  <View style={styles.attentionPanel}>
    <Text style={styles.attentionTitle}>Receiver did not respond</Text>
    <Text style={styles.attentionText}>
      Nearby tried the available check-in channels. Choose whether to retry, alert backup contacts, or close this check-in.
    </Text>
  </View>
) : null}
```

- [ ] **Step 3: Add styles**

Add these styles:

```ts
attentionPanel: {
  borderWidth: 1,
  borderColor: colors.warning,
  borderRadius: borderRadius.md,
  backgroundColor: colors.warning + '12',
  padding: spacing.md,
  marginBottom: spacing.md,
},
attentionTitle: {
  color: colors.text,
  fontSize: fontSize.sm,
  fontWeight: '700',
  marginBottom: spacing.xs,
},
attentionText: {
  color: colors.textSecondary,
  fontSize: fontSize.sm,
  lineHeight: 20,
},
```

- [ ] **Step 4: Run mobile type check**

Run:

```powershell
npm.cmd --prefix apps/mobile run type-check
```

Expected: pass.

---

### Task 5: Legacy Route Cleanup

**Files:**
- Modify: `apps/mobile/src/app/(main)/_layout.tsx`
- Modify: `apps/mobile/src/app/(main)/loved-ones.tsx`
- Modify: `apps/mobile/src/app/(main)/check-ins.tsx`
- Modify: `apps/mobile/src/app/(main)/escalations.tsx`
- Modify: `apps/mobile/src/app/(main)/pairing.tsx`

- [ ] **Step 1: Remove stale screens from active stack list**

In `apps/mobile/src/app/(main)/_layout.tsx`, remove:

```tsx
<Stack.Screen name="loved-ones" />
<Stack.Screen name="check-ins" />
<Stack.Screen name="escalations" />
<Stack.Screen name="pairing" />
```

Keep:

```tsx
<Stack.Screen name="index" />
<Stack.Screen name="admin-abuse-reports" />
<Stack.Screen name="admin-operations" />
<Stack.Screen name="admin-operations/[checkInId]" />
<Stack.Screen name="receiver-setup" />
<Stack.Screen name="receivers/[id]" />
<Stack.Screen name="settings" />
```

- [ ] **Step 2: Convert stale route pages to redirects**

Replace each stale page body with a redirect:

```tsx
import { Redirect } from 'expo-router';

export default function LegacyRouteRedirect() {
  return <Redirect href="/(main)" />;
}
```

Use this in:

- `apps/mobile/src/app/(main)/loved-ones.tsx`
- `apps/mobile/src/app/(main)/check-ins.tsx`
- `apps/mobile/src/app/(main)/escalations.tsx`
- `apps/mobile/src/app/(main)/pairing.tsx`

- [ ] **Step 3: Run mobile type check**

Run:

```powershell
npm.cmd --prefix apps/mobile run type-check
```

Expected: pass.

---

### Task 6: Handoff and Verification

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] **Step 1: Add handoff entry**

Append a new section before `### 30. Production readiness checklist`:

```md
### 29c. Dashboard and operations hardening - completed 2026-05-01

Completed existing-surface hardening after full cascade correctness:

- Sender dashboard uses receiver terminology instead of legacy loved-one labels.
- Sidebar active navigation now points only at real Nearby receiver/admin surfaces.
- Legacy placeholder routes redirect to the main dashboard.
- Receiver detail shows `NEEDS_ATTENTION` as an actionable state with retry, backup alert, and resolve choices.
- Admin operations detail shows receiver cascade attempts separately from backup escalation attempts.
- Mobile operation types include cascade attempt records from the backend detail endpoint.
- Admin operations formatting includes attempt statuses and operational failure reasons.

Verification:

```powershell
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
```
```

- [ ] **Step 2: Run full verification**

Run:

```powershell
npx vitest run apps/mobile/src/utils/adminOperations.spec.ts
npm.cmd --prefix apps/mobile run type-check
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/backend test
git status --short --branch
```

Expected:

- mobile formatter tests pass
- mobile type check passes
- backend type check passes
- backend suite passes
- only intended files are modified

- [ ] **Step 3: Commit**

Run:

```powershell
git add apps/mobile/src/services/backendApi.ts apps/mobile/src/utils/adminOperations.ts apps/mobile/src/utils/adminOperations.spec.ts apps/mobile/src/hooks/useLovedOnes.ts apps/mobile/src/hooks/index.ts apps/mobile/src/app/(main)/index.tsx apps/mobile/src/app/(main)/receivers/[id].tsx apps/mobile/src/app/(main)/admin-operations/[checkInId].tsx apps/mobile/src/components/layout/Sidebar.tsx apps/mobile/src/app/(main)/_layout.tsx apps/mobile/src/app/(main)/loved-ones.tsx apps/mobile/src/app/(main)/check-ins.tsx apps/mobile/src/app/(main)/escalations.tsx apps/mobile/src/app/(main)/pairing.tsx docs/PROJECT_HANDOFF.md
git commit -m "Harden dashboard and operations cascade views"
```

Expected: commit succeeds with only dashboard/operations hardening files.

