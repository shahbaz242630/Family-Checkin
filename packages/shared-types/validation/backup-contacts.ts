/** Bodies of `/receivers/:receiverId/backup-contacts` (CB-042). */
import { z } from 'zod';
import {
  boundedText,
  dialablePhoneSchema,
  countryCodeSchema,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_LOCATION_INSTRUCTIONS_LENGTH,
  MAX_RELATIONSHIP_LABEL_LENGTH,
  optionalBoundedText,
} from './primitives';

export const createBackupContactBodySchema = z.object({
  name: boundedText(MAX_DISPLAY_NAME_LENGTH, 'name'),
  phone: dialablePhoneSchema,
  phoneCountry: countryCodeSchema.optional(),
  relationshipToReceiver: boundedText(MAX_RELATIONSHIP_LABEL_LENGTH, 'relationshipToReceiver'),
  /** Free text read aloud to a backup contact ("flat 12, second floor"); encrypted at rest. */
  locationInstructions: optionalBoundedText(MAX_LOCATION_INSTRUCTIONS_LENGTH, 'locationInstructions').optional(),
});

/** Same shape, except that the phone may be left out to keep the stored one. */
export const updateBackupContactBodySchema = createBackupContactBodySchema.extend({
  phone: dialablePhoneSchema.optional(),
});

export type CreateBackupContactBody = z.infer<typeof createBackupContactBodySchema>;
export type UpdateBackupContactBody = z.infer<typeof updateBackupContactBodySchema>;
