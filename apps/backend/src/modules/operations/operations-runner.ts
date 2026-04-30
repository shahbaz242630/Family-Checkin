export type OperationsRunAggregate = {
  ok: true;
  dueCheckIns: {
    created: number;
    sent: number;
    skipped: number;
  };
  overdueEscalations: {
    checked: number;
    escalated: number;
    skipped: number;
    failed: number;
  };
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function runOperationsCheckIns(input: {
  endpointUrl: string;
  serviceRoleKey: string;
  fetchImpl?: FetchLike;
}): Promise<OperationsRunAggregate> {
  const endpointUrl = input.endpointUrl.trim();
  const serviceRoleKey = input.serviceRoleKey.trim();

  if (!endpointUrl) {
    throw new Error('OPERATIONS_CHECK_INS_RUN_URL is required');
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(endpointUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Operations check-ins run failed with HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as OperationsRunAggregate;

  return {
    ok: true,
    dueCheckIns: {
      created: body.dueCheckIns.created,
      sent: body.dueCheckIns.sent,
      skipped: body.dueCheckIns.skipped,
    },
    overdueEscalations: {
      checked: body.overdueEscalations.checked,
      escalated: body.overdueEscalations.escalated,
      skipped: body.overdueEscalations.skipped,
      failed: body.overdueEscalations.failed,
    },
  };
}
