import { Injectable } from '@nestjs/common';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface ExpoPushTicket {
  ok: boolean;
  id?: string;
  error?: string;
}

export type PushGateway = (messages: ExpoPushMessage[]) => Promise<ExpoPushTicket[]>;

@Injectable()
export class ExpoPushGateway {
  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) {
      return [];
    }

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      throw new Error(`Expo push request failed with ${response.status}`);
    }

    const body = (await response.json()) as {
      data?: Array<{ status?: string; id?: string; details?: { error?: string }; message?: string }>;
    };

    return (body.data ?? []).map((ticket) =>
      ticket.status === 'ok'
        ? { ok: true, id: ticket.id }
        : { ok: false, error: ticket.details?.error ?? ticket.message ?? 'ExpoPushError' },
    );
  }
}
