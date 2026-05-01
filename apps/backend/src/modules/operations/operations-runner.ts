export type OperationsRunAggregate = {
  ok: true;
  dueCheckIns: {
    created: number;
    sent: number;
    skipped: number;
  };
  overdueEscalations?: {
    checked?: number;
    escalated?: number;
    sent?: number;
    timedOut?: number;
    needsAttention?: number;
    skipped: number;
    failed: number;
  };
  cascadeAttempts?: {
    sent: number;
    timedOut: number;
    failed: number;
    needsAttention: number;
    skipped: number;
  };
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function runOperationsCheckIns(input: {
  endpointUrl: string;
  operationsCronSecret: string;
  fetchImpl?: FetchLike;
}): Promise<OperationsRunAggregate> {
  const endpointUrl = input.endpointUrl.trim();
  const operationsCronSecret = input.operationsCronSecret.trim();

  if (!endpointUrl) {
    throw new Error('OPERATIONS_CHECK_INS_RUN_URL is required');
  }

  if (!operationsCronSecret) {
    throw new Error('OPERATIONS_CRON_SECRET is required');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(endpointUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${operationsCronSecret}`,
      'content-type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Operations check-ins run failed with HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as OperationsRunAggregate;
  const legacyEscalations = body.overdueEscalations ?? {
    sent: 0,
    timedOut: 0,
    failed: 0,
    needsAttention: 0,
    skipped: 0,
  };
  const cascadeAttempts = body.cascadeAttempts ?? {
    sent: legacyEscalations.sent ?? 0,
    timedOut: legacyEscalations.timedOut ?? 0,
    failed: legacyEscalations.failed,
    needsAttention: legacyEscalations.needsAttention ?? 0,
    skipped: legacyEscalations.skipped,
  };

  return {
    ok: true,
    dueCheckIns: {
      created: body.dueCheckIns.created,
      sent: body.dueCheckIns.sent,
      skipped: body.dueCheckIns.skipped,
    },
    cascadeAttempts: {
      sent: cascadeAttempts.sent,
      timedOut: cascadeAttempts.timedOut,
      failed: cascadeAttempts.failed,
      needsAttention: cascadeAttempts.needsAttention,
      skipped: cascadeAttempts.skipped,
    },
  };
}
