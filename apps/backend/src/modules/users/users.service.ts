import { Injectable } from '@nestjs/common';
import { NEUTRAL_SENDER_DISPLAY_NAME } from '../channels/message-catalog.templates';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import type { SenderRecord, UsersRepository } from './users.repository';

/** Written when the identity carries no usable language; matches `SupabaseAuthService`'s default. */
const DEFAULT_PREFERRED_LANGUAGE = 'en';
/** Longest sender display name stored; receiver-facing copy has to stay inside one SMS segment (CB-010). */
export const MAX_SENDER_DISPLAY_NAME_LENGTH = 80;

export interface UpsertSupabaseSenderInput {
  authProviderId: string;
  email: string;
  phone: string;
  phoneCountry?: string;
  /** Supabase `user_metadata.full_name` (or `name`) as the identity carried it; normalised and encrypted here. */
  displayName?: string;
  country: string;
  preferredLanguage: string;
  timezone: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly cryptoService: CryptoService,
  ) {}

  async upsertFromSupabaseIdentity(input: UpsertSupabaseSenderInput): Promise<SenderRecord> {
    const email = this.normalizeEmail(input.email);
    const phone = this.normalizeSenderPhone(input.phone, input.phoneCountry);
    const displayName = this.normalizeDisplayName(input.displayName);

    return this.usersRepository.upsertSenderByAuthProviderId({
      authProviderId: input.authProviderId,
      emailEncrypted: this.cryptoService.encrypt(email),
      emailHash: this.cryptoService.hashForLookup(email),
      phoneEncrypted: this.cryptoService.encrypt(phone),
      phoneHash: this.cryptoService.hashForLookup(phone),
      ...(displayName ? { displayNameEncrypted: this.cryptoService.encrypt(displayName) } : {}),
      country: input.country,
      preferredLanguage: this.normalizePreferredLanguage(input.preferredLanguage),
      timezone: input.timezone,
    });
  }

  /**
   * The name receiver-facing copy uses for the sender (`senderDisplayName`): the stored display name, or
   * `fallback` when the sender is unknown, deleted or never gave one. Callers that speak to a backup contact pass
   * their own neutral wording. Never place the result in audit metadata (CB-010).
   */
  async senderDisplayNameFor(userId: string, fallback: string = NEUTRAL_SENDER_DISPLAY_NAME): Promise<string> {
    const encrypted = await this.usersRepository.findDisplayNameEncryptedById(userId);
    if (!encrypted) {
      return fallback;
    }

    return this.cryptoService.decrypt(encrypted).trim() || fallback;
  }

  /**
   * Language codes are stored as-is in a `varchar(8)` column (CB-075). Trimming here means a padded or
   * whitespace-wrapped value from client metadata can never be written, and a blank one becomes English rather
   * than an empty string that no template lookup would ever match.
   */
  private normalizePreferredLanguage(language: string): string {
    const normalized = language.trim();

    return normalized || DEFAULT_PREFERRED_LANGUAGE;
  }

  /** Whitespace collapsed and trimmed, capped at `MAX_SENDER_DISPLAY_NAME_LENGTH`; blank means "no name". */
  private normalizeDisplayName(displayName: string | undefined): string | undefined {
    const collapsed = displayName?.replace(/\s+/g, ' ').trim();
    if (!collapsed) {
      return undefined;
    }

    return collapsed.length > MAX_SENDER_DISPLAY_NAME_LENGTH
      ? collapsed.slice(0, MAX_SENDER_DISPLAY_NAME_LENGTH).trimEnd()
      : collapsed;
  }

  private normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase();

    if (!normalized) {
      throw new Error('Sender email is required');
    }

    return normalized;
  }

  private normalizeSenderPhone(phone: string, phoneCountry?: string): string {
    if (!phone.trim()) {
      throw new Error('Sender phone is required');
    }

    return normalizePhone(phone, phoneCountry);
  }
}
