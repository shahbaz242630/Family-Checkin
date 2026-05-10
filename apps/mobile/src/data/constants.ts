// App constants - relationships, frequencies, country codes, etc.
import { COUNTRIES } from './countries';

export const RELATIONSHIPS = [
  { value: 'parent', label: 'Parent' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'child', label: 'Child' },
  { value: 'aunt_uncle', label: 'Aunt/Uncle' },
  { value: 'cousin', label: 'Cousin' },
  { value: 'friend', label: 'Close Friend' },
  { value: 'other', label: 'Other' },
] as const;

export const CHECKIN_FREQUENCIES = [
  { value: 'daily', label: 'Daily', description: 'Every day' },
  { value: 'every_2_days', label: 'Every 2 Days', description: 'Every other day' },
  { value: 'weekly', label: 'Weekly', description: 'Once a week' },
  { value: 'custom', label: 'Custom', description: 'Set your own schedule' },
] as const;

export const TIME_OF_DAY = [
  { value: 'morning', label: 'Morning', timeRange: '6:00 AM - 12:00 PM', defaultTime: '09:00' },
  { value: 'afternoon', label: 'Afternoon', timeRange: '12:00 PM - 6:00 PM', defaultTime: '14:00' },
  { value: 'evening', label: 'Evening', timeRange: '6:00 PM - 10:00 PM', defaultTime: '19:00' },
] as const;

export const CHECKIN_METHODS = [
  { value: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp message to their phone', icon: 'WA' },
  { value: 'sms', label: 'SMS', description: 'Text message to their phone', icon: 'SMS' },
  { value: 'voice', label: 'Voice call', description: 'Automated phone call', icon: 'TEL' },
] as const;

export const WAIT_TIMES = [
  { value: '30min', label: '30 minutes', minutes: 30 },
  { value: '1hour', label: '1 hour', minutes: 60 },
  { value: '2hours', label: '2 hours', minutes: 120 },
  { value: '4hours', label: '4 hours', minutes: 240 },
] as const;

export const ESCALATION_ACTIONS = [
  { value: 'try_later', label: 'Try later', description: 'Schedule another check-in attempt' },
  { value: 'alert_backup', label: 'Alert backup', description: 'Notify configured backup contacts' },
  { value: 'mark_resolved', label: 'Mark resolved', description: 'Close the check-in after sender review' },
] as const;

export { COUNTRIES };

export const COUNTRY_CODES = COUNTRIES.map((country) => ({
  code: country.dialCode,
  country: country.country,
  flag: country.isoCode,
}));

export const TRIAL_DAYS = 7;

export function getRelationshipLabel(value: string): string {
  return RELATIONSHIPS.find((relationship) => relationship.value === value)?.label || value;
}

export function getCountryByCode(code: string) {
  return COUNTRY_CODES.find((country) => country.code === code || country.flag === code.toUpperCase());
}
