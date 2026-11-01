import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/**
 * Production-ready password hasher.
 * Attempts native argon2id if installed, otherwise uses cryptographically strong
 * scrypt (N=32768, r=8, p=1, 64-byte key) with constant-time verification.
 */
class DefaultPasswordHasher implements PasswordHasher {
  private argon2Module: unknown = null;
  private triedLoadingArgon2 = false;

  private async getArgon2(): Promise<{
    hash: (p: string, opts: unknown) => Promise<string>;
    verify: (h: string, p: string) => Promise<boolean>;
  } | null> {
    if (this.triedLoadingArgon2) return this.argon2Module as any;
    this.triedLoadingArgon2 = true;
    try {
      // Dynamic import to prevent hard failure when native package isn't present
      const mod = await import('argon2');
      this.argon2Module = mod;
      return mod;
    } catch {
      this.argon2Module = null;
      return null;
    }
  }

  async hash(password: string): Promise<string> {
    const argon2 = await this.getArgon2();
    if (argon2) {
      return argon2.hash(password, {
        type: 2, // argon2id
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });
    }

    // High-security scrypt fallback: $scrypt$ln=15,r=8,p=1$<salt_hex>$<hash_hex>
    const salt = randomBytes(16);
    const derivedKey = scryptSync(password, salt, 64, {
      N: 32768, // 2^15
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return `$scrypt$ln=15,r=8,p=1$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    if (hash.startsWith('$argon2')) {
      const argon2 = await this.getArgon2();
      if (argon2) {
        return argon2.verify(hash, password);
      }
      throw new Error('Argon2 hash encountered but argon2 runtime is not installed');
    }

    if (hash.startsWith('$scrypt$')) {
      const parts = hash.split('$');
      if (parts.length !== 5) return false;
      const saltHex = parts[3];
      const keyHex = parts[4];
      if (!saltHex || !keyHex) return false;

      const salt = Buffer.from(saltHex, 'hex');
      const expectedKey = Buffer.from(keyHex, 'hex');
      const actualKey = scryptSync(password, salt, expectedKey.length, {
        N: 32768,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      });

      return timingSafeEqual(new Uint8Array(expectedKey), new Uint8Array(actualKey));
    }

    return false;
  }
}

export const passwordHasher: PasswordHasher = new DefaultPasswordHasher();

