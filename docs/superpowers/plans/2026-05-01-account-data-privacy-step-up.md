# Account Data Privacy and Step-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend-owned OTP step-up, account data export, and account deletion endpoints, then wire the mobile Data & Privacy screen to those backend APIs.

**Architecture:** Add a focused `account` backend module with `StepUpService`, `AccountPrivacyService`, and repository boundaries. Store step-up challenges/tokens in Prisma, send OTP by SMS through `ChannelRouterService`, and require an action-scoped one-time step-up token for export/delete.

**Tech Stack:** NestJS, Prisma 7, PostgreSQL, Vitest, Expo Router, React Native, TypeScript.

---

## File Map

- Modify `apps/backend/prisma/schema.prisma`: add `SensitiveAction` enum and `StepUpChallenge` model.
- Create migration `apps/backend/prisma/migrations/202605010001_account_step_up/migration.sql`.
- Create `apps/backend/src/modules/account/account.tokens.ts`: repository token.
- Create `apps/backend/src/modules/account/account.repository.ts`: repository interfaces and DTO records.
- Create `apps/backend/src/modules/account/prisma-account.repository.ts`: Prisma persistence for step-up/export/delete.
- Create `apps/backend/src/modules/account/step-up.service.ts`: OTP challenge/token lifecycle.
- Create `apps/backend/src/modules/account/account-privacy.service.ts`: export/delete orchestration.
- Create `apps/backend/src/modules/account/account.controller.ts`: authenticated HTTP endpoints.
- Create `apps/backend/src/modules/account/account.module.ts`: Nest module wiring.
- Modify `apps/backend/src/app.module.ts`: import `AccountModule`.
- Modify `apps/backend/.env.example`: document no new required env vars; SMS uses existing Twilio config.
- Modify `apps/mobile/src/services/backendApi.ts`: add step-up/export/delete helpers.
- Modify `apps/mobile/src/services/userData.ts`: call backend helpers instead of Supabase Edge Functions.
- Modify `apps/mobile/src/app/(main)/settings/data-privacy.tsx`: collect OTP and call step-up flow.
- Modify `docs/PROJECT_HANDOFF.md`: record completed account privacy step-up slice.

---

### Task 1: Prisma Step-Up Persistence

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/202605010001_account_step_up/migration.sql`

- [ ] **Step 1: Add schema enum and model**

In `apps/backend/prisma/schema.prisma`, add:

```prisma
enum SensitiveAction {
  EXPORT_DATA
  DELETE_ACCOUNT
}
```

Add this model near `IdempotencyKey`:

```prisma
model StepUpChallenge {
  id              String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId          String          @db.Uuid
  action          SensitiveAction
  codeHash        String
  tokenHash       String?
  expiresAt       DateTime
  verifiedAt      DateTime?
  tokenExpiresAt  DateTime?
  consumedAt      DateTime?
  attemptCount    Int             @default(0)
  createdAt       DateTime        @default(now())

  user            User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, action, expiresAt])
  @@index([tokenHash])
  @@map("step_up_challenges")
}
```

Add to `User`:

```prisma
stepUpChallenges StepUpChallenge[]
```

- [ ] **Step 2: Add migration SQL**

Create `apps/backend/prisma/migrations/202605010001_account_step_up/migration.sql`:

```sql
CREATE TYPE "SensitiveAction" AS ENUM ('EXPORT_DATA', 'DELETE_ACCOUNT');

CREATE TABLE "step_up_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "action" "SensitiveAction" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "tokenHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "tokenExpiresAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "step_up_challenges_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "step_up_challenges"
ADD CONSTRAINT "step_up_challenges_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "step_up_challenges_userId_action_expiresAt_idx"
ON "step_up_challenges"("userId", "action", "expiresAt");

CREATE INDEX "step_up_challenges_tokenHash_idx"
ON "step_up_challenges"("tokenHash");
```

- [ ] **Step 3: Generate Prisma client and validate**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:generate
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
```

Expected: both pass.

---

### Task 2: Step-Up Service TDD

**Files:**
- Create: `apps/backend/src/modules/account/account.repository.ts`
- Create: `apps/backend/src/modules/account/step-up.service.ts`
- Test: `apps/backend/src/modules/account/step-up.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/backend/src/modules/account/step-up.service.spec.ts` with tests for:

```ts
import { Channel, SensitiveAction } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelRouterService } from '../channels/channel-router.service';
import type { AccountRepository, StepUpChallengeRecord } from './account.repository';
import { StepUpService } from './step-up.service';

class FakeAccountRepository implements AccountRepository {
  public challenges = new Map<string, StepUpChallengeRecord>();
  public tokenHashes = new Map<string, string>();

  async createStepUpChallenge(input: Omit<StepUpChallengeRecord, 'verifiedAt' | 'tokenHash' | 'tokenExpiresAt' | 'consumedAt' | 'attemptCount' | 'createdAt'>) {
    const record: StepUpChallengeRecord = { ...input, attemptCount: 0, createdAt: new Date('2026-05-01T10:00:00.000Z') };
    this.challenges.set(record.id, record);
    return record;
  }

  async findStepUpChallengeById(id: string) {
    return this.challenges.get(id) ?? null;
  }

  async incrementStepUpAttempts(id: string) {
    const record = this.challenges.get(id);
    if (!record) throw new Error('missing challenge');
    record.attemptCount += 1;
    return record;
  }

  async markStepUpVerified(input: { id: string; tokenHash: string; verifiedAt: Date; tokenExpiresAt: Date }) {
    const record = this.challenges.get(input.id);
    if (!record) throw new Error('missing challenge');
    Object.assign(record, input);
    this.tokenHashes.set(input.tokenHash, input.id);
    return record;
  }

  async consumeStepUpToken(input: { userId: string; action: SensitiveAction; tokenHash: string; consumedAt: Date }) {
    const id = this.tokenHashes.get(input.tokenHash);
    const record = id ? this.challenges.get(id) : null;
    if (!record || record.userId !== input.userId || record.action !== input.action || record.consumedAt) return null;
    if (!record.tokenExpiresAt || record.tokenExpiresAt <= input.consumedAt) return null;
    record.consumedAt = input.consumedAt;
    return record;
  }
}

describe('StepUpService', () => {
  let repository: FakeAccountRepository;
  let sent: Array<{ channel: Channel; to: string; code: string }>;
  let service: StepUpService;

  beforeEach(() => {
    repository = new FakeAccountRepository();
    sent = [];
    service = new StepUpService(
      repository,
      {
        sendMessage: async (channel, to, message) => {
          sent.push({ channel, to, code: message.variables.code });
          return { providerMessageId: 'sms-1', acceptedAt: new Date('2026-05-01T10:00:00.000Z'), providerStatus: 'accepted' };
        },
      } as Pick<ChannelRouterService, 'sendMessage'>,
      () => new Date('2026-05-01T10:00:00.000Z'),
      () => '123456',
      () => 'token-abc',
    );
  });

  it('creates a hashed OTP challenge and sends the code by SMS', async () => {
    const result = await service.requestStepUp({
      userId: 'user-1',
      action: SensitiveAction.EXPORT_DATA,
      phone: '+971501234567',
      language: 'en',
    });

    expect(result).toMatchObject({ ok: true, action: SensitiveAction.EXPORT_DATA });
    expect(result.challengeId).toBeTruthy();
    expect(result).not.toHaveProperty('code');
    expect(sent).toEqual([{ channel: Channel.SMS, to: '+971501234567', code: '123456' }]);
    expect(repository.challenges.get(result.challengeId)?.codeHash).not.toBe('123456');
  });

  it('verifies the code and returns a one-time token', async () => {
    const requested = await service.requestStepUp({
      userId: 'user-1',
      action: SensitiveAction.DELETE_ACCOUNT,
      phone: '+971501234567',
      language: 'en',
    });

    const verified = await service.verifyStepUp({
      userId: 'user-1',
      challengeId: requested.challengeId,
      code: '123456',
    });

    expect(verified).toMatchObject({ ok: true, action: SensitiveAction.DELETE_ACCOUNT, stepUpToken: 'token-abc' });
    expect(repository.challenges.get(requested.challengeId)?.tokenHash).not.toBe('token-abc');
  });

  it('rejects wrong codes and consumes valid tokens only once', async () => {
    const requested = await service.requestStepUp({
      userId: 'user-1',
      action: SensitiveAction.EXPORT_DATA,
      phone: '+971501234567',
      language: 'en',
    });

    await expect(service.verifyStepUp({ userId: 'user-1', challengeId: requested.challengeId, code: '000000' })).rejects.toThrow(
      'Invalid verification code',
    );
    const verified = await service.verifyStepUp({ userId: 'user-1', challengeId: requested.challengeId, code: '123456' });
    await expect(service.consumeStepUpToken({ userId: 'user-1', action: SensitiveAction.EXPORT_DATA, stepUpToken: verified.stepUpToken })).resolves.toBeUndefined();
    await expect(service.consumeStepUpToken({ userId: 'user-1', action: SensitiveAction.EXPORT_DATA, stepUpToken: verified.stepUpToken })).rejects.toThrow(
      'Step-up verification is required',
    );
  });
});
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/account/step-up.service.spec.ts
```

Expected: fail because account repository/service files are missing.

- [ ] **Step 3: Implement repository interfaces and service**

Create `account.repository.ts` with:

```ts
import type { SensitiveAction } from '@prisma/client';

export interface StepUpChallengeRecord {
  id: string;
  userId: string;
  action: SensitiveAction;
  codeHash: string;
  tokenHash?: string;
  expiresAt: Date;
  verifiedAt?: Date;
  tokenExpiresAt?: Date;
  consumedAt?: Date;
  attemptCount: number;
  createdAt: Date;
}

export interface AccountRepository {
  createStepUpChallenge(input: Omit<StepUpChallengeRecord, 'verifiedAt' | 'tokenHash' | 'tokenExpiresAt' | 'consumedAt' | 'attemptCount' | 'createdAt'>): Promise<StepUpChallengeRecord>;
  findStepUpChallengeById(id: string): Promise<StepUpChallengeRecord | null>;
  incrementStepUpAttempts(id: string): Promise<StepUpChallengeRecord>;
  markStepUpVerified(input: { id: string; tokenHash: string; verifiedAt: Date; tokenExpiresAt: Date }): Promise<StepUpChallengeRecord>;
  consumeStepUpToken(input: { userId: string; action: SensitiveAction; tokenHash: string; consumedAt: Date }): Promise<StepUpChallengeRecord | null>;
}
```

Create `step-up.service.ts` with SHA-256 hashing, 10-minute OTP expiry, 10-minute token expiry, 5 max attempts, SMS `account_step_up_otp` message, and exported methods:

```ts
requestStepUp(input: { userId: string; action: SensitiveAction; phone: string; language: string })
verifyStepUp(input: { userId: string; challengeId: string; code: string })
consumeStepUpToken(input: { userId: string; action: SensitiveAction; stepUpToken: string })
```

- [ ] **Step 4: Run service tests**

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/account/step-up.service.spec.ts
```

Expected: pass.

---

### Task 3: Account Privacy Service and Prisma Repository

**Files:**
- Modify: `apps/backend/src/modules/account/account.repository.ts`
- Create: `apps/backend/src/modules/account/prisma-account.repository.ts`
- Create: `apps/backend/src/modules/account/account-privacy.service.ts`
- Test: `apps/backend/src/modules/account/account-privacy.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

Create tests that assert:

- export consumes an `EXPORT_DATA` token and returns decrypted sender-owned records without hashes/ciphertext fields.
- delete consumes a `DELETE_ACCOUNT` token, anonymizes owned records, sets deleted timestamps, and appends `account.deleted`.
- wrong action token is rejected.

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/account/account-privacy.service.spec.ts
```

Expected: fail because privacy service is missing.

- [ ] **Step 2: Expand account repository interface**

Add records and methods:

```ts
export interface AccountExportRecord {
  user: {
    id: string;
    emailEncrypted: string;
    phoneEncrypted: string;
    country: string;
    preferredLanguage: string;
    timezone: string;
    createdAt: Date;
    updatedAt: Date;
  };
  receivers: Array<{
    id: string;
    nameEncrypted: string;
    phoneEncrypted: string;
    countryCode: string;
    relationshipType: string;
    language: string;
    timezone: string;
    techProfile: string;
    primaryChannel: string;
    fallbackChannels: string[];
    scheduleFrequency: string;
    scheduleTimeWindow: unknown;
    pausedUntil?: Date;
    pausedReason?: string;
    consentStatus: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  backupContacts: Array<{
    id: string;
    receiverId: string;
    nameEncrypted: string;
    phoneEncrypted: string;
    relationshipToReceiver: string;
    locationInstructionsEncrypted?: string;
    priorityOrder: number;
    createdAt: Date;
  }>;
  checkIns: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  escalations: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
}

export interface AccountDeletionResult {
  deletedAt: Date;
  receiverCount: number;
  backupContactCount: number;
}

export interface AccountRepository {
  // existing step-up methods...
  buildExport(userId: string): Promise<AccountExportRecord | null>;
  deleteAccountData(input: {
    userId: string;
    deletedAt: Date;
    anonymizedUserEmailEncrypted: string;
    anonymizedUserPhoneEncrypted: string;
    anonymizedUserEmailHash: string;
    anonymizedUserPhoneHash: string;
    anonymizedReceiverNameEncrypted: string;
    anonymizedReceiverPhoneEncrypted: string;
    anonymizedReceiverPhoneHash: string;
    anonymizedBackupNameEncrypted: string;
    anonymizedBackupPhoneEncrypted: string;
    anonymizedBackupPhoneHash: string;
  }): Promise<AccountDeletionResult | null>;
}
```

- [ ] **Step 3: Implement privacy service**

Create `AccountPrivacyService` with:

```ts
exportAccount(input: { userId: string; stepUpToken: string }): Promise<AccountExportResponse>
deleteAccount(input: { userId: string; stepUpToken: string; ipAddress?: string; userAgent?: string }): Promise<{ ok: true; deletedAt: string }>
```

Use `StepUpService.consumeStepUpToken`, `CryptoService.decrypt`, `CryptoService.encrypt`, `CryptoService.hashForLookup`, `AccountRepository`, and `AuditService`.

- [ ] **Step 4: Implement Prisma repository**

Create `prisma-account.repository.ts` implementing all account repository methods with Prisma queries scoped by `userId`.

- [ ] **Step 5: Run account privacy tests**

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/account/account-privacy.service.spec.ts src/modules/account/step-up.service.spec.ts
```

Expected: pass.

---

### Task 4: Account Controller and Module

**Files:**
- Create: `apps/backend/src/modules/account/account.tokens.ts`
- Create: `apps/backend/src/modules/account/account.controller.ts`
- Create: `apps/backend/src/modules/account/account.module.ts`
- Modify: `apps/backend/src/app.module.ts`
- Test: `apps/backend/src/modules/account/account.controller.spec.ts`

- [ ] **Step 1: Write failing controller tests**

Test endpoints:

- `requestStepUp` verifies bearer auth, resolves sender through `UsersService`, decrypts sender phone, and calls service.
- `verifyStepUp` verifies bearer auth and calls service.
- `exportAccount` requires `x-nearby-step-up-token`.
- `deleteAccount` requires `x-nearby-step-up-token`.

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/account/account.controller.spec.ts
```

Expected: fail because controller is missing.

- [ ] **Step 2: Implement controller**

Create endpoints:

```ts
@Post('step-up/request')
@Post('step-up/verify')
@Get('export')
@Delete()
```

Use route prefix `account`.

- [ ] **Step 3: Wire module**

Create module providers:

```ts
ACCOUNT_REPOSITORY -> PrismaAccountRepository
CryptoService via AppConfigService
StepUpService
AccountPrivacyService
AccountController
```

Import `AuthModule`, `UsersModule`, `AuditModule`, and `ChannelsModule`.

Add `AccountModule` to `AppModule`.

- [ ] **Step 4: Run backend tests/type-check**

Run:

```powershell
npm.cmd --prefix apps/backend test -- src/modules/account
npm.cmd --prefix apps/backend run type-check
```

Expected: pass.

---

### Task 5: Mobile Backend API and Data Privacy Flow

**Files:**
- Modify: `apps/mobile/src/services/backendApi.ts`
- Modify: `apps/mobile/src/services/userData.ts`
- Modify: `apps/mobile/src/app/(main)/settings/data-privacy.tsx`

- [ ] **Step 1: Add backend API helpers**

Add:

```ts
export type BackendSensitiveAction = 'EXPORT_DATA' | 'DELETE_ACCOUNT';

export async function requestAccountStepUp(action: BackendSensitiveAction): Promise<{ ok: true; challengeId: string; action: BackendSensitiveAction; expiresAt: string }>;
export async function verifyAccountStepUp(input: { challengeId: string; code: string }): Promise<{ ok: true; stepUpToken: string; action: BackendSensitiveAction; expiresAt: string }>;
export async function exportAccountData(stepUpToken: string): Promise<unknown>;
export async function deleteAccount(stepUpToken: string): Promise<{ ok: true; deletedAt: string }>;
```

- [ ] **Step 2: Replace Supabase Edge Function calls**

In `userData.ts`, route export/delete through the backend helpers. Keep `downloadUserData()` and `deleteUserAccount()` public signatures stable for the screen.

- [ ] **Step 3: Add OTP prompt flow**

In `data-privacy.tsx`, request step-up before export/delete and prompt for OTP using `Alert.prompt` on platforms that support it. For platforms without prompt, show a clear unsupported message until a dedicated OTP modal is added.

- [ ] **Step 4: Run mobile type-check**

Run:

```powershell
npm.cmd --prefix apps/mobile run type-check
```

Expected: pass.

---

### Task 6: Handoff and Full Verification

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`

- [ ] **Step 1: Add handoff section**

Append a section before production checklist:

```md
### 29d. Account data privacy and step-up - completed 2026-05-01

Completed backend-owned account data privacy foundation:

- Added OTP step-up challenge/token flow for `EXPORT_DATA` and `DELETE_ACCOUNT`.
- Added account export endpoint protected by action-scoped one-time step-up tokens.
- Added account deletion endpoint protected by action-scoped one-time step-up tokens.
- Mobile Data & Privacy actions now call the backend instead of legacy Supabase Edge Function hooks.
- Step-up OTP is sent by SMS through the existing channel provider path.

Verification:

```powershell
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/backend test -- src/modules/account
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
```
```

- [ ] **Step 2: Full verification**

Run:

```powershell
$env:DATABASE_URL='postgresql://user:password@localhost:5432/nearby'; npm.cmd --prefix apps/backend run prisma:validate
npm.cmd --prefix apps/backend test -- src/modules/account
npm.cmd --prefix apps/backend test
npm.cmd --prefix apps/backend run type-check
npm.cmd --prefix apps/mobile run type-check
git status --short --branch
```

Expected: all pass; only intended files changed.

- [ ] **Step 3: Commit**

Run:

```powershell
git add -A
git commit -m "Add account privacy step-up backend"
```
