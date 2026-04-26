import { describe, expect, it } from 'vitest';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

describe('configured channel providers', () => {
  it('fail clearly until SMS credentials are configured', async () => {
    const provider = new SmsProvider({});

    await expect(
      provider.sendMessage('+971501234567', {
        templateKey: 'consent_request',
        language: 'en',
        variables: {},
      }),
    ).rejects.toThrow('SMS provider credentials are not configured');
  });

  it('fail clearly until WhatsApp credentials are configured', async () => {
    const provider = new WhatsappProvider({});

    await expect(
      provider.sendMessage('+971501234567', {
        templateKey: 'consent_request',
        language: 'en',
        variables: {},
      }),
    ).rejects.toThrow('WhatsApp provider credentials are not configured');
  });

  it('fail clearly until voice credentials are configured', async () => {
    const provider = new VoiceProvider({});

    await expect(
      provider.makeVoiceCall('+971501234567', {
        scriptKey: 'consent_request_voice',
        language: 'en',
        variables: {},
      }),
    ).rejects.toThrow('Voice provider credentials are not configured');
  });
});
