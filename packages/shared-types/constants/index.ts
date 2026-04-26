// App-wide constants

export const APP_CONFIG = {
  name: 'Family Check-In',
  version: '1.0.0',
  supportEmail: 'support@familycheckin.app',
} as const;

export const SUBSCRIPTION_PRICES = {
  free: 0,
  one_way: 9.99,
  two_way: 14.99,
  pro_family: 24.99,
} as const;

export const SUBSCRIPTION_FEATURES = {
  free: {
    maxLovedOnes: 1,
    channels: ['push'],
    twoWay: false,
  },
  one_way: {
    maxLovedOnes: 1,
    channels: ['push', 'whatsapp', 'sms'],
    twoWay: false,
  },
  two_way: {
    maxLovedOnes: 1,
    channels: ['push', 'whatsapp', 'sms'],
    twoWay: true,
  },
  pro_family: {
    maxLovedOnes: 5,
    channels: ['push', 'whatsapp', 'sms', 'voice'],
    twoWay: true,
  },
} as const;

export const RELATIONSHIP_LABELS = {
  en: {
    mother: 'Mother',
    father: 'Father',
    child: 'Child',
    partner: 'Partner',
    brother: 'Brother',
    sister: 'Sister',
    relative: 'Relative',
    other: 'Other',
  },
  ar: {
    mother: 'الأم',
    father: 'الأب',
    child: 'الطفل',
    partner: 'الشريك',
    brother: 'الأخ',
    sister: 'الأخت',
    relative: 'قريب',
    other: 'آخر',
  },
  ur: {
    mother: 'والدہ',
    father: 'والد',
    child: 'بچہ',
    partner: 'ساتھی',
    brother: 'بھائی',
    sister: 'بہن',
    relative: 'رشتہ دار',
    other: 'دیگر',
  },
} as const;

export const DEFAULT_ESCALATION_STEPS = [
  { channel: 'push', delay_min: 0 },
  { channel: 'whatsapp', delay_min: 10 },
  { channel: 'sms', delay_min: 20 },
  { channel: 'voice', delay_min: 30 },
] as const;

export const DEFAULT_GRACE_PERIOD_MINUTES = 30;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_INTERVAL_MINUTES = 10;

export const PAIRING_CODE_EXPIRY_MINUTES = 30;
export const PAIRING_CODE_LENGTH = 6;
