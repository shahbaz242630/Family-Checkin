import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import type { SenderRecord, UsersRepository } from './users.repository';

/** Written when the identity carries no usable language; matches `SupabaseAuthService`'s default. */
const DEFAULT_PREFERRED_LANGUAGE = 'en';

export interface UpsertSupabaseSenderInput {
  authProviderId: string;
  email: string;
  phone: string;
  phoneCountry?: string;
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

    return this.usersRepository.upsertSenderByAuthProviderId({
      authProviderId: input.authProviderId,
      emailEncrypted: this.cryptoService.encrypt(email),
      emailHash: this.cryptoService.hashForLookup(email),
      phoneEncrypted: this.cryptoService.encrypt(phone),
      phoneHash: this.cryptoService.hashForLookup(phone),
      country: input.country,
      preferredLanguage: this.normalizePreferredLanguage(input.preferredLanguage),
      timezone: input.timezone,
    });
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
