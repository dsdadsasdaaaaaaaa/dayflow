import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, concatBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Encrypted backups.
 *
 * The passphrase lives ONLY in the device keychain (SecureStore) — never in
 * AsyncStorage, never inside a backup file. Web preview falls back to memory
 * only (mirrors smsCredentials). Files are self-contained envelopes: anyone
 * with the file + passphrase can open them on a fresh install; without the
 * passphrase they are noise.
 *
 * Cipher: XChaCha20-Poly1305 (authenticated, misuse-resistant 24-byte nonce)
 * with a key derived from the passphrase via scrypt. Both come from the
 * audited pure-JS @noble packages, so this works identically on Hermes and web
 * with no native module (OTA-safe).
 */

// ---------------------------------------------------------------------------
// Passphrase (SecureStore)
// ---------------------------------------------------------------------------

const KEY = 'dayflow-backup-passphrase';
let memoryFallback: string | null = null;

export async function loadBackupPassphrase(): Promise<string | null> {
  if (Platform.OS === 'web') return memoryFallback;
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function saveBackupPassphrase(passphrase: string): Promise<void> {
  if (Platform.OS === 'web') {
    memoryFallback = passphrase;
    return;
  }
  await SecureStore.setItemAsync(KEY, passphrase);
}

export async function clearBackupPassphrase(): Promise<void> {
  memoryFallback = null;
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// Envelope format
// ---------------------------------------------------------------------------

const ALG = 'xchacha20poly1305-scrypt';
const SALT_BYTES = 16;
const NONCE_BYTES = 24; // XChaCha20 extended nonce

/**
 * scrypt cost parameters. N=2^15 / r=8 / p=1 needs ~32 MB of RAM and takes
 * roughly a second on a modern phone — slow enough to make guessing a short
 * passphrase expensive, fast enough that saving or restoring a backup never
 * feels stuck. dkLen=32 is the XChaCha20-Poly1305 key size.
 */
const SCRYPT_OPTS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

interface Envelope {
  v: 1;
  alg: typeof ALG;
  /** base64, {@link SALT_BYTES} random bytes (per-file scrypt salt). */
  salt: string;
  /** base64, {@link NONCE_BYTES} random bytes. */
  nonce: string;
  /** base64 ciphertext (includes the Poly1305 auth tag). */
  data: string;
}

export type DecryptBackupResult =
  | { ok: true; plaintext: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Small helpers (base64 + randomness)
// ---------------------------------------------------------------------------

/** Uint8Array → base64. btoa exists on Hermes and web (used app-wide). */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 8192; // keep String.fromCharCode arg counts sane
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → Uint8Array. Throws on malformed input (callers catch). */
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Random bytes for salts/nonces. Prefers the platform CSPRNG
 * (crypto.getRandomValues — always there on web, present on newer Hermes).
 * Older Hermes builds without it fall back to a SHA-256 stretch over timing
 * jitter + Math.random. That fallback is weaker than a true CSPRNG, but salts
 * are public anyway and every file also derives a fresh key from a fresh
 * salt, so nonce uniqueness — the property XChaCha20 actually needs — holds.
 */
function randomBytesSafe(length: number): Uint8Array {
  const cr = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } })
    .crypto;
  if (cr && typeof cr.getRandomValues === 'function') {
    const out = new Uint8Array(length);
    cr.getRandomValues(out);
    return out;
  }
  // Entropy pool: float bits from Math.random mixed with wall-clock jitter.
  const pool = new Uint8Array(128);
  const f64 = new Float64Array(1);
  const f64bytes = new Uint8Array(f64.buffer);
  for (let i = 0; i < pool.length; i++) {
    f64[0] = Math.random() * (Date.now() + i + 1);
    pool[i] = f64bytes[i % 8] ^ Math.floor(Math.random() * 256);
  }
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    const block = sha256(
      concatBytes(pool, utf8ToBytes(`${counter++}|${Date.now()}|${Math.random()}`))
    );
    out.set(block.subarray(0, Math.min(block.length, length - offset)), offset);
    offset += block.length;
  }
  return out;
}

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return scrypt(passphrase, salt, SCRYPT_OPTS);
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt / detect
// ---------------------------------------------------------------------------

/**
 * Encrypt a backup payload with a passphrase. Returns the JSON envelope
 * string that gets written to disk / shared. Synchronous; the scrypt
 * derivation takes ~1s on-device (see {@link SCRYPT_OPTS}).
 */
export function encryptBackup(plaintext: string, passphrase: string): string {
  const salt = randomBytesSafe(SALT_BYTES);
  const nonce = randomBytesSafe(NONCE_BYTES);
  const key = deriveKey(passphrase, salt);
  const data = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));
  const envelope: Envelope = {
    v: 1,
    alg: ALG,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    data: toBase64(data),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt an envelope produced by {@link encryptBackup}. Never throws: a
 * wrong passphrase (Poly1305 tag mismatch) or a damaged file comes back as
 * `{ ok: false, error }` with a message safe to show in the UI.
 */
export function decryptBackup(envelope: string, passphrase: string): DecryptBackupResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    return { ok: false, error: 'This is not a valid encrypted backup file.' };
  }
  if (!isEnvelope(parsed)) {
    return { ok: false, error: 'This is not a valid encrypted backup file.' };
  }
  try {
    const salt = fromBase64(parsed.salt);
    const nonce = fromBase64(parsed.nonce);
    const data = fromBase64(parsed.data);
    const key = deriveKey(passphrase, salt);
    const plaintext = bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(data));
    return { ok: true, plaintext };
  } catch {
    // An authentication failure is indistinguishable from corruption by
    // design — the honest error names both.
    return { ok: false, error: 'Wrong passphrase, or the file is damaged.' };
  }
}

function isEnvelope(v: unknown): v is Envelope {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return (
    e.v === 1 &&
    e.alg === ALG &&
    typeof e.salt === 'string' &&
    typeof e.nonce === 'string' &&
    typeof e.data === 'string'
  );
}

/** True when the pasted/loaded text is an encrypted DayFlow envelope. */
export function isEncryptedBackup(raw: string): boolean {
  try {
    return isEnvelope(JSON.parse(raw));
  } catch {
    return false;
  }
}
