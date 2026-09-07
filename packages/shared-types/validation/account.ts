/** Bodies of the `/account` step-up routes (CB-042). */
import { z } from 'zod';
import { identifierSchema, sensitiveActionSchema } from './primitives';

export const stepUpRequestBodySchema = z.object({
  action: sensitiveActionSchema,
});

export const stepUpVerifyBodySchema = z.object({
  challengeId: identifierSchema,
  /** The SMS code; digits only, and short enough that a brute-force body is refused before hashing. */
  code: z.string().trim().min(4).max(12),
});

export type StepUpRequestBody = z.infer<typeof stepUpRequestBodySchema>;
export type StepUpVerifyBody = z.infer<typeof stepUpVerifyBodySchema>;
