import { runOperationsPushReceipts } from '../src/modules/operations/operations-runner';

async function main(): Promise<void> {
  const result = await runOperationsPushReceipts({
    endpointUrl: process.env.OPERATIONS_PUSH_RECEIPTS_RUN_URL ?? '',
    operationsCronSecret: process.env.OPERATIONS_CRON_SECRET ?? '',
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown operations push receipts runner failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
