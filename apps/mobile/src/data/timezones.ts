// Timezone data organized by region/country
export interface TimezoneOption {
  value: string;
  label: string;
  city: string;
  country: string;
  offset: string;
}

export const TIMEZONES: TimezoneOption[] = [
  // GCC Countries (Primary focus)
  { value: 'Asia/Dubai', label: 'Dubai, UAE', city: 'Dubai', country: 'UAE', offset: 'UTC+4' },
  { value: 'Asia/Abu_Dhabi', label: 'Abu Dhabi, UAE', city: 'Abu Dhabi', country: 'UAE', offset: 'UTC+4' },
  { value: 'Asia/Riyadh', label: 'Riyadh, Saudi Arabia', city: 'Riyadh', country: 'Saudi Arabia', offset: 'UTC+3' },
  { value: 'Asia/Jeddah', label: 'Jeddah, Saudi Arabia', city: 'Jeddah', country: 'Saudi Arabia', offset: 'UTC+3' },
  { value: 'Asia/Kuwait', label: 'Kuwait City, Kuwait', city: 'Kuwait City', country: 'Kuwait', offset: 'UTC+3' },
  { value: 'Asia/Qatar', label: 'Doha, Qatar', city: 'Doha', country: 'Qatar', offset: 'UTC+3' },
  { value: 'Asia/Bahrain', label: 'Manama, Bahrain', city: 'Manama', country: 'Bahrain', offset: 'UTC+3' },
  { value: 'Asia/Muscat', label: 'Muscat, Oman', city: 'Muscat', country: 'Oman', offset: 'UTC+4' },

  // South Asia (Common expat origins)
  { value: 'Asia/Kolkata', label: 'India (IST)', city: 'Mumbai/Delhi', country: 'India', offset: 'UTC+5:30' },
  { value: 'Asia/Karachi', label: 'Pakistan (PKT)', city: 'Karachi', country: 'Pakistan', offset: 'UTC+5' },
  { value: 'Asia/Dhaka', label: 'Bangladesh (BST)', city: 'Dhaka', country: 'Bangladesh', offset: 'UTC+6' },
  { value: 'Asia/Colombo', label: 'Sri Lanka', city: 'Colombo', country: 'Sri Lanka', offset: 'UTC+5:30' },
  { value: 'Asia/Kathmandu', label: 'Nepal', city: 'Kathmandu', country: 'Nepal', offset: 'UTC+5:45' },

  // Southeast Asia
  { value: 'Asia/Manila', label: 'Philippines', city: 'Manila', country: 'Philippines', offset: 'UTC+8' },
  { value: 'Asia/Jakarta', label: 'Indonesia (WIB)', city: 'Jakarta', country: 'Indonesia', offset: 'UTC+7' },
  { value: 'Asia/Singapore', label: 'Singapore', city: 'Singapore', country: 'Singapore', offset: 'UTC+8' },
  { value: 'Asia/Kuala_Lumpur', label: 'Malaysia', city: 'Kuala Lumpur', country: 'Malaysia', offset: 'UTC+8' },
  { value: 'Asia/Bangkok', label: 'Thailand', city: 'Bangkok', country: 'Thailand', offset: 'UTC+7' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Vietnam', city: 'Ho Chi Minh', country: 'Vietnam', offset: 'UTC+7' },

  // Middle East (Non-GCC)
  { value: 'Asia/Tehran', label: 'Iran', city: 'Tehran', country: 'Iran', offset: 'UTC+3:30' },
  { value: 'Asia/Baghdad', label: 'Iraq', city: 'Baghdad', country: 'Iraq', offset: 'UTC+3' },
  { value: 'Asia/Amman', label: 'Jordan', city: 'Amman', country: 'Jordan', offset: 'UTC+3' },
  { value: 'Asia/Beirut', label: 'Lebanon', city: 'Beirut', country: 'Lebanon', offset: 'UTC+2' },
  { value: 'Asia/Jerusalem', label: 'Israel', city: 'Jerusalem', country: 'Israel', offset: 'UTC+2' },
  { value: 'Africa/Cairo', label: 'Egypt', city: 'Cairo', country: 'Egypt', offset: 'UTC+2' },

  // Europe
  { value: 'Europe/London', label: 'United Kingdom', city: 'London', country: 'UK', offset: 'UTC+0' },
  { value: 'Europe/Paris', label: 'France', city: 'Paris', country: 'France', offset: 'UTC+1' },
  { value: 'Europe/Berlin', label: 'Germany', city: 'Berlin', country: 'Germany', offset: 'UTC+1' },
  { value: 'Europe/Rome', label: 'Italy', city: 'Rome', country: 'Italy', offset: 'UTC+1' },
  { value: 'Europe/Madrid', label: 'Spain', city: 'Madrid', country: 'Spain', offset: 'UTC+1' },
  { value: 'Europe/Amsterdam', label: 'Netherlands', city: 'Amsterdam', country: 'Netherlands', offset: 'UTC+1' },
  { value: 'Europe/Moscow', label: 'Russia (Moscow)', city: 'Moscow', country: 'Russia', offset: 'UTC+3' },

  // Africa
  { value: 'Africa/Johannesburg', label: 'South Africa', city: 'Johannesburg', country: 'South Africa', offset: 'UTC+2' },
  { value: 'Africa/Lagos', label: 'Nigeria', city: 'Lagos', country: 'Nigeria', offset: 'UTC+1' },
  { value: 'Africa/Nairobi', label: 'Kenya', city: 'Nairobi', country: 'Kenya', offset: 'UTC+3' },

  // Americas
  { value: 'America/New_York', label: 'USA (Eastern)', city: 'New York', country: 'USA', offset: 'UTC-5' },
  { value: 'America/Chicago', label: 'USA (Central)', city: 'Chicago', country: 'USA', offset: 'UTC-6' },
  { value: 'America/Denver', label: 'USA (Mountain)', city: 'Denver', country: 'USA', offset: 'UTC-7' },
  { value: 'America/Los_Angeles', label: 'USA (Pacific)', city: 'Los Angeles', country: 'USA', offset: 'UTC-8' },
  { value: 'America/Toronto', label: 'Canada (Eastern)', city: 'Toronto', country: 'Canada', offset: 'UTC-5' },
  { value: 'America/Vancouver', label: 'Canada (Pacific)', city: 'Vancouver', country: 'Canada', offset: 'UTC-8' },

  // Australia & Pacific
  { value: 'Australia/Sydney', label: 'Australia (Eastern)', city: 'Sydney', country: 'Australia', offset: 'UTC+11' },
  { value: 'Australia/Perth', label: 'Australia (Western)', city: 'Perth', country: 'Australia', offset: 'UTC+8' },
  { value: 'Pacific/Auckland', label: 'New Zealand', city: 'Auckland', country: 'New Zealand', offset: 'UTC+13' },

  // East Asia
  { value: 'Asia/Tokyo', label: 'Japan', city: 'Tokyo', country: 'Japan', offset: 'UTC+9' },
  { value: 'Asia/Seoul', label: 'South Korea', city: 'Seoul', country: 'South Korea', offset: 'UTC+9' },
  { value: 'Asia/Shanghai', label: 'China', city: 'Shanghai', country: 'China', offset: 'UTC+8' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong', city: 'Hong Kong', country: 'Hong Kong', offset: 'UTC+8' },
];

// Search timezones by query (city, country, or label)
export function searchTimezones(query: string): TimezoneOption[] {
  if (!query.trim()) return TIMEZONES;

  const lowerQuery = query.toLowerCase();
  return TIMEZONES.filter(
    (tz) =>
      tz.label.toLowerCase().includes(lowerQuery) ||
      tz.city.toLowerCase().includes(lowerQuery) ||
      tz.country.toLowerCase().includes(lowerQuery)
  );
}

// Get timezone by value
export function getTimezone(value: string): TimezoneOption | undefined {
  return TIMEZONES.find((tz) => tz.value === value);
}
