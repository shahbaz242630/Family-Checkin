import { Channel } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  FakeOutboundRecorder,
  formatFakeOutboundLine,
  maskPhoneForLog,
  type FakeOutboundRecord,
} from './fake-outbound-recorder';

function messageRecord(overrides: Partial<Extract<FakeOutboundRecord, { kind: 'message' }>> = {}) {
  return {
    kind: 'message' as const,
    at: '2026-09-06T10:00:00.000Z',
    channel: Channel.SMS,
    to: '+447400123401',
    providerMessageId: 'fake-SMS-message-1',
    templateKey: 'checkin_daily',
    language: 'en',
    fallback: false,
    body: 'Hi Margaret, your family member is checking in on you today.',
    ...overrides,
  };
}

describe('FakeOutboundRecorder', () => {
  it('prints one line per send with the fake-provider prefix, a masked phone and the rendered body', () => {
    const lines: string[] = [];
    const recorder = new FakeOutboundRecorder({ log: (line) => lines.push(line) });

    recorder.record(messageRecord());
    recorder.record({
      kind: 'voice_call',
      at: '2026-09-06T10:30:00.000Z',
      channel: Channel.VOICE,
      to: '+447400123401',
      providerCallId: 'fake-VOICE-call-1',
      scriptKey: 'checkin_daily_voice',
      language: 'en',
      variables: { receiverDisplayName: 'Margaret' },
    });

    expect(lines).toEqual([
      '[fake-provider] SMS message to ***3401 (checkin_daily, en) fake-SMS-message-1: ' +
        '"Hi Margaret, your family member is checking in on you today."',
      '[fake-provider] VOICE call to ***3401 (checkin_daily_voice, en) fake-VOICE-call-1 variables ' +
        '{"receiverDisplayName":"Margaret"}',
    ]);
    expect(lines.join('\n')).not.toContain('+447400123401');
  });

  it('flags an English fallback in the line so a missing translation is visible in the terminal', () => {
    expect(formatFakeOutboundLine(messageRecord({ language: 'ar', fallback: true, body: 'x' }))).toBe(
      '[fake-provider] SMS message to ***3401 (checkin_daily, ar, english fallback) fake-SMS-message-1: "x"',
    );
  });

  it('returns the newest records first and honours the limit', () => {
    const recorder = new FakeOutboundRecorder({ log: () => undefined });

    for (let index = 1; index <= 5; index += 1) {
      recorder.record(messageRecord({ providerMessageId: `fake-SMS-message-${index}` }));
    }

    expect(recorder.size).toBe(5);
    expect(recorder.recent(2).map((record) => (record as { providerMessageId: string }).providerMessageId)).toEqual([
      'fake-SMS-message-5',
      'fake-SMS-message-4',
    ]);
    expect(recorder.recent()).toHaveLength(5);
    expect(recorder.recent(0)).toEqual([]);
  });

  it('drops the oldest records once the capacity is reached', () => {
    const recorder = new FakeOutboundRecorder({ capacity: 2, log: () => undefined });

    recorder.record(messageRecord({ providerMessageId: 'fake-SMS-message-1' }));
    recorder.record(messageRecord({ providerMessageId: 'fake-SMS-message-2' }));
    recorder.record(messageRecord({ providerMessageId: 'fake-SMS-message-3' }));

    expect(recorder.size).toBe(2);
    expect(recorder.recent().map((record) => (record as { providerMessageId: string }).providerMessageId)).toEqual([
      'fake-SMS-message-3',
      'fake-SMS-message-2',
    ]);

    recorder.clear();
    expect(recorder.size).toBe(0);
  });

  it('masks every phone shape to its last four digits and leaves short values alone', () => {
    expect(maskPhoneForLog('+971501234567')).toBe('***4567');
    expect(maskPhoneForLog('whatsapp:+971501234567')).toBe('***4567');
    expect(maskPhoneForLog('1234')).toBe('1234');
  });
});
