import { describe, expect, it } from 'vitest';
import { CHANNEL_PROFILE_OPTIONS } from './channelProfiles';

describe('channel profile options', () => {
  it('uses voice as the SMS profile fallback', () => {
    expect(CHANNEL_PROFILE_OPTIONS.find((option) => option.value === 'SMS')).toMatchObject({
      primaryChannel: 'SMS',
      fallbackChannels: ['VOICE'],
    });
  });
});
