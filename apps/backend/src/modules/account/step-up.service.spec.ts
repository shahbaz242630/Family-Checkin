import { Channel, SensitiveAction } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelRouterService } from '../channels/channel-router.service';
import type { AccountRepository, StepUpChallengeRecord } from './account.repository';
import { StepUpService } from './step-up.service';

class FakeAccountRepository implements AccountRepository {
  public challenges = new Map<string, StepUpChallengeRecord>();
  public tokenHashes = new Map<string, string>();

  async createStepUpChallenge(
    input: Omit<
      StepUpChallengeRecord,
      'verifiedAt' | 'tokenHash' | 'tokenExpiresAt' | 'consumedAt' | 'attemptCount' | 'createdAt'
    >,
  ) {
    const record: StepUpChallengeRecord = {
      ...input,
      attemptCount: 0,
      createdAt: new Date('2026-05-01T10:00:00.000Z'),
    };
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

  async buildExport() {
    return null;
  }

  async deleteAccountData() {
    return null;
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
          sent.push({ channel, to, code: message.variables.code ?? '' });
          return {
            providerMessageId: 'sms-1',
            acceptedAt: new Date('2026-05-01T10:00:00.000Z'),
            providerStatus: 'accepted',
          };
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

    await expect(
      service.verifyStepUp({ userId: 'user-1', challengeId: requested.challengeId, code: '000000' }),
    ).rejects.toThrow('Invalid verification code');
    const verified = await service.verifyStepUp({
      userId: 'user-1',
      challengeId: requested.challengeId,
      code: '123456',
    });
    await expect(
      service.consumeStepUpToken({
        userId: 'user-1',
        action: SensitiveAction.EXPORT_DATA,
        stepUpToken: verified.stepUpToken,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.consumeStepUpToken({
        userId: 'user-1',
        action: SensitiveAction.EXPORT_DATA,
        stepUpToken: verified.stepUpToken,
      }),
    ).rejects.toThrow('Step-up verification is required');
  });
});
