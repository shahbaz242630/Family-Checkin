import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { NEUTRAL_SENDER_DISPLAY_NAME } from '../channels/message-catalog.templates';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import { SenderUniqueConflictError } from './users.repository';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

/** Written when the identity carries no usable language; matches `SupabaseAuthService`'s default. */
const DEFAULT_PREFERRED_LANGUAGE = 'en';
/** Longest sender display name stored; receiver-facing copy has to stay inside one SMS segment (CB-010). */
export const MAX_SENDER_DISPLAY_NAME_LENGTH = 80;

export interface UpsertSupabaseSenderInput {
  authProviderId: string;
  email: string;
  /**
   * As the Supabase identity carried it. Required only when a `users` row is written (first request of a new
   * sender, `POST /auth/sync-user`); an existing sender is read by `authProviderId` and never needs it (CB-024).
   */
  phone?: string;
  /** Default region for a phone without a country calling code; the identity's `country` is used when absent. */
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

  /**
   * The sender behind a verified Supabase identity, for every authenticated route except `POST /auth/sync-user`.
   * An existing sender is read by `authProviderId` and nothing is written, so client-writable metadata can never
   * rewrite the profile per request and a Supabase-side change never costs a write (CB-024). A sender the app
   * never synced (the app skipped or lost `sync-user`) is inserted once from the identity so the request still
   * works; a concurrent first request loses the unique index race and reads the row the other one inserted.
   */
  async findOrCreateFromSupabaseIdentity(input: UpsertSupabaseSenderInput): Promise<SenderRecord> {
    const existing = await this.usersRepository.findSenderByAuthProviderId(input.authProviderId);
    if (existing) {
      return existing;
    }

    try {
      return await this.usersRepository.createSender(this.toSenderRecordInput(input));
    } catch (error) {
      if (!(error instanceof SenderUniqueConflictError)) {
        throw error;
      }
    }

    const raced = await this.usersRepository.findSenderByAuthProviderId(input.authProviderId);
    if (raced) {
      return raced;
    }
    throw new ConflictException('Sender email or phone number already belongs to another account');
  }

  /**
   * `POST /auth/sync-user`: the one place the profile columns (email, phone, country, language, timezone and the
   * display name from `full_name`, CB-010) are overwritten from the Supabase identity.
   */
  async syncProfileFromSupabaseIdentity(input: UpsertSupabaseSenderInput): Promise<SenderRecord> {
    try {
      return await this.usersRepository.upsertSenderByAuthProviderId(this.toSenderRecordInput(input));
    } catch (error) {
      if (error instanceof SenderUniqueConflictError) {
        throw new ConflictException('Sender email or phone number already belongs to another account');
      }
      throw error;
    }
  }

  /**
   * @deprecated Kept for the controllers that still spell the read path this way (receivers, backup contacts,
   * billing, notifications, account); it is `findOrCreateFromSupabaseIdentity` and performs no upsert (CB-024).
   * Only `POST /auth/sync-user` upserts, through `syncProfileFromSupabaseIdentity`.
   */
  async upsertFromSupabaseIdentity(input: UpsertSupabaseSenderInput): Promise<SenderRecord> {
    return this.findOrCreateFromSupabaseIdentity(input);
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

  private toSenderRecordInput(input: UpsertSupabaseSenderInput): UpsertSenderRecordInput {
    const email = this.normalizeEmail(input.email);
    const phone = this.normalizeSenderPhone(input.phone, input.phoneCountry ?? input.country);
    const displayName = this.normalizeDisplayName(input.displayName);

    return {
      authProviderId: input.authProviderId,
      emailEncrypted: this.cryptoService.encrypt(email),
      emailHash: this.cryptoService.hashForLookup(email),
      phoneEncrypted: this.cryptoService.encrypt(phone),
      phoneHash: this.cryptoService.hashForLookup(phone),
      ...(displayName ? { displayNameEncrypted: this.cryptoService.encrypt(displayName) } : {}),
      country: input.country,
      preferredLanguage: this.normalizePreferredLanguage(input.preferredLanguage),
      timezone: input.timezone,
    };
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
      throw new UnauthorizedException('Supabase user is missing an email');
    }

    return normalized;
  }

  /**
   * A `users` row needs a phone (the step-up OTP and the siren call go to it), so writing one without is refused
   * the way `POST /auth/sync-user` always has been: 401. A phone that libphonenumber cannot parse is a 401 too,
   * not the 500 a bad metadata value used to cause (CB-024).
   */
  private normalizeSenderPhone(phone: string | undefined, phoneCountry: string): string {
    if (!phone?.trim()) {
      throw new UnauthorizedException('Supabase user is missing a phone number');
    }

    try {
      return normalizePhone(phone, phoneCountry);
    } catch {
      throw new UnauthorizedException('Supabase user phone number is invalid');
    }
  }
}
