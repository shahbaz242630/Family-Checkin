#!/usr/bin/env node
// Guards the two mobile-config mistakes that made the app unbuildable for a
// store (CB-027) and that nothing else in CI would notice:
//
//   1. `${VAR}` inside `eas.json`. EAS does not expand shell syntax there, so a
//      build receives the literal string "${EXPO_PUBLIC_SUPABASE_URL}" and the
//      app talks to a host that does not exist. It fails at runtime, on a
//      device, long after the build went green.
//   2. An empty or missing `extra.eas.projectId`. Push registration reads it
//      (`services/pushNotifications.ts`), so an empty value means no device
//      ever registers — again silently.
//
// Both are string checks on committed files; no network, no Expo account.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the resolved Expo config. `app.config.js` is dynamic, so it is evaluated, not parsed. */
export function readExpoConfig(root = repoRoot) {
  const out = execFileSync('node', ['-e', 'console.log(JSON.stringify(require("./app.config.js")))'], {
    cwd: join(root, 'apps', 'mobile'),
    encoding: 'utf8',
  });
  return JSON.parse(out).expo;
}

/** Returns a list of human-readable problems; empty means the config is sound. */
export function findMobileConfigProblems({ easJsonText, expoConfig }) {
  const problems = [];

  if (easJsonText.includes('${')) {
    const lines = easJsonText
      .split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes('${'))
      .map(([n, line]) => `    line ${n}: ${line.trim()}`);
    problems.push(
      'eas.json contains ${...} interpolation, which EAS does not expand.\n' +
        lines.join('\n') +
        '\n    Use EAS environment variables instead (eas env:set) and bind the profile with "environment".',
    );
  }

  const projectId = expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    problems.push('extra.eas.projectId is empty. Run `eas init` — push registration reads this value.');
  } else if (!UUID.test(projectId)) {
    problems.push(`extra.eas.projectId is not a UUID: ${JSON.stringify(projectId)}`);
  }

  if (!expoConfig?.owner) {
    problems.push('expo.owner is missing. EAS cannot resolve the account that owns the project.');
  }

  if (expoConfig?.android?.versionCode === undefined) {
    problems.push('android.versionCode is missing; Play rejects a bundle without one.');
  }
  if (!expoConfig?.ios?.buildNumber) {
    problems.push('ios.buildNumber is missing; App Store Connect rejects a build without one.');
  }

  // CB-031. Without this the Android binary has no FCM sender config and no
  // device can ever receive a push — a failure with no error message anywhere.
  if (!expoConfig?.android?.googleServicesFile) {
    problems.push(
      'android.googleServicesFile is missing; Android push cannot work without the FCM config baked in. ' +
        'It should read process.env.GOOGLE_SERVICES_JSON, the secret file variable on EAS.',
    );
  }

  return problems;
}

function main() {
  const easJsonText = readFileSync(join(repoRoot, 'apps', 'mobile', 'eas.json'), 'utf8');
  const problems = findMobileConfigProblems({ easJsonText, expoConfig: readExpoConfig() });

  if (problems.length > 0) {
    console.error('Mobile config check failed (CB-027):\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    'Mobile config check passed: no ${} interpolation; projectId, owner, versionCode, buildNumber and googleServicesFile all set.',
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
