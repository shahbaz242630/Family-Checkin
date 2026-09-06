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
        receiverName: 'Salma',
        senderDisplayName: 'Ahmed',
        personalNote: 'Take your pills at 8',
      },
    });

    expect(result).toEqual({
      providerMessageId: 'SM123',
      acceptedAt: new Date('2026-05-01T06:00:00.000Z'),
      providerStatus: 'queued',
      rendering: { language: 'en', fallback: false },
    });
    expect(httpClient.requests).toHaveLength(1);
    const [request] = httpClient.requests;
    expect(request?.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(Object.fromEntries(request?.body ?? new URLSearchParams())).toEqual({
      To: '+971501234567',
      From: '+15550001111',
      Body:
        'Hi Salma, Ahmed is checking in on you today. Their note: "Take your pills at 8" ' +
        "Reply YES if you're okay or HELP if you need help. Reply STOP to stop, REPORT to report.",
    });
    expect(request?.authToken).toBe('twilio-auth-token');
  });

  it('asks Twilio for delivery status callbacks on SMS and WhatsApp when the public API base URL is known (CB-016)', async () => {
    const smsClient = new FakeTwilioHttpClient({ sid: 'SM130', status: 'queued' });
    const sms = new SmsProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550001111',
        publicApiBaseUrl: 'https://api.nearby.test/',
      },
      smsClient,
    );
    const whatsappClient = new FakeTwilioHttpClient({ sid: 'SMWA130', status: 'queued' });
    const whatsapp = new WhatsappProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550002222',
        contentSidByTemplateKey: { checkin_daily: 'HX_CHECKIN' },
        publicApiBaseUrl: 'https://api.nearby.test',
      },
      whatsappClient,
    );
    const message = {
      templateKey: 'checkin_daily',
      language: 'en',
      variables: { receiverName: 'Salma', senderDisplayName: 'Ahmed' },
    };

    await sms.sendMessage('+971501234567', message);
    await whatsapp.sendMessage('+971501234567', message);

    expect(smsClient.requests[0]?.body.get('StatusCallback')).toBe(
      'https://api.nearby.test/provider-webhooks/twilio/messaging/status',
    );
    expect(whatsappClient.requests[0]?.body.get('StatusCallback')).toBe(
      'https://api.nearby.test/provider-webhooks/twilio/messaging/status',
    );
  });

  it('sends no StatusCallback when the public API base URL is not configured, so Twilio never posts to a guessed host', async () => {
    const httpClient = new FakeTwilioHttpClient({ sid: 'SM131', status: 'queued' });
    const provider = new SmsProvider(
      { accountSid: 'AC123', authToken: 'twilio-auth-token', fromNumber: '+15550001111' },
      httpClient,
    );

    await provider.sendMessage('+971501234567', {
      templateKey: 'checkin_daily',
      language: 'en',
      variables: { receiverName: 'Salma', senderDisplayName: 'Ahmed' },
    });

    expect(httpClient.requests[0]?.body.has('StatusCallback')).toBe(false);
  });

  it('sends the English copy with fallback recorded when the receiver language has no SMS copy yet', async () => {
    const httpClient = new FakeTwilioHttpClient({ sid: 'SM124', status: 'queued' });
    const provider = new SmsProvider(
      { accountSid: 'AC123', authToken: 'twilio-auth-token', fromNumber: '+15550001111' },
      httpClient,
      () => new Date('2026-05-01T06:00:00.000Z'),
    );

    const result = await provider.sendMessage('+971501234567', {
      templateKey: 'checkin_daily',
      language: 'ar',
      variables: { receiverName: 'Salma', senderDisplayName: 'Ahmed', personalNote: 'Call me after lunch' },
    });

    expect(result.rendering).toEqual({ language: 'en', fallback: true });
    const body = httpClient.requests[0]?.body.get('Body') ?? '';
    expect(body).toContain('Hi Salma, Ahmed is checking in on you today.');
    expect(body).toContain('Call me after lunch');
    expect(body).not.toContain('{{');
  });

  it('sends the step-up OTP as a sentence with the code and its validity', async () => {
    const httpClient = new FakeTwilioHttpClient({ sid: 'SM125', status: 'sent' });
    const provider = new SmsProvider(
      { accountSid: 'AC123', authToken: 'twilio-auth-token', fromNumber: '+15550001111' },
      httpClient,
      () => new Date('2026-05-01T06:00:00.000Z'),
    );

    await provider.sendMessage('+971501234567', {
      templateKey: 'account_step_up_otp',
      language: 'en',
      variables: { code: '482913', validityMinutes: '10' },
    });

    expect(httpClient.requests[0]?.body.get('Body')).toBe(
      'Your Nearby verification code is 482913. It is valid for 10 minutes. Do not share this code with anyone.',
    );
  });

  it('never calls Twilio when the SMS body cannot be rendered', async () => {
    const httpClient = new FakeTwilioHttpClient({ sid: 'SM126', status: 'queued' });
    const provider = new SmsProvider(
      { accountSid: 'AC123', authToken: 'twilio-auth-token', fromNumber: '+15550001111' },
      httpClient,
    );

    await expect(
      provider.sendMessage('+971501234567', { templateKey: 'checkin_daily', language: 'en', variables: {} }),
    ).rejects.toThrow('requires variable "receiverName"');
    expect(httpClient.requests).toEqual([]);
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
