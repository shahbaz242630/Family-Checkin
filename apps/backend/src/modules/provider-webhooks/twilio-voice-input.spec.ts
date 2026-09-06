import { describe, expect, it } from 'vitest';
import { TWILIO_VOICE_DIGIT_KEYWORDS, twilioVoiceReplyKeyword } from './twilio-voice-input';

describe('twilioVoiceReplyKeyword (CB-022)', () => {
  it.each([
    ['1', 'YES'],
    ['2', 'HELP'],
    ['9', 'STOP'],
  ])('maps digit %s to %s', (digits, keyword) => {
    expect(twilioVoiceReplyKeyword({ digits })).toBe(keyword);
  });

  it.each(['0', '3', '4', '5', '6', '7', '8', '*', '#', '19', '91'])('ignores digit %s', (digits) => {
    expect(twilioVoiceReplyKeyword({ digits })).toBeUndefined();
  });

  it('ignores an empty gather', () => {
    expect(twilioVoiceReplyKeyword({})).toBeUndefined();
    expect(twilioVoiceReplyKeyword({ digits: '', speechResult: '   ' })).toBeUndefined();
  });

  it('lets digits win over a transcript and trims either', () => {
    expect(twilioVoiceReplyKeyword({ digits: ' 9 ', speechResult: 'yes' })).toBe('STOP');
    expect(twilioVoiceReplyKeyword({ digits: '5', speechResult: 'yes' })).toBeUndefined();
    expect(twilioVoiceReplyKeyword({ speechResult: '  Stop  ' })).toBe('Stop');
  });

  it('exposes exactly the three announced digits', () => {
    expect(TWILIO_VOICE_DIGIT_KEYWORDS).toEqual({ '1': 'YES', '2': 'HELP', '9': 'STOP' });
  });
});
