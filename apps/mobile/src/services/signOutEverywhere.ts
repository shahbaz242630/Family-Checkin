import { signOut as authSignOut } from './auth';
import { logOutRevenueCat } from './revenueCat';

/**
 * Signs the sender out of everything that holds an identity on this device (CB-041).
 *
 * RevenueCat keeps its own app-user id. A sign-out that left it logged in would attribute the next
 * account's purchases on this device to the previous sender, so it has to be told first.
 *
 * It must never be able to block the sign-out. The store SDK is a third party that can throw or hang,
 * and the one thing a person pressing "Sign out" has to get is a signed-out app — leaving them signed
 * in because a billing SDK failed would be the worse outcome by far. `logOutRevenueCat` clears its
 * local identity before it calls the SDK, so even a throw leaves nothing pointing at the old sender.
 *
 * Extracted from `useAuth` so the ordering and the swallow are covered by a test rather than by a
 * screen render.
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    await logOutRevenueCat();
  } catch {
    // Deliberately swallowed; see above. Nothing here is recoverable and nothing downstream needs it.
  }

  await authSignOut();
}
