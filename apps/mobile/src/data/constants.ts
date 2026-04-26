// App constants - relationships, frequencies, country codes, etc.

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
  { value: 'sms', label: 'SMS', description: 'Text message to their phone', icon: '💬' },
  { value: 'whatsapp', label: 'WhatsApp', description: 'WhatsApp message', icon: '📱' },
  { value: 'push', label: 'App Notification', description: 'Push notification (requires app)', icon: '🔔' },
] as const;

export const WAIT_TIMES = [
  { value: '30min', label: '30 minutes', minutes: 30 },
  { value: '1hour', label: '1 hour', minutes: 60 },
  { value: '2hours', label: '2 hours', minutes: 120 },
  { value: '4hours', label: '4 hours', minutes: 240 },
] as const;

export const ESCALATION_ACTIONS = [
  { value: 'notify_me', label: 'Notify me only', description: "I'll handle it myself" },
  { value: 'call_emergency', label: 'Call emergency contact', description: 'Notify my emergency contact' },
  { value: 'both', label: 'Both', description: 'Notify me and emergency contact' },
] as const;

export const COUNTRY_CODES = [
  // GCC Countries (Top priority)
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+965', country: 'Kuwait', flag: '🇰🇼' },
  { code: '+974', country: 'Qatar', flag: '🇶🇦' },
  { code: '+973', country: 'Bahrain', flag: '🇧🇭' },
  { code: '+968', country: 'Oman', flag: '🇴🇲' },

  // South Asia (Common expat origins)
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+92', country: 'Pakistan', flag: '🇵🇰' },
  { code: '+880', country: 'Bangladesh', flag: '🇧🇩' },
  { code: '+94', country: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+977', country: 'Nepal', flag: '🇳🇵' },

  // Southeast Asia
  { code: '+63', country: 'Philippines', flag: '🇵🇭' },
  { code: '+62', country: 'Indonesia', flag: '🇮🇩' },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+66', country: 'Thailand', flag: '🇹🇭' },

  // Middle East
  { code: '+20', country: 'Egypt', flag: '🇪🇬' },
  { code: '+962', country: 'Jordan', flag: '🇯🇴' },
  { code: '+961', country: 'Lebanon', flag: '🇱🇧' },
  { code: '+964', country: 'Iraq', flag: '🇮🇶' },
  { code: '+98', country: 'Iran', flag: '🇮🇷' },

  // Europe
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+39', country: 'Italy', flag: '🇮🇹' },
  { code: '+34', country: 'Spain', flag: '🇪🇸' },

  // Americas
  { code: '+1', country: 'USA/Canada', flag: '🇺🇸' },

  // Africa
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
  { code: '+234', country: 'Nigeria', flag: '🇳🇬' },
  { code: '+254', country: 'Kenya', flag: '🇰🇪' },

  // Australia
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+64', country: 'New Zealand', flag: '🇳🇿' },
] as const;

// Trial configuration
export const TRIAL_DAYS = 7;

// Helper to get relationship label
export function getRelationshipLabel(value: string): string {
  return RELATIONSHIPS.find((r) => r.value === value)?.label || value;
}

// Helper to get country by code
export function getCountryByCode(code: string) {
  return COUNTRY_CODES.find((c) => c.code === code);
}
