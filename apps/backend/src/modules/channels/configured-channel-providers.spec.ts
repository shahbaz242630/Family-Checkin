import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { InMemoryChannelTemplateRepository } from './channel-template.repository';
import { MessageCatalogService, MissingMessageVariableError } from './message-catalog.service';
import { NEUTRAL_SENDER_DISPLAY_NAME } from './message-catalog.templates';
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
        receiverName: 'Salma',
        senderDisplayName: 'Ahmed',
      },
    });

    expect(result).toEqual({
      providerMessageId: 'SMWA123',
      acceptedAt: new Date('2026-05-01T06:01:00.000Z'),
      providerStatus: 'sent',
      rendering: { language: 'en', fallback: false },
    });
    const [request] = httpClient.requests;
    // Numbered by first appearance in the plain English template: "Hi {{1}}, {{2}} asked Nearby…" (CB-020).
    expect(Object.fromEntries(request?.body ?? new URLSearchParams())).toEqual({
      To: 'whatsapp:+971501234568',
      From: 'whatsapp:+15550002222',
      ContentSid: 'HX_CONSENT_EN',
      ContentVariables: JSON.stringify({ '1': 'Salma', '2': 'Ahmed' }),
    });
  });

  describe('WhatsApp template variants and numbering (CB-020)', () => {
    const arabicCheckIn =
      'مرحباً {{receiverName}}، هذه رسالة من {{senderDisplayName}} للاطمئنان عليك اليوم.' +
      '{{#personalNote}} ملاحظة من {{senderDisplayName}}: "{{personalNote}}"{{/personalNote}} أرسل YES إذا كنت بخير.';
    const catalog = new MessageCatalogService(
      new InMemoryChannelTemplateRepository([
        { templateKey: 'checkin_daily', language: 'ar', channel: Channel.WHATSAPP, bodyText: arabicCheckIn },
      ]),
    );

    function whatsapp(contentSidByTemplateKey: Record<string, string>) {
      const httpClient = new FakeTwilioHttpClient({ sid: 'SMWA200', status: 'queued' });
      const provider = new WhatsappProvider(
        { accountSid: 'AC123', authToken: 'twilio-auth-token', fromNumber: '+15550002222', contentSidByTemplateKey },
        httpClient,
        () => new Date('2026-05-01T06:05:00.000Z'),
        catalog,
      );
      const sent = () => Object.fromEntries(httpClient.requests[0]?.body ?? new URLSearchParams());
      return { provider, httpClient, sent };
    }

    it('uses the +personalNote variant with a third placeholder when the note is present and approved', async () => {
      const { provider, sent } = whatsapp({
        'checkin_daily:en': 'HX_DAILY_EN',
        'checkin_daily+personalNote:en': 'HX_DAILY_NOTE_EN',
      });

      await provider.sendMessage('+971501234568', {
        templateKey: 'checkin_daily',
        language: 'en',
        variables: { receiverName: 'Salma', senderDisplayName: 'Ahmed', personalNote: 'Take your pills\nat 8' },
      });

      expect(sent()).toMatchObject({
        ContentSid: 'HX_DAILY_NOTE_EN',
        ContentVariables: JSON.stringify({ '1': 'Salma', '2': 'Ahmed', '3': 'Take your pills at 8' }),
      });
    });

    it('drops the note and uses the plain template when only that variant is approved', async () => {
      const { provider, sent } = whatsapp({ 'checkin_daily:en': 'HX_DAILY_EN' });

      await provider.sendMessage('+971501234568', {
        templateKey: 'checkin_daily',
        language: 'en',
        variables: { receiverName: 'Salma', senderDisplayName: 'Ahmed', personalNote: 'Take your pills at 8' },
      });

      expect(sent()).toMatchObject({
        ContentSid: 'HX_DAILY_EN',
        ContentVariables: JSON.stringify({ '1': 'Salma', '2': 'Ahmed' }),
      });
    });

    it('numbers the Arabic row by its own placeholder order and localises the neutral sender wording (CB-079)', async () => {
      const { provider, sent } = whatsapp({
        'checkin_daily:en': 'HX_DAILY_EN',
        'checkin_daily+personalNote:ar': 'HX_DAILY_NOTE_AR',
      });

      const result = await provider.sendMessage('+971501234568', {
        templateKey: 'checkin_daily',
        language: 'ar',
        variables: {
          receiverName: 'فاطمة',
          senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME,
          personalNote: 'خذي الدواء',
        },
      });

      expect(result.rendering).toEqual({ language: 'ar', fallback: false });
      expect(sent()).toMatchObject({
        ContentSid: 'HX_DAILY_NOTE_AR',
        ContentVariables: JSON.stringify({ '1': 'فاطمة', '2': 'أحد أفراد عائلتك', '3': 'خذي الدواء' }),
      });
    });

    it('falls back to the English template, with English neutral wording, when the language has none', async () => {
      const { provider, sent } = whatsapp({ checkin_daily: 'HX_DAILY_DEFAULT' });

      const result = await provider.sendMessage('+971501234568', {
        templateKey: 'checkin_daily',
        language: 'hi',
        variables: { receiverName: 'Salma', senderDisplayName: NEUTRAL_SENDER_DISPLAY_NAME },
      });

      expect(result.rendering).toEqual({ language: 'en', fallback: true });
      expect(sent()).toMatchObject({
        ContentSid: 'HX_DAILY_DEFAULT',
        ContentVariables: JSON.stringify({ '1': 'Salma', '2': 'your family member' }),
      });
    });

    it('never calls Twilio when a required variable is blank', async () => {
      const { provider, httpClient } = whatsapp({ 'checkin_daily:en': 'HX_DAILY_EN' });

      await expect(
        provider.sendMessage('+971501234568', {
          templateKey: 'checkin_daily',
          language: 'en',
          variables: { receiverName: 'Salma', senderDisplayName: '  ' },
        }),
      ).rejects.toThrow(MissingMessageVariableError);
      expect(httpClient.requests).toEqual([]);
    });

    it('fails clearly when a SID exists for a language that has no WhatsApp template row to number from', async () => {
      const { provider, httpClient } = whatsapp({
        'checkin_daily:ta': 'HX_DAILY_TA',
        'checkin_daily:en': 'HX_DAILY_EN',
      });

      await expect(
        provider.sendMessage('+971501234568', {
          templateKey: 'checkin_daily',
          language: 'ta',
          variables: { receiverName: 'Salma', senderDisplayName: 'Ahmed' },
        }),
      ).rejects.toThrow('checkin_daily:ta has a Content SID but no active channel_templates row');
      expect(httpClient.requests).toEqual([]);
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
        '<Response><Gather input="dtmf" numDigits="1" timeout="10" action="https://api.nearby.test/provider-webhooks/twilio/voice?lang=en" method="POST"><Play>https://cdn.nearby.test/voice/en/checkin_daily_voice.wav</Play></Gather><Gather input="dtmf" numDigits="1" timeout="10" action="https://api.nearby.test/provider-webhooks/twilio/voice?lang=en" method="POST"><Play>https://cdn.nearby.test/voice/en/checkin_daily_voice.wav</Play></Gather><Hangup/></Response>',
    });
  });

  it('plays the prompt from the receiver language folder and tells the Gather action that language (CB-022)', async () => {
    const httpClient = new FakeTwilioHttpClient({ sid: 'CA126', status: 'queued' });
    const provider = new VoiceProvider(
      {
        accountSid: 'AC123',
        authToken: 'twilio-auth-token',
        fromNumber: '+15550003333',
        publicApiBaseUrl: 'https://api.nearby.test',
        voiceAudioBaseUrl: 'https://cdn.nearby.test/voice',
      },
      httpClient,
    );

    await provider.makeVoiceCall('+971501234569', { scriptKey: 'checkin_daily_voice', language: 'ta', variables: {} });

    const twiml = httpClient.requests[0]?.body.get('Twiml') ?? '';
    expect(twiml).toContain('<Play>https://cdn.nearby.test/voice/ta/checkin_daily_voice.wav</Play>');
    expect(twiml).toContain('action="https://api.nearby.test/provider-webhooks/twilio/voice?lang=ta"');
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
    expect(request?.body.get('Twiml')).toContain('/provider-webhooks/twilio/voice?lang=en"');
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
