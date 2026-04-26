import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export function normalizePhone(input: string, defaultCountry?: string): string {
  const parsed = parsePhoneNumberFromString(input, defaultCountry as CountryCode | undefined);

  if (!parsed?.isValid()) {
    throw new Error('Invalid phone number');
  }

  return parsed.format('E.164');
}
