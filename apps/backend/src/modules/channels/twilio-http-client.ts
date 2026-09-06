import { twilioRequestErrorFromResponse } from './twilio-request-error';

export interface TwilioHttpClient {
  postForm(url: string, body: URLSearchParams, authToken: string): Promise<Record<string, unknown>>;
}

/**
 * Minimal Twilio REST client: one form-encoded POST with HTTP basic auth. A non-2xx answer becomes a
 * `TwilioRequestError` carrying Twilio's error code (CB-019); the parsed body of a success is returned as is.
 */
export class FetchTwilioHttpClient implements TwilioHttpClient {
  async postForm(url: string, body: URLSearchParams, authToken: string): Promise<Record<string, unknown>> {
    const accountSid = accountSidFromUrl(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw twilioRequestErrorFromResponse(response.status, payload);
    }

    return payload;
  }
}

function accountSidFromUrl(url: string): string {
  const match = url.match(/\/Accounts\/([^/]+)\//);
  return match?.[1] ?? '';
}
