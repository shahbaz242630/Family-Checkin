export interface TwilioHttpClient {
  postForm(url: string, body: URLSearchParams, authToken: string): Promise<Record<string, unknown>>;
}

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
      throw new Error(`Twilio request failed with status ${response.status}`);
    }

    return payload;
  }
}

function accountSidFromUrl(url: string): string {
  const match = /\/Accounts\/([^/]+)\//.exec(url);
  return match?.[1] ?? '';
}
