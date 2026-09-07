import { describe, expect, it, vi } from 'vitest';

// Only the form and metadata logic is under test; the Supabase client and auth context are edges.
vi.mock('../services/supabase', () => ({ supabase: { auth: {} } }));
vi.mock('./useAuth', () => ({ useAuth: () => ({ user: null }) }));

const { buildProfileMetadataUpdate, profileFormChanged, profileFormValues } = await import('./useProfile');

const profile = {
  id: 'user-1',
  full_name: 'Aisha Sender',
  avatar_url: null,
  phone: '+971501234567',
  timezone: 'Asia/Dubai',
  language: 'en',
  created_at: '2026-04-26T08:00:00.000Z',
  updated_at: '2026-09-01T08:00:00.000Z',
};

describe('profile form seeding (CB-033)', () => {
  it('has nothing to seed until the profile has loaded', () => {
    // Seeding at first render was the bug: the fields were empty, so Save wrote empty values over the real ones.
    expect(profileFormValues(null)).toBeNull();
    expect(profileFormChanged(null, { fullName: '', phone: '' })).toBe(false);
    expect(profileFormChanged(null, { fullName: 'Typed', phone: '' })).toBe(false);
  });

  it('seeds the current name and phone once the profile arrives', () => {
    expect(profileFormValues(profile)).toEqual({ fullName: 'Aisha Sender', phone: '+971501234567' });
    expect(profileFormValues({ ...profile, full_name: null, phone: null })).toEqual({ fullName: '', phone: '' });
  });

  it('reports no change until something is actually different, ignoring whitespace', () => {
    expect(profileFormChanged(profile, { fullName: 'Aisha Sender', phone: '+971501234567' })).toBe(false);
    expect(profileFormChanged(profile, { fullName: '  Aisha Sender  ', phone: ' +971501234567 ' })).toBe(false);
    expect(profileFormChanged(profile, { fullName: 'Aisha S', phone: '+971501234567' })).toBe(true);
    expect(profileFormChanged(profile, { fullName: 'Aisha Sender', phone: '+971509999999' })).toBe(true);
  });
});

describe('profile metadata update (CB-033)', () => {
  it('writes the edited fields into user_metadata', () => {
    expect(buildProfileMetadataUpdate(profile, { full_name: 'Aisha S', phone: '+971509999999' })).toEqual({
      full_name: 'Aisha S',
      phone: '+971509999999',
      timezone: 'Asia/Dubai',
      language: 'en',
    });
  });

  it('never blanks a stored value: an empty edit keeps what is already there', () => {
    // The old code sent whatever the (possibly unseeded) form held, which wiped `full_name`.
    expect(buildProfileMetadataUpdate(profile, { full_name: '', phone: '   ' })).toEqual({
      full_name: 'Aisha Sender',
      phone: '+971501234567',
      timezone: 'Asia/Dubai',
      language: 'en',
    });
  });

  it('leaves fields the caller did not mention untouched', () => {
    expect(buildProfileMetadataUpdate(profile, { full_name: 'Aisha S' })).toMatchObject({
      phone: '+971501234567',
      timezone: 'Asia/Dubai',
      language: 'en',
    });
  });

  it('omits a key that has no value anywhere rather than storing an empty string', () => {
    const update = buildProfileMetadataUpdate({ ...profile, phone: null, full_name: null }, {});

    expect(update).toEqual({ timezone: 'Asia/Dubai', language: 'en' });
    expect('phone' in update).toBe(false);
    expect('full_name' in update).toBe(false);
  });

  it('works before the profile has loaded, using only what was passed', () => {
    expect(buildProfileMetadataUpdate(null, { full_name: 'Aisha Sender' })).toEqual({ full_name: 'Aisha Sender' });
  });
});
