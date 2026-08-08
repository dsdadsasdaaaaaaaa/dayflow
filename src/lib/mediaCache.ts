import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { loadSmsCredentials, type SmsCredentials } from './smsCredentials';

/**
 * MMS media cache. Twilio media URLs require Basic auth and redirect to a
 * short-lived S3 URL, so we fetch once, convert to a base64 data URI, and
 * cache it (in-memory + on disk) so threads open instantly and offline.
 *
 * Everything here is best-effort and never throws to callers: failures come
 * back as null / an error string, and messages without media are untouched.
 */

/** In-memory cache: media URL → data URI. */
const memoryCache = new Map<string, string>();
/** De-dupe concurrent loads of the same URL. */
const inFlight = new Map<string, Promise<string | null>>();

/** Tiny stable hash (FNV-1a) for cache filenames. Not cryptographic. */
function hashUrl(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Disk cache file for a URL, or null when disk caching isn't available
 * (web preview). Wrapped defensively — expo-file-system may be unavailable.
 */
function diskFile(url: string): { exists: boolean; read: () => Promise<string>; write: (s: string) => void } | null {
  if (Platform.OS === 'web') return null;
  try {
    // Static require keeps this synchronous; expo-file-system is in the binary.
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(Paths.cache, `dayflow-mms-${hashUrl(url)}.b64`);
    return {
      exists: file.exists,
      read: () => file.text(),
      write: (s: string) => {
        try {
          file.write(s);
        } catch (e) {
          console.warn('[mediaCache] disk write failed', e);
        }
      },
    };
  } catch (e) {
    console.warn('[mediaCache] file system unavailable', e);
    return null;
  }
}

/** Blob → base64 data URI via FileReader (works on RN Hermes and web). */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read media data.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result.startsWith('data:')) resolve(result);
      else reject(new Error('Media data was unreadable.'));
    };
    reader.readAsDataURL(blob);
  });
}

/** Does this response look like actual media (and not an auth error page)? */
function looksLikeMedia(res: Response): boolean {
  if (!res.ok) return false;
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  // Twilio MMS media is image/* (occasionally video/audio). Reject XML/HTML
  // error bodies that S3 returns when the forwarded auth header conflicts.
  if (!type) return true; // some CDNs omit it — trust the 2xx
  return !type.includes('xml') && !type.includes('html') && !type.includes('json');
}

/**
 * Fetch the media bytes. RN's fetch follows the Twilio → S3 redirect and may
 * forward the Authorization header, which S3 can reject (auth conflicts with
 * the signed URL). So: try authed first; on a non-media result, retry bare
 * (Twilio media URLs are fetchable without auth by default).
 */
async function fetchMediaBlob(creds: SmsCredentials, mediaUrl: string): Promise<Blob> {
  const auth = 'Basic ' + btoa(`${creds.accountSid}:${creds.authToken}`);
  let lastStatus = 0;
  try {
    const res = await fetch(mediaUrl, { headers: { Authorization: auth } });
    lastStatus = res.status;
    if (looksLikeMedia(res)) return await res.blob();
    console.warn(`[mediaCache] authed fetch not media (${res.status}); retrying without auth`);
  } catch (e) {
    console.warn('[mediaCache] authed fetch failed; retrying without auth', e);
  }
  const bare = await fetch(mediaUrl);
  if (looksLikeMedia(bare)) return await bare.blob();
  throw new Error(`Media fetch failed (${bare.status || lastStatus}).`);
}

/**
 * Resolve a Twilio media URL to a displayable data URI. Checks memory, then
 * disk, then the network. Returns null on failure (safe to retry later).
 */
export async function getMediaDataUri(
  creds: SmsCredentials,
  mediaUrl: string
): Promise<string | null> {
  if (!mediaUrl) return null;
  const cached = memoryCache.get(mediaUrl);
  if (cached) return cached;
  const pending = inFlight.get(mediaUrl);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    // Disk cache.
    try {
      const file = diskFile(mediaUrl);
      if (file?.exists) {
        const text = await file.read();
        if (text.startsWith('data:')) {
          memoryCache.set(mediaUrl, text);
          return text;
        }
      }
    } catch (e) {
      console.warn('[mediaCache] disk read failed', e);
    }
    // Network.
    try {
      const blob = await fetchMediaBlob(creds, mediaUrl);
      const dataUri = await blobToDataUri(blob);
      memoryCache.set(mediaUrl, dataUri);
      diskFile(mediaUrl)?.write(dataUri);
      return dataUri;
    } catch (e) {
      console.warn('[mediaCache] media load failed', mediaUrl, e);
      return null;
    }
  })();

  inFlight.set(mediaUrl, task);
  try {
    return await task;
  } finally {
    inFlight.delete(mediaUrl);
  }
}

export interface MediaLoadState {
  /** Displayable data URI, or null while loading / on failure. */
  dataUri: string | null;
  loading: boolean;
  /** Friendly error message when the load failed. */
  error: string | null;
}

/**
 * React hook: resolve one media URL to a data URI with load state. Loads
 * credentials itself; pass undefined to render nothing (no media).
 */
export function useMediaDataUri(mediaUrl: string | undefined): MediaLoadState {
  const [state, setState] = useState<MediaLoadState>({
    dataUri: mediaUrl ? memoryCache.get(mediaUrl) ?? null : null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!mediaUrl) {
      setState({ dataUri: null, loading: false, error: null });
      return;
    }
    const hit = memoryCache.get(mediaUrl);
    if (hit) {
      setState({ dataUri: hit, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ dataUri: null, loading: true, error: null });
    (async () => {
      try {
        const creds = await loadSmsCredentials();
        if (!creds) {
          if (alive) setState({ dataUri: null, loading: false, error: 'Messaging is not set up.' });
          return;
        }
        const uri = await getMediaDataUri(creds, mediaUrl);
        if (!alive) return;
        setState(
          uri
            ? { dataUri: uri, loading: false, error: null }
            : { dataUri: null, loading: false, error: 'Photo could not be loaded.' }
        );
      } catch {
        if (alive) setState({ dataUri: null, loading: false, error: 'Photo could not be loaded.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [mediaUrl]);

  return state;
}

/** Drop the in-memory cache (used by tests / sign-out flows). Disk stays. */
export function clearMediaMemoryCache(): void {
  memoryCache.clear();
}
