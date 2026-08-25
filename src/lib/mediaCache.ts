import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { loadSmsCredentials, type SmsCredentials } from './smsCredentials';

/**
 * MMS media cache. Twilio media URLs require Basic auth and redirect to a
 * short-lived S3 URL, so we fetch once and cache the BYTES on disk, then
 * render the file:// URI. (The old design cached base64 data URIs in JS
 * memory — megabytes of Hermes strings re-crossing the bridge on every
 * scroll. Files are decoded natively and cost the JS side a short path.)
 *
 * Web preview has no usable file store — it falls back to in-memory data
 * URIs, which is fine for a dev preview.
 *
 * Everything here is best-effort and never throws to callers: failures come
 * back as null / an error string, and messages without media are untouched.
 */

/** In-memory: media URL → displayable uri (file:// native, data: web). */
const memoryCache = new Map<string, string>();
/** De-dupe concurrent loads of the same URL. */
const inFlight = new Map<string, Promise<string | null>>();

/** Keep at most this many cached media files; oldest pruned at startup. */
const MAX_CACHED_FILES = 200;

/** Tiny stable hash (FNV-1a) for cache filenames. Not cryptographic. */
function hashUrl(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

type FS = typeof import('expo-file-system');

function fs(): FS | null {
  if (Platform.OS === 'web') return null;
  try {
    // Static require keeps this synchronous; expo-file-system is in the binary.
    return require('expo-file-system') as FS;
  } catch {
    return null;
  }
}

function extFor(contentType: string): string {
  const t = contentType.toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('gif')) return 'gif';
  if (t.includes('webp')) return 'webp';
  if (t.includes('heic') || t.includes('heif')) return 'heic';
  return 'jpg';
}

/** Any already-cached file for this URL (extension unknown at lookup time). */
function findCachedFile(url: string): string | null {
  const mod = fs();
  if (!mod) return null;
  try {
    const prefix = `dayflow-mms-${hashUrl(url)}`;
    for (const entry of mod.Paths.cache.list()) {
      if (entry instanceof mod.File && entry.name.startsWith(prefix)) {
        return entry.uri;
      }
    }
  } catch {
    // Cache dir unavailable.
  }
  return null;
}

/**
 * One-time startup prune: keep the newest MAX_CACHED_FILES media files.
 * Fire-and-forget — a failed prune never blocks a photo load.
 */
let pruned = false;
function pruneMediaCache(): void {
  if (pruned) return;
  pruned = true;
  const mod = fs();
  if (!mod) return;
  try {
    const files = mod.Paths.cache
      .list()
      .filter(
        (e): e is InstanceType<FS['File']> =>
          e instanceof mod.File && e.name.startsWith('dayflow-mms-')
      );
    if (files.length <= MAX_CACHED_FILES) return;
    const dated = files
      .map((f) => {
        let at = 0;
        try {
          at = f.modificationTime ?? 0;
        } catch {
          at = 0;
        }
        return { f, at };
      })
      .sort((a, b) => b.at - a.at);
    for (const { f } of dated.slice(MAX_CACHED_FILES)) {
      try {
        f.delete();
      } catch {
        // A stuck file just survives until next prune.
      }
    }
  } catch {
    // Best-effort.
  }
}

/** Blob → base64 data URI via FileReader (web fallback path). */
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
/** Twilio's media subresource is the only host our Basic auth belongs to. */
function isTwilioMedia(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.twilio.com');
  } catch {
    return false;
  }
}

async function fetchMediaResponse(
  creds: SmsCredentials | null,
  mediaUrl: string
): Promise<Response> {
  let lastStatus = 0;
  // Never offer credentials to a host that is not Twilio: other routes (e.g.
  // Telerivet) serve attachments from their own public URLs, and an
  // Authorization header aimed at them would leak the account token.
  if (creds && isTwilioMedia(mediaUrl)) {
    const auth = 'Basic ' + btoa(`${creds.accountSid}:${creds.authToken}`);
    try {
      const res = await fetch(mediaUrl, { headers: { Authorization: auth } });
      lastStatus = res.status;
      if (looksLikeMedia(res)) return res;
      console.warn(`[mediaCache] authed fetch not media (${res.status}); retrying without auth`);
    } catch (e) {
      console.warn('[mediaCache] authed fetch failed; retrying without auth', e);
    }
  }
  const bare = await fetch(mediaUrl);
  if (looksLikeMedia(bare)) return bare;
  throw new Error(`Media fetch failed (${bare.status || lastStatus}).`);
}

/**
 * Resolve a Twilio media URL to a displayable uri. Checks memory, then disk,
 * then the network (native: bytes → file:// URI; web: data URI in memory).
 * Returns null on failure (safe to retry later).
 */
export async function getMediaDataUri(
  creds: SmsCredentials | null,
  mediaUrl: string
): Promise<string | null> {
  if (!mediaUrl) return null;
  pruneMediaCache();
  const cached = memoryCache.get(mediaUrl);
  if (cached) return cached;
  const pending = inFlight.get(mediaUrl);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    // Disk cache (native only).
    const onDisk = findCachedFile(mediaUrl);
    if (onDisk) {
      memoryCache.set(mediaUrl, onDisk);
      return onDisk;
    }
    // Network.
    try {
      const res = await fetchMediaResponse(creds, mediaUrl);
      const mod = fs();
      if (mod) {
        const contentType = res.headers.get('content-type') ?? 'image/jpeg';
        const bytes = new Uint8Array(await res.arrayBuffer());
        const file = new mod.File(
          mod.Paths.cache,
          `dayflow-mms-${hashUrl(mediaUrl)}.${extFor(contentType)}`
        );
        try {
          if (!file.exists) file.create();
          file.write(bytes);
        } catch (e) {
          console.warn('[mediaCache] disk write failed', e);
          // Fall back to a data URI for this session only.
          const dataUri = await blobToDataUri(await (await fetch(mediaUrl)).blob());
          memoryCache.set(mediaUrl, dataUri);
          return dataUri;
        }
        memoryCache.set(mediaUrl, file.uri);
        return file.uri;
      }
      // Web preview: data URI in memory.
      const dataUri = await blobToDataUri(await res.blob());
      memoryCache.set(mediaUrl, dataUri);
      return dataUri;
    } catch (e) {
      console.warn('[mediaCache] media load failed', e);
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

/**
 * Pre-seed the cache: a photo we just SENT already exists locally — map its
 * hosted URL to the local file so the bubble renders instantly instead of
 * re-downloading what we uploaded seconds ago.
 */
export function primeMediaCache(hostedUrl: string, localUri: string): void {
  if (hostedUrl && localUri) memoryCache.set(hostedUrl, localUri);
}

export interface MediaLoadState {
  /** Displayable uri (file:// or data:), or null while loading / on failure. */
  uri: string | null;
  loading: boolean;
  /** Friendly error message when the load failed. */
  error: string | null;
  /** Re-attempt a failed load (no-op while loading or after success). */
  retry: () => void;
}

/**
 * React hook: resolve one media URL to a displayable uri with load state and
 * a retry affordance. Loads credentials itself; pass undefined for no media.
 */
export function useMediaDataUri(mediaUrl: string | undefined): MediaLoadState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<MediaLoadState, 'retry'>>({
    uri: mediaUrl ? memoryCache.get(mediaUrl) ?? null : null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!mediaUrl) {
      setState({ uri: null, loading: false, error: null });
      return;
    }
    const hit = memoryCache.get(mediaUrl);
    if (hit) {
      setState({ uri: hit, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ uri: null, loading: true, error: null });
    (async () => {
      try {
        const creds = await loadSmsCredentials();
        const uri = await getMediaDataUri(creds, mediaUrl);
        if (!alive) return;
        setState(
          uri
            ? { uri, loading: false, error: null }
            : { uri: null, loading: false, error: 'Photo could not be loaded.' }
        );
      } catch {
        if (alive) setState({ uri: null, loading: false, error: 'Photo could not be loaded.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [mediaUrl, attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}

/** Drop the in-memory cache (used by tests / sign-out flows). Disk stays. */
export function clearMediaMemoryCache(): void {
  memoryCache.clear();
}
