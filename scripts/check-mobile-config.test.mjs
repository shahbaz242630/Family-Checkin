import { describe, expect, it } from 'vitest';
import { findMobileConfigProblems, readExpoConfig } from './check-mobile-config.mjs';

const soundConfig = {
  owner: 'an-account',
  ios: { buildNumber: '1' },
  android: { versionCode: 1, googleServicesFile: './google-services.json' },
  extra: { eas: { projectId: 'ddb699e2-f321-4f9e-8c17-64eeefc4cfd3' } },
};

const soundEasJson = JSON.stringify({ build: { production: { environment: 'production' } } }, null, 2);

describe('findMobileConfigProblems', () => {
  it('passes the configuration this repository actually ships', () => {
    expect(findMobileConfigProblems({ easJsonText: soundEasJson, expoConfig: soundConfig })).toEqual([]);
  });

  it('catches the ${} interpolation that shipped a literal string to the device', () => {
    const easJsonText = JSON.stringify(
      { build: { production: { env: { EXPO_PUBLIC_SUPABASE_URL: '${EXPO_PUBLIC_SUPABASE_URL}' } } } },
      null,
      2,
    );
    const [problem, ...rest] = findMobileConfigProblems({ easJsonText, expoConfig: soundConfig });
    expect(rest).toEqual([]);
    expect(problem).toContain('does not expand');
    // The offending line is quoted so the failure is actionable without opening the file.
    expect(problem).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(problem).toMatch(/line \d+:/);
  });

  it('catches an empty projectId, which silently stops every push registration', () => {
    const expoConfig = { ...soundConfig, extra: { eas: { projectId: '' } } };
    expect(findMobileConfigProblems({ easJsonText: soundEasJson, expoConfig })).toEqual([
      expect.stringContaining('projectId is empty'),
    ]);
  });

  it('rejects a projectId that is not a UUID', () => {
    const expoConfig = { ...soundConfig, extra: { eas: { projectId: 'family-checkin' } } };
    expect(findMobileConfigProblems({ easJsonText: soundEasJson, expoConfig })).toEqual([
      expect.stringContaining('not a UUID'),
    ]);
  });

  it('catches a missing googleServicesFile, without which Android push cannot work', () => {
    const expoConfig = { ...soundConfig, android: { versionCode: 1 } };
    expect(findMobileConfigProblems({ easJsonText: soundEasJson, expoConfig })).toEqual([
      expect.stringContaining('googleServicesFile is missing'),
    ]);
  });

  it('reports every missing store identifier at once rather than one per run', () => {
    const problems = findMobileConfigProblems({
      easJsonText: soundEasJson,
      expoConfig: { extra: { eas: { projectId: soundConfig.extra.eas.projectId } } },
    });
    expect(problems).toEqual([
      expect.stringContaining('owner is missing'),
      expect.stringContaining('versionCode is missing'),
      expect.stringContaining('buildNumber is missing'),
      expect.stringContaining('googleServicesFile is missing'),
    ]);
  });
});

describe('readExpoConfig', () => {
  it('evaluates the real app.config.js and finds no problems in it', () => {
    const expoConfig = readExpoConfig();
    expect(expoConfig.slug).toBe('family-checkin');
    expect(findMobileConfigProblems({ easJsonText: soundEasJson, expoConfig })).toEqual([]);
  });
});
