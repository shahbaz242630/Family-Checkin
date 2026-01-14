// App color palette
// Primary: Calming blue - conveys trust and safety
// Accent: Warm green - conveys "OK" / safe status

export const colors = {
  // Primary palette
  primary: '#4A90D9',
  primaryDark: '#3A7BC8',
  primaryLight: '#6BA5E7',

  // Status colors
  safe: '#4CAF50',
  safeLight: '#81C784',
  pending: '#FF9800',
  pendingLight: '#FFB74D',
  alert: '#F44336',
  alertLight: '#E57373',

  // Neutrals
  background: '#FFFFFF',
  backgroundSecondary: '#F5F7FA',
  surface: '#FFFFFF',

  // Text
  text: '#1A1A2E',
  textSecondary: '#6B7280',
  textLight: '#9CA3AF',
  textOnPrimary: '#FFFFFF',

  // Borders & Dividers
  border: '#E5E7EB',
  divider: '#F3F4F6',

  // Semantic
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  info: '#2196F3',

  // Button states
  disabled: '#D1D5DB',
  disabledText: '#9CA3AF',
} as const;

export type ColorName = keyof typeof colors;
