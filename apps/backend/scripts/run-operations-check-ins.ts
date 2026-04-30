import { runOperationsCheckIns } from '../src/modules/operations/operations-runner';

async function main(): Promise<void> {
  const result = await runOperationsCheckIns({
    endpointUrl: process.env.OPERATIONS_CHECK_INS_RUN_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown operations check-ins runner failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
