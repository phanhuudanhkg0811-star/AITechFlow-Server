import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { Injectable } from '@nestjs/common';
import envConfig from '../config';

@Injectable()
export class CryptoService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 12;
  private readonly authTagLength = 16;
  private readonly key = createHash('sha256')
    .update(envConfig.ENCRYPTION_MASTER_KEY)
    .digest();

  encrypt(plainText: string): string {
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(encryptedBase64: string): string {
    const payload = Buffer.from(encryptedBase64, 'base64');

    if (payload.length <= this.ivLength + this.authTagLength) {
      throw new Error('Encrypted payload is invalid');
    }

    const iv = payload.subarray(0, this.ivLength);
    const authTag = payload.subarray(
      this.ivLength,
      this.ivLength + this.authTagLength,
    );
    const encrypted = payload.subarray(this.ivLength + this.authTagLength);

    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
