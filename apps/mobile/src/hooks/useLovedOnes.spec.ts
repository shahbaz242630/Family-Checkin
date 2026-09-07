import { describe, expect, it, vi } from 'vitest';

// The hook itself needs a navigator and a Supabase session; only its pure failure logic is under test here, so
// the React Native and Expo Router edges are stubbed out (this project has no screen-test harness).
vi.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
vi.mock('./useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../services/supabase', () => ({ getSession: async () => null }));

const { describeReceiversFailure, RECEIVERS_LOAD_FAILED_MESSAGE } = await import('./useLovedOnes');
const { BackendRequestError, BackendTransportError, PHONE_REQUIRED_MESSAGE, SESSION_EXPIRED_MESSAGE } =
  await import('../services/backendErrors');

describe('dashboard receivers failure (CB-032)', () => {
  it('explains a network failure and offers nothing but a retry', () => {
    // This is the case that used to render "No receivers yet" — telling a sender with three receivers that they
    // had none, because the app could not ask.
    expect(describeReceiversFailure(new TypeError('Network request failed'))).toEqual({
      message: 'Network request failed',
      action: null,
    });
    expect(describeReceiversFailure(undefined)).toEqual({
      message: RECEIVERS_LOAD_FAILED_MESSAGE,
      action: null,
    });
  });

  it('asks for a phone number instead of signing the sender out on a PHONE_REQUIRED 401 (CB-037)', () => {
    const failure = new BackendRequestError('Supabase user is missing a phone number', 401, 'PHONE_REQUIRED');

    expect(describeReceiversFailure(failure)).toEqual({
      message: PHONE_REQUIRED_MESSAGE,
      action: 'add-phone',
    });
  });

  it('signs the sender out on any other 401', () => {
    const failure = new BackendRequestError('Invalid Supabase access token', 401);

    expect(describeReceiversFailure(failure)).toEqual({
      message: SESSION_EXPIRED_MESSAGE,
      action: 'sign-out',
    });
  });

  it('passes a typed refusal through the shared copy, and never as a sign-out', () => {
    const failure = new BackendRequestError('nope', 403, 'PAID_ACCESS_REQUIRED');

    expect(describeReceiversFailure(failure)).toEqual({ message: 'nope', action: null });
  });

  it('keeps the plain-language transport message for a cut-off reply (CB-080)', () => {
    const failure = new BackendTransportError('The reply did not arrive in full.', 200, 'empty_body');

    expect(describeReceiversFailure(failure)).toEqual({
      message: 'The reply did not arrive in full.',
      action: null,
    });
  });
});
