export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ar', name: 'Arabic', nativeName: 'Arabic' },
  { code: 'ur', name: 'Urdu', nativeName: 'Urdu' },
  { code: 'hi', name: 'Hindi', nativeName: 'Hindi' },
  { code: 'bn', name: 'Bengali', nativeName: 'Bengali' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
];

export function getLanguage(code: string): LanguageOption | undefined {
  return LANGUAGES.find((language) => language.code === code);
}
