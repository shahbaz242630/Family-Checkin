import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const AES_256_KEY_LENGTH_BYTES = 32;
const GCM_IV_LENGTH_BYTES = 12;
const GCM_AUTH_TAG_LENGTH_BYTES = 16;

export class CryptoService {
  constructor(private readonly masterKey: Buffer) {
    if (masterKey.byteLength !== AES_256_KEY_LENGTH_BYTES) {
      throw new Error('CryptoService requires a 32-byte master key');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(GCM_IV_LENGTH_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    const buffer = Buffer.from(ciphertext, 'base64');
    const iv = buffer.subarray(0, GCM_IV_LENGTH_BYTES);
    const authTag = buffer.subarray(
      GCM_IV_LENGTH_BYTES,
      GCM_IV_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES,
    );
    const encrypted = buffer.subarray(GCM_IV_LENGTH_BYTES + GCM_AUTH_TAG_LENGTH_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);

    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  hashForLookup(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
