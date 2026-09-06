import { createHash, randomInt, randomUUID } from 'crypto';
import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { Channel, type SensitiveAction } from '@prisma/client';
import { ChannelRouterService } from '../channels/channel-router.service';
import type { AccountRepository, StepUpChallengeRecord } from './account.repository';
import { ACCOUNT_REPOSITORY } from './account.tokens';

const OTP_TTL_MINUTES = 10;
const TOKEN_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

@Injectable()
export class StepUpService {
  constructor(
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accountRepository: AccountRepository,
    @Inject(ChannelRouterService)
    private readonly channelRouter: Pick<ChannelRouterService, 'sendMessage'>,
    @Optional() private readonly now: () => Date = () => new Date(),
    @Optional() private readonly generateCode: () => string = () => randomInt(0, 1_000_000).toString().padStart(6, '0'),
    @Optional() private readonly generateToken: () => string = () => randomUUID(),
  ) {}

  async requestStepUp(input: {
    userId: string;
    action: SensitiveAction;
    phone: string;
    language: string;
  }): Promise<{ ok: true; challengeId: string; action: SensitiveAction; expiresAt: string }> {
    const createdAt = this.now();
    const code = this.generateCode();
    const challenge = await this.accountRepository.createStepUpChallenge({
      id: randomUUID(),
      userId: input.userId,
      action: input.action,
      codeHash: this.hashSecret(code),
      expiresAt: this.addMinutes(createdAt, OTP_TTL_MINUTES),
    });

    await this.channelRouter.sendMessage(Channel.SMS, input.phone, {
      templateKey: 'account_step_up_otp',
      language: input.language,
      variables: {
        code,
        validityMinutes: String(OTP_TTL_MINUTES),
      },
    });

    return {
      ok: true,
      challengeId: challenge.id,
      action: challenge.action,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async verifyStepUp(input: {
    userId: string;
    challengeId: string;
    code: string;
  }): Promise<{ ok: true; stepUpToken: string; action: SensitiveAction; expiresAt: string }> {
    const now = this.now();
    const challenge = await this.accountRepository.findStepUpChallengeById(input.challengeId);

    this.assertChallengeUsable(challenge, input.userId, now);

    if (challenge.codeHash !== this.hashSecret(input.code.trim())) {
      await this.accountRepository.incrementStepUpAttempts(challenge.id);
      throw new ForbiddenException('Invalid verification code');
    }

    const stepUpToken = this.generateToken();
    const tokenExpiresAt = this.addMinutes(now, TOKEN_TTL_MINUTES);
    await this.accountRepository.markStepUpVerified({
      id: challenge.id,
      tokenHash: this.hashSecret(stepUpToken),
      verifiedAt: now,
      tokenExpiresAt,
    });

    return {
      ok: true,
      stepUpToken,
      action: challenge.action,
      expiresAt: tokenExpiresAt.toISOString(),
    };
  }

  async consumeStepUpToken(input: { userId: string; action: SensitiveAction; stepUpToken: string }): Promise<void> {
    const consumed = await this.accountRepository.consumeStepUpToken({
      userId: input.userId,
      action: input.action,
      tokenHash: this.hashSecret(input.stepUpToken.trim()),
      consumedAt: this.now(),
    });

    if (!consumed) {
      throw new ForbiddenException('Step-up verification is required');
    }
  }

  private assertChallengeUsable(
    challenge: StepUpChallengeRecord | null,
    userId: string,
    now: Date,
  ): asserts challenge is StepUpChallengeRecord {
    if (!challenge || challenge.userId !== userId || challenge.consumedAt || challenge.verifiedAt) {
      throw new ForbiddenException('Step-up challenge is invalid');
    }

    if (challenge.expiresAt <= now) {
      throw new ForbiddenException('Step-up challenge expired');
    }

    if (challenge.attemptCount >= MAX_ATTEMPTS) {
      throw new ForbiddenException('Step-up challenge locked');
    }
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60_000);
  }
}
