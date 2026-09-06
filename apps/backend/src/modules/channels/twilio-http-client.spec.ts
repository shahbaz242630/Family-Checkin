import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchTwilioHttpClient } from './twilio-http-client';
import { TwilioRequestError, twilioRequestErrorFromResponse } from './twilio-request-error';

function twilioResponse(status: number, body: string, contentType = 'application/json'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

describe('FetchTwilioHttpClient (CB-019)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts a form with basic auth and returns the parsed body on success', async () => {
    const fetchMock = vi.fn(async () => twilioResponse(201, JSON.stringify({ sid: 'SM123', status: 'queued' })));
    vi.stubGlobal('fetch', fetchMock);

    const payload = await new FetchTwilioHttpClient().postForm(
      'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
      new URLSearchParams({ To: '+971501234567', Body: 'hello' }),
      'auth-token',
    );

    expect(payload).toEqual({ sid: 'SM123', status: 'queued' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC123:auth-token').toString('base64')}`,
    );
  });

  it('throws a TwilioRequestError carrying the Twilio error code, never the phone number Twilio quotes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        twilioResponse(
          400,
          JSON.stringify({
            code: 21211,
            message: "The 'To' number +971501234567 is not a valid phone number.",
            more_info: 'https://www.twilio.com/docs/errors/21211',
            status: 400,
          }),
        ),
      ),
    );

    const failure = await new FetchTwilioHttpClient()
      .postForm(
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json',
        new URLSearchParams({ To: '+971501234567' }),
        'auth-token',
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).toBeInstanceOf(TwilioRequestError);
    const twilioError = failure as TwilioRequestError;
    expect(twilioError.code).toBe(21211);
    expect(twilioError.status).toBe(400);
    expect(twilioError.failureReason).toBe('twilio_21211');
    expect(twilioError.moreInfo).toBe('https://www.twilio.com/docs/errors/21211');
    expect(twilioError.message).toBe(
      'Twilio request failed (HTTP 400, error code 21211, see https://www.twilio.com/docs/errors/21211)',
    );
    expect(twilioError.message).not.toContain('971501234567');
    expect(JSON.stringify({ ...twilioError, message: twilioError.message })).not.toContain('971501234567');
  });

  it('falls back to the HTTP status when the failure body is not a Twilio error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => twilioResponse(502, '<html>Bad Gateway</html>', 'text/html')),
    );

    await expect(
      new FetchTwilioHttpClient().postForm(
        'https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json',
        new URLSearchParams(),
        'auth-token',
      ),
    ).rejects.toMatchObject({
      name: 'TwilioRequestError',
      status: 502,
      code: undefined,
      failureReason: 'twilio_http_502',
      message: 'Twilio request failed (HTTP 502)',
    });
  });
});

describe('twilioRequestErrorFromResponse', () => {
  it('tolerates a numeric-string code and ignores a more_info that is not an https URL', () => {
    const error = twilioRequestErrorFromResponse(401, { code: '20003', more_info: 'javascript:alert(1)' });

    expect(error.code).toBe(20003);
    expect(error.failureReason).toBe('twilio_20003');
    expect(error.moreInfo).toBeUndefined();
    expect(error.message).toBe('Twilio request failed (HTTP 401, error code 20003)');
  });

  it('treats a non-integer or missing code as no code', () => {
    expect(twilioRequestErrorFromResponse(429, { code: 'rate-limited' }).failureReason).toBe('twilio_http_429');
    expect(twilioRequestErrorFromResponse(500, null).failureReason).toBe('twilio_http_500');
    expect(twilioRequestErrorFromResponse(500, 'oops').failureReason).toBe('twilio_http_500');
  });
});
