import { Channel } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaChannelTemplateRepository } from './prisma-channel-template.repository';

describe('PrismaChannelTemplateRepository', () => {
  it('reads only the active row for the template key, language and channel', async () => {
    const findFirst = vi.fn().mockResolvedValue({ bodyText: 'Hi {{receiverName}}' });
    const repository = new PrismaChannelTemplateRepository({ channelTemplate: { findFirst } });

    await expect(
      repository.findActive({ templateKey: 'checkin_daily', language: 'ar', channel: Channel.SMS }),
    ).resolves.toEqual({ bodyText: 'Hi {{receiverName}}' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { templateKey: 'checkin_daily', language: 'ar', channel: Channel.SMS, active: true },
      select: { bodyText: true },
    });
  });

  it('returns null when no active row exists', async () => {
    const repository = new PrismaChannelTemplateRepository({
      channelTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      repository.findActive({ templateKey: 'checkin_daily', language: 'ar', channel: Channel.SMS }),
    ).resolves.toBeNull();
  });
});
