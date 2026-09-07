/** Body of `POST /device-tokens` (CB-042). */
import { z } from 'zod';
import { MAX_DEVICE_ID_LENGTH, MAX_PUSH_TOKEN_LENGTH, pushPlatformSchema } from './primitives';

export const registerDeviceTokenBodySchema = z.object({
  /** Shape checked here, ownership by Expo: the service still refuses anything but an Expo push token. */
  token: z.string().trim().min(1, 'token is required').max(MAX_PUSH_TOKEN_LENGTH),
  platform: pushPlatformSchema,
  deviceId: z.string().trim().min(1).max(MAX_DEVICE_ID_LENGTH).optional(),
});

export type RegisterDeviceTokenBody = z.infer<typeof registerDeviceTokenBodySchema>;
