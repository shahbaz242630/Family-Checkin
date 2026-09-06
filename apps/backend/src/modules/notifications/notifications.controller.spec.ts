import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { NotificationsController } from './notifications.controller';
import { INVALID_PUSH_TOKEN_MESSAGE } from './notifications.service';
import type { RegisterDeviceTokenInput } from './notifications.service';

function fixture() {
  const registered: RegisterDeviceTokenInput[] = [];
  const controller = new NotificationsController(
    {
      verifyAccessToken: async (token: string) => ({ id: `auth-${token}`, email: 'sender@example.com' }),
    } as never,
    { upsertFromSupabaseIdentity: async () => ({ id: 'sender-1' }) } as never,
    {
      registerDeviceToken: async (input: RegisterDeviceTokenInput) => {
        if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(input.token)) {
          throw new Error(INVALID_PUSH_TOKEN_MESSAGE);
        }
        registered.push(input);
        return {
          id: 'device-token-1',
          platform: input.platform,
          active: true,
          registeredAt: '2026-09-06T10:00:00.000Z',
        };
      },
    } as never,
  );

  return { controller, registered };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (caught: unknown) => caught,
  );
}

describe('NotificationsController (CB-023)', () => {
  it('registers a token for each supported platform', async () => {
    const { controller, registered } = fixture();

    for (const platform of ['ios', 'android', 'web']) {
      await expect(
        controller.register('Bearer access-token', '203.0.113.10', 'Nearby Mobile/1.0', {
          token: 'ExpoPushToken[abc]',
          platform,
          deviceId: 'device-1',
        }),
      ).resolves.toEqual({
        deviceToken: { id: 'device-token-1', platform, active: true, registeredAt: '2026-09-06T10:00:00.000Z' },
      });
    }
    expect(registered.map((input) => input.platform)).toEqual(['ios', 'android', 'web']);
    expect(registered[0]).toMatchObject({
      userId: 'sender-1',
      ipAddress: '203.0.113.10',
      userAgent: 'Nearby Mobile/1.0',
    });
  });

  it('answers 400 for a platform outside ios, android, web, and for a missing one', async () => {
    const { controller, registered } = fixture();

    for (const platform of ['desktop', 'IOS', '', undefined, 7]) {
      const error = await rejectionOf(
        controller.register('Bearer access-token', undefined, undefined, {
          token: 'ExpoPushToken[abc]',
          platform: platform as never,
        }),
      );
      expect(error, String(platform)).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('platform must be one of ios, android, web');
    }
    expect(registered).toEqual([]);
  });

  it('answers 400, not 500, for a token that is not an Expo push token', async () => {
    const { controller } = fixture();

    const error = await rejectionOf(
      controller.register('Bearer access-token', undefined, undefined, { token: 'fcm-token', platform: 'android' }),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(INVALID_PUSH_TOKEN_MESSAGE);
  });

  it('requires a bearer token', async () => {
    const { controller } = fixture();

    await expect(
      controller.register(undefined, undefined, undefined, { token: 'ExpoPushToken[abc]', platform: 'ios' }),
    ).rejects.toThrow('Bearer token is required');
  });
});
