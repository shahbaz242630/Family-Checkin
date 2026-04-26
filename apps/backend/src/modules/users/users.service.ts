import { Injectable } from '@nestjs/common';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { normalizePhone } from '../../shared/phone/phone-normalizer';
import type { SenderRecord, UsersRepository } from './users.repository';

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
      preferredLanguage: input.preferredLanguage,
      timezone: input.timezone,
    });
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
