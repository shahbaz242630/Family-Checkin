import { describe, expect, it } from 'vitest';
import { SmsProvider } from './sms.provider';
import { VoiceProvider } from './voice.provider';
import { WhatsappProvider } from './whatsapp.provider';

class FakeTwilioHttpClient {
  public requests: Array<{ url: string; body: URLSearchParams; authToken: string }> = [];

  constructor(private readonly response: Record<string, unknown>) {}

  async postForm(url: string, body: URLSearchParams, authToken: string): Promise<Record<string, unknown>> {
    this.requests.push({ url, body, authToken });
    return this.response;
  }
}

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

  it('sends SMS messages through the Twilio Messages API', async () => {
    const httpClient = new FakeTwilioHttpClient({
      sid: 'SM123',
      status: 'queued',
    });
    const provider = new SmsProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550001111',
      },
      httpClient,
      () => new Date('2026-05-01T06:00:00.000Z'),
    );

    const result = await provider.sendMessage('+971501234567', {
      templateKey: 'checkin_daily',
      language: 'en',
      variables: {
        receiverDisplayName: 'Salma',
      },
    });

    expect(result).toEqual({
      providerMessageId: 'SM123',
      acceptedAt: new Date('2026-05-01T06:00:00.000Z'),
      providerStatus: 'queued',
    });
    expect(httpClient.requests).toHaveLength(1);
    const [request] = httpClient.requests;
    expect(request?.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(Object.fromEntries(request?.body ?? new URLSearchParams())).toEqual({
      To: '+971501234567',
      From: '+15550001111',
      Body: 'checkin_daily\nreceiverDisplayName: Salma',
    });
    expect(request?.authToken).toBe('twilio-auth-token');
  });

  it('sends WhatsApp messages through Twilio approved content templates', async () => {
    const httpClient = new FakeTwilioHttpClient({
      sid: 'SMWA123',
      status: 'sent',
    });
    const provider = new WhatsappProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550002222',
        contentSidByTemplateKey: {
          'consent_request:en': 'HX_CONSENT_EN',
        },
      },
      httpClient,
      () => new Date('2026-05-01T06:01:00.000Z'),
    );

    const result = await provider.sendMessage('+971501234568', {
      templateKey: 'consent_request',
      language: 'en',
      variables: {
        senderDisplayName: 'Ahmed',
      },
    });

    expect(result).toEqual({
      providerMessageId: 'SMWA123',
      acceptedAt: new Date('2026-05-01T06:01:00.000Z'),
      providerStatus: 'sent',
    });
    const [request] = httpClient.requests;
    expect(Object.fromEntries(request?.body ?? new URLSearchParams())).toEqual({
      To: 'whatsapp:+971501234568',
      From: 'whatsapp:+15550002222',
      ContentSid: 'HX_CONSENT_EN',
      ContentVariables: JSON.stringify({ senderDisplayName: 'Ahmed' }),
    });
  });

  it('fails clearly when a WhatsApp content template SID is not configured', async () => {
    const provider = new WhatsappProvider({
      accountSid: 'AC123',
      authToken: 'twilio-auth-token',
      fromNumber: '+15550002222',
      contentSidByTemplateKey: {},
    });

    await expect(
      provider.sendMessage('+971501234568', {
        templateKey: 'checkin_daily',
        language: 'en',
        variables: {},
      }),
    ).rejects.toThrow('WhatsApp content template is not configured for checkin_daily:en');
  });

  it('starts Twilio voice calls with hosted WAV prompts, no-input repeat, AMD, and status callbacks', async () => {
    const httpClient = new FakeTwilioHttpClient({
      sid: 'CA123',
      status: 'ringing',
    });
    const provider = new VoiceProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550003333',
        publicApiBaseUrl: 'https://api.nearby.test',
        voiceAudioBaseUrl: 'https://cdn.nearby.test/voice',
      },
      httpClient,
      () => new Date('2026-05-01T06:02:00.000Z'),
    );

    const result = await provider.makeVoiceCall('+971501234569', {
      scriptKey: 'checkin_daily_voice',
      language: 'en',
      variables: {},
    });

    expect(result).toEqual({
      providerCallId: 'CA123',
      acceptedAt: new Date('2026-05-01T06:02:00.000Z'),
      providerStatus: 'ringing',
    });
    const [request] = httpClient.requests;
    expect(Object.fromEntries(request?.body ?? new URLSearchParams())).toEqual({
      To: '+971501234569',
      From: '+15550003333',
      MachineDetection: 'Enable',
      AsyncAmd: 'true',
      AsyncAmdStatusCallback: 'https://api.nearby.test/provider-webhooks/twilio/voice/amd',
      AsyncAmdStatusCallbackMethod: 'POST',
      StatusCallback: 'https://api.nearby.test/provider-webhooks/twilio/voice/status',
      StatusCallbackEvent: 'initiated ringing answered completed',
      StatusCallbackMethod: 'POST',
      Twiml:
        '<Response><Gather input="dtmf" numDigits="1" timeout="10" action="https://api.nearby.test/provider-webhooks/twilio/voice" method="POST"><Play>https://cdn.nearby.test/voice/en/checkin_daily_voice.wav</Play></Gather><Gather input="dtmf" numDigits="1" timeout="10" action="https://api.nearby.test/provider-webhooks/twilio/voice" method="POST"><Play>https://cdn.nearby.test/voice/en/checkin_daily_voice.wav</Play></Gather><Hangup/></Response>',
    });
  });

  it('falls back to English voice prompts when the script language is not a supported asset language', async () => {
    const httpClient = new FakeTwilioHttpClient({
      sid: 'CA124',
      status: 'queued',
    });
    const provider = new VoiceProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550003333',
        publicApiBaseUrl: 'https://api.nearby.test/',
        voiceAudioBaseUrl: 'https://cdn.nearby.test/voice/',
      },
      httpClient,
      () => new Date('2026-05-01T06:03:00.000Z'),
    );

    await provider.makeVoiceCall('+971501234569', {
      scriptKey: 'checkin_daily_voice',
      language: 'fr-CA',
      variables: {},
    });

    const [request] = httpClient.requests;
    expect(request?.body.get('Twiml')).toContain('https://cdn.nearby.test/voice/en/checkin_daily_voice.wav');
  });

  it('uses a per-call voice caller ID override when one is provided', async () => {
    const httpClient = new FakeTwilioHttpClient({
      sid: 'CA125',
      status: 'queued',
    });
    const provider = new VoiceProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550003333',
        publicApiBaseUrl: 'https://api.nearby.test',
        voiceAudioBaseUrl: 'https://cdn.nearby.test/voice',
      },
      httpClient,
      () => new Date('2026-05-01T06:04:00.000Z'),
    );

    await provider.makeVoiceCall(
      '+971501234569',
      {
        scriptKey: 'checkin_daily_voice',
        language: 'en',
        variables: {},
      },
      { fromNumber: '+15559990000' },
    );

    const [request] = httpClient.requests;
    expect(request?.body.get('From')).toBe('+15559990000');
  });
});
