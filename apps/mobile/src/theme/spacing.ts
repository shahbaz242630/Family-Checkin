// Consistent spacing scale (8px base)

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 24,
  xxl: 32,
  hero: 48,
} as const;

// For elderly users - large text mode
export const fontSizeLarge = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
  hero: 56,
} as const;
