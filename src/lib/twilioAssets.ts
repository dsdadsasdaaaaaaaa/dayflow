import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { SmsCredentials } from './smsCredentials';

/**
 * Twilio Serverless Assets pipeline — hosts outbound MMS photos on the
 * user's OWN Twilio account (no third-party hosting). Flow per upload:
 *
 *   Service (find-or-create, once) → Asset → Asset Version (multipart upload)
 *   → Build (bundling every public asset version) → poll build →
 *   Environment (find-or-create 'prod', once) → Deployment → public URL.
 *
 * All calls are plain REST with Basic auth. Every exported function returns
 * a Result object ({ ok, ... } | { ok: false, error }) and NEVER throws —
 * this code path is blind-shipped over the air, so failures must degrade to
 * a readable error string.
 */

const SERVERLESS = 'https://serverless.twilio.com/v1';
const UPLOAD = 'https://serverless-upload.twilio.com/v1';
const SERVICE_UNIQUE_NAME = 'dayflow-media';
const ENVIRONMENT_UNIQUE_NAME = 'prod';
const STORAGE_KEY = 'dayflow-twilio-assets-v1';
const BUILD_POLL_INTERVAL_MS = 3000;
/** How long to wait for a freshly deployed asset to answer at its URL. */
const ASSET_LIVE_MAX_MS = 45_000;
const ASSET_LIVE_POLL_MS = 1500;
const BUILD_POLL_MAX_MS = 90_000;
/** Twilio list page size; listAllPages follows meta.next_page_url past it. */
const LIST_PAGE_SIZE = 50;
/** Hard stop against runaway pagination — exceeding it FAILS the listing. */
const MAX_LIST_PAGES = 20;

// ---------------------------------------------------------------------------
// Result types (single error shape for the whole module)
// ---------------------------------------------------------------------------

export interface TwilioAssetsFailure {
  ok: false;
  /** Human-readable, safe to show in UI as lastError. */
  error: string;
}

export type EnsureServiceResult = { ok: true; serviceSid: string } | TwilioAssetsFailure;
export type UploadPhotoResult = { ok: true; url: string } | TwilioAssetsFailure;
export type ListPhotoAssetsResult =
  | { ok: true; assets: { path: string; url: string }[] }
  | TwilioAssetsFailure;

function fail(error: string): TwilioAssetsFailure {
  console.warn('[twilioAssets]', error);
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Persisted pipeline state (service/environment survive across sessions)
// ---------------------------------------------------------------------------

interface PersistedAssets {
  serviceSid?: string;
  environmentSid?: string;
  /** Full host, e.g. "dayflow-media-1234-ab12cd.twil.io". */
  domainName?: string;
  domainSuffix?: string;
}

async function loadPersisted(): Promise<PersistedAssets> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PersistedAssets) : {};
  } catch {
    return {};
  }
}

async function savePersisted(patch: Partial<PersistedAssets>): Promise<void> {
  try {
    const current = await loadPersisted();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (e) {
    console.warn('[twilioAssets] persist failed', e);
  }
}

// ---------------------------------------------------------------------------
// Low-level REST helpers (defensive JSON parsing throughout)
// ---------------------------------------------------------------------------

function authHeader(creds: SmsCredentials): string {
  return 'Basic ' + btoa(`${creds.accountSid}:${creds.authToken}`);
}

interface RestResponse {
  status: number;
  ok: boolean;
  json: Record<string, unknown> | null;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(rec: Record<string, unknown> | null, key: string): string | null {
  const v = rec?.[key];
  return typeof v === 'string' && v ? v : null;
}

async function restGet(creds: SmsCredentials, url: string): Promise<RestResponse> {
  const res = await fetch(url, { headers: { Authorization: authHeader(creds) } });
  const json = asRecord(await res.json().catch(() => null));
  return { status: res.status, ok: res.ok, json };
}

async function restPostForm(
  creds: SmsCredentials,
  url: string,
  form: URLSearchParams
): Promise<RestResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const json = asRecord(await res.json().catch(() => null));
  return { status: res.status, ok: res.ok, json };
}

/** Twilio error payloads carry a "message" field; fall back to the status. */
function restError(what: string, res: RestResponse): string {
  return str(res.json, 'message') ?? `${what} failed (${res.status})`;
}

/**
 * Fetch EVERY page of a Twilio list (meta.next_page_url), or null on any
 * failure — including a list still unfinished at MAX_LIST_PAGES. Callers use
 * these lists to decide what stays live in a build, so a partial list must
 * read as failure, never as "nothing else exists".
 */
async function listAllPages(
  creds: SmsCredentials,
  firstUrl: string,
  listKey: string
): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < MAX_LIST_PAGES; page++) {
    const res = await restGet(creds, url);
    if (!res.ok) return null;
    const list = res.json?.[listKey];
    if (!Array.isArray(list)) return null;
    for (const item of list) {
      const rec = asRecord(item);
      if (rec) out.push(rec);
    }
    url = str(asRecord(res.json?.meta), 'next_page_url');
  }
  return url ? null : out;
}

// ---------------------------------------------------------------------------
// Typed helpers — one per REST call
// ---------------------------------------------------------------------------

/** GET a Service by unique name (Twilio accepts the name in the sid slot). */
async function getServiceByUniqueName(creds: SmsCredentials): Promise<string | null> {
  const res = await restGet(creds, `${SERVERLESS}/Services/${SERVICE_UNIQUE_NAME}`);
  return res.ok ? str(res.json, 'sid') : null;
}

async function createService(creds: SmsCredentials): Promise<string | null> {
  const form = new URLSearchParams({
    UniqueName: SERVICE_UNIQUE_NAME,
    FriendlyName: 'DayFlow Media',
    IncludeCredentials: 'false',
    UiEditable: 'false',
  });
  const res = await restPostForm(creds, `${SERVERLESS}/Services`, form);
  if (!res.ok) {
    console.warn('[twilioAssets]', restError('Service create', res));
    return null;
  }
  return str(res.json, 'sid');
}

export interface EnvironmentInfo {
  sid: string;
  domainName: string;
}

async function findEnvironment(
  creds: SmsCredentials,
  serviceSid: string
): Promise<EnvironmentInfo | null> {
  const res = await restGet(creds, `${SERVERLESS}/Services/${serviceSid}/Environments`);
  if (!res.ok) return null;
  const list = res.json?.environments;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const rec = asRecord(item);
    if (str(rec, 'unique_name') === ENVIRONMENT_UNIQUE_NAME) {
      const sid = str(rec, 'sid');
      const domainName = str(rec, 'domain_name');
      if (sid && domainName) return { sid, domainName };
    }
  }
  return null;
}

async function createEnvironment(
  creds: SmsCredentials,
  serviceSid: string,
  domainSuffix: string
): Promise<EnvironmentInfo | null> {
  const form = new URLSearchParams({
    UniqueName: ENVIRONMENT_UNIQUE_NAME,
    DomainSuffix: domainSuffix,
  });
  const res = await restPostForm(creds, `${SERVERLESS}/Services/${serviceSid}/Environments`, form);
  if (!res.ok) {
    console.warn('[twilioAssets]', restError('Environment create', res));
    return null;
  }
  const sid = str(res.json, 'sid');
  const domainName = str(res.json, 'domain_name');
  return sid && domainName ? { sid, domainName } : null;
}

async function createAsset(
  creds: SmsCredentials,
  serviceSid: string,
  friendlyName: string
): Promise<string | null> {
  const form = new URLSearchParams({ FriendlyName: friendlyName });
  const res = await restPostForm(creds, `${SERVERLESS}/Services/${serviceSid}/Assets`, form);
  if (!res.ok) {
    console.warn('[twilioAssets]', restError('Asset create', res));
    return null;
  }
  return str(res.json, 'sid');
}

function mimeTypeForFilename(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

/**
 * Upload the file content as a new public Asset Version (multipart form to
 * the dedicated upload host). Returns { versionSid, path } or null.
 */
async function uploadAssetVersion(
  creds: SmsCredentials,
  serviceSid: string,
  assetSid: string,
  localUri: string,
  path: string,
  mimeType: string
): Promise<{ versionSid: string; path: string } | null> {
  const url = `${UPLOAD}/Services/${serviceSid}/Assets/${assetSid}/Versions`;
  try {
    let status = 0;
    let body: unknown = null;

    if (Platform.OS === 'web') {
      // Web preview: pull the local blob and post standard multipart.
      const blob = await (await fetch(localUri)).blob();
      const form = new FormData();
      form.append('Path', path);
      form.append('Visibility', 'public');
      form.append('Content', blob, path.replace(/^\//, ''));
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: authHeader(creds) },
        body: form,
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } else {
      // Native: expo-file-system multipart upload straight from the file URI.
      const { File, UploadType } = require('expo-file-system') as typeof import('expo-file-system');
      const file = new File(localUri);
      if (!file.exists) {
        console.warn('[twilioAssets] local photo file not found', localUri);
        return null;
      }
      const result = await file.upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'Content',
        mimeType,
        headers: { Authorization: authHeader(creds) },
        parameters: { Path: path, Visibility: 'public' },
      });
      status = result.status;
      try {
        body = JSON.parse(result.body);
      } catch {
        body = null;
      }
    }

    const rec = asRecord(body);
    const versionSid = str(rec, 'sid');
    if (status < 200 || status >= 300 || !versionSid) {
      console.warn(
        '[twilioAssets] version upload failed',
        status,
        str(rec, 'message') ?? '(unreadable body)'
      );
      return null;
    }
    return { versionSid, path: str(rec, 'path') ?? path };
  } catch (e) {
    console.warn('[twilioAssets] version upload error', e);
    return null;
  }
}

interface AssetEntry {
  sid: string;
  /** Epoch ms the asset was created (0 when Twilio omitted/garbled it). */
  createdAt: number;
  friendlyName: string;
}

async function listAssets(creds: SmsCredentials, serviceSid: string): Promise<AssetEntry[] | null> {
  const records = await listAllPages(
    creds,
    `${SERVERLESS}/Services/${serviceSid}/Assets?PageSize=${LIST_PAGE_SIZE}`,
    'assets'
  );
  if (!records) return null;
  const out: AssetEntry[] = [];
  for (const rec of records) {
    const sid = str(rec, 'sid');
    if (!sid) continue;
    const created = str(rec, 'date_created');
    const parsed = created ? Date.parse(created) : NaN;
    out.push({
      sid,
      createdAt: Number.isFinite(parsed) ? parsed : 0,
      friendlyName: str(rec, 'friendly_name') ?? '',
    });
  }
  return out;
}

/** DELETE one asset (and its versions) from the service. Best-effort. */
async function deleteAsset(
  creds: SmsCredentials,
  serviceSid: string,
  assetSid: string
): Promise<boolean> {
  try {
    const res = await fetch(`${SERVERLESS}/Services/${serviceSid}/Assets/${assetSid}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader(creds) },
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** Photos older than this stop being hosted on the user's Twilio account. */
const PHOTO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Delete hosted photos older than the retention window. Sent photos are
 * public on a twil.io domain with no expiry, so without this the pile grows
 * forever — every client photo ever sent stays fetchable indefinitely.
 *
 * Runs BEFORE the build in uploadPhotoAsset, so the deploy that publishes the
 * new photo simultaneously stops serving the pruned ones (no extra build).
 * Anything referenced by a photo quick reply is kept regardless of age.
 * Never throws and never blocks a send: a failed prune just retries next time.
 */
export async function prunePhotoAssets(
  creds: SmsCredentials,
  serviceSid: string,
  keepPaths: ReadonlySet<string>
): Promise<number> {
  try {
    const assets = await listAssets(creds, serviceSid);
    if (!assets) return 0;
    const cutoff = Date.now() - PHOTO_RETENTION_MS;
    let deleted = 0;
    for (const a of assets) {
      // createdAt 0 = unknown age; never delete something we can't date.
      if (a.createdAt === 0 || a.createdAt >= cutoff) continue;
      const name = a.friendlyName.startsWith('/') ? a.friendlyName : `/${a.friendlyName}`;
      if (keepPaths.has(name)) continue;
      if (await deleteAsset(creds, serviceSid, a.sid)) deleted++;
    }
    if (deleted > 0) console.log('[twilioAssets] pruned', deleted, 'expired photo(s)');
    return deleted;
  } catch {
    return 0;
  }
}

interface AssetVersionEntry {
  versionSid: string;
  path: string;
  visibility: string;
}

/**
 * Latest version of one asset (Twilio lists newest first). Failure is
 * distinct from "asset has no versions" — a failed lookup must abort any
 * build that would otherwise drop the asset.
 */
async function latestAssetVersion(
  creds: SmsCredentials,
  serviceSid: string,
  assetSid: string
): Promise<{ ok: true; latest: AssetVersionEntry | null } | { ok: false }> {
  const res = await restGet(
    creds,
    `${SERVERLESS}/Services/${serviceSid}/Assets/${assetSid}/Versions?PageSize=1`
  );
  if (!res.ok) return { ok: false };
  const list = res.json?.asset_versions;
  if (!Array.isArray(list)) return { ok: false };
  if (list.length === 0) return { ok: true, latest: null };
  const rec = asRecord(list[0]);
  const versionSid = str(rec, 'sid');
  const path = str(rec, 'path');
  if (!versionSid || !path) return { ok: false };
  return { ok: true, latest: { versionSid, path, visibility: str(rec, 'visibility') ?? 'public' } };
}

interface FunctionEntry {
  sid: string;
}

async function listFunctions(
  creds: SmsCredentials,
  serviceSid: string
): Promise<FunctionEntry[] | null> {
  const records = await listAllPages(
    creds,
    `${SERVERLESS}/Services/${serviceSid}/Functions?PageSize=${LIST_PAGE_SIZE}`,
    'functions'
  );
  if (!records) return null;
  const out: FunctionEntry[] = [];
  for (const rec of records) {
    const sid = str(rec, 'sid');
    if (sid) out.push({ sid });
  }
  return out;
}

/**
 * Latest version sid of one Function (any visibility — Functions must stay
 * live). Failure is distinct from "function has no versions yet".
 */
async function latestFunctionVersionSid(
  creds: SmsCredentials,
  serviceSid: string,
  functionSid: string
): Promise<{ ok: true; sid: string | null } | { ok: false }> {
  const res = await restGet(
    creds,
    `${SERVERLESS}/Services/${serviceSid}/Functions/${functionSid}/Versions?PageSize=1`
  );
  if (!res.ok) return { ok: false };
  const list = res.json?.function_versions;
  if (!Array.isArray(list)) return { ok: false };
  if (list.length === 0) return { ok: true, sid: null };
  const sid = str(asRecord(list[0]), 'sid');
  return sid ? { ok: true, sid } : { ok: false };
}

async function createBuild(
  creds: SmsCredentials,
  serviceSid: string,
  assetVersionSids: string[],
  functionVersionSids: string[]
): Promise<string | null> {
  const form = new URLSearchParams();
  for (const sid of assetVersionSids) form.append('AssetVersions', sid);
  for (const sid of functionVersionSids) form.append('FunctionVersions', sid);
  const res = await restPostForm(creds, `${SERVERLESS}/Services/${serviceSid}/Builds`, form);
  if (!res.ok) {
    console.warn('[twilioAssets]', restError('Build create', res));
    return null;
  }
  return str(res.json, 'sid');
}

/** Poll a build until it completes/fails or the deadline passes. */
async function waitForBuild(
  creds: SmsCredentials,
  serviceSid: string,
  buildSid: string
): Promise<'completed' | 'failed' | 'timeout'> {
  const deadline = Date.now() + BUILD_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const res = await restGet(
      creds,
      `${SERVERLESS}/Services/${serviceSid}/Builds/${buildSid}/Status`
    );
    const status = str(res.json, 'status');
    console.log('[twilioAssets] build status:', status ?? `(http ${res.status})`);
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    await new Promise((r) => setTimeout(r, BUILD_POLL_INTERVAL_MS));
  }
  return 'timeout';
}

async function createDeployment(
  creds: SmsCredentials,
  serviceSid: string,
  environmentSid: string,
  buildSid: string
): Promise<boolean> {
  const form = new URLSearchParams({ BuildSid: buildSid });
  const res = await restPostForm(
    creds,
    `${SERVERLESS}/Services/${serviceSid}/Environments/${environmentSid}/Deployments`,
    form
  );
  if (!res.ok) console.warn('[twilioAssets]', restError('Deployment', res));
  return res.ok;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Forget the persisted service/environment state. Call on account
 * disconnect — the sids/domain belong to the old account and would
 * short-circuit every pipeline step against the wrong account.
 */
export async function clearAssetState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[twilioAssets] clear persisted state failed', e);
  }
}

/**
 * Find-or-create the DayFlow media Service on the user's account. The SID is
 * persisted; later calls short-circuit to it.
 */
export async function ensureAssetService(creds: SmsCredentials): Promise<EnsureServiceResult> {
  try {
    const persisted = await loadPersisted();
    if (persisted.serviceSid) return { ok: true, serviceSid: persisted.serviceSid };

    let sid = await getServiceByUniqueName(creds);
    if (!sid) sid = await createService(creds);
    if (!sid) return fail('Could not set up photo hosting on your Twilio account.');
    await savePersisted({ serviceSid: sid });
    return { ok: true, serviceSid: sid };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Photo hosting setup failed.');
  }
}

/** Find-or-create the 'prod' Environment (its domain serves the photos). */
export async function ensureEnvironment(
  creds: SmsCredentials,
  serviceSid: string
): Promise<{ ok: true; env: EnvironmentInfo } | TwilioAssetsFailure> {
  const persisted = await loadPersisted();
  if (persisted.environmentSid && persisted.domainName) {
    return { ok: true, env: { sid: persisted.environmentSid, domainName: persisted.domainName } };
  }

  let env = await findEnvironment(creds, serviceSid);
  if (!env) {
    const suffix = persisted.domainSuffix ?? Math.random().toString(36).slice(2, 8);
    await savePersisted({ domainSuffix: suffix });
    env = await createEnvironment(creds, serviceSid, suffix);
  }
  if (!env) return fail('Could not set up the photo hosting domain.');
  await savePersisted({ environmentSid: env.sid, domainName: env.domainName });
  return { ok: true, env };
}

export interface LiveVersions {
  /** Latest PUBLIC version of every asset. */
  assetVersionSids: string[];
  /** Latest version of every Function (any visibility). */
  functionVersionSids: string[];
}

export type LiveVersionsResult = ({ ok: true } & LiveVersions) | TwilioAssetsFailure;

/**
 * Everything currently live in the service that a new Build must re-bundle:
 * the latest public version of each Asset PLUS the latest version of each
 * Function. A Build replaces ALL live content on deploy, so a build made
 * from a partial listing would silently un-deploy whatever the listing
 * missed (the voice webhook, or every hosted photo) — any listing failure
 * here is a typed failure the caller MUST abort the build on.
 */
export async function collectLiveVersions(
  creds: SmsCredentials,
  serviceSid: string
): Promise<LiveVersionsResult> {
  const photosError =
    'Could not confirm the photos already hosted, so nothing was deployed. ' +
    'Check your connection and try again.';
  const assets = await listAssets(creds, serviceSid);
  if (!assets) return fail(photosError);
  const assetVersionSids: string[] = [];
  const latestAssets = await Promise.all(
    assets.map((a) => latestAssetVersion(creds, serviceSid, a.sid))
  );
  for (const v of latestAssets) {
    if (!v.ok) return fail(photosError);
    if (v.latest && v.latest.visibility === 'public') assetVersionSids.push(v.latest.versionSid);
  }

  const functionsError =
    'Could not confirm the calling setup already deployed, so nothing was ' +
    'deployed. Check your connection and try again.';
  const fns = await listFunctions(creds, serviceSid);
  if (!fns) return fail(functionsError);
  const functionVersionSids: string[] = [];
  const latestFns = await Promise.all(
    fns.map((f) => latestFunctionVersionSid(creds, serviceSid, f.sid))
  );
  for (const v of latestFns) {
    if (!v.ok) return fail(functionsError);
    if (v.sid) functionVersionSids.push(v.sid);
  }

  return { ok: true, assetVersionSids, functionVersionSids };
}

/** Flat list of every live version sid (assets + functions). */
export async function collectLiveVersionSids(
  creds: SmsCredentials,
  serviceSid: string
): Promise<{ ok: true; sids: string[] } | TwilioAssetsFailure> {
  const live = await collectLiveVersions(creds, serviceSid);
  if (!live.ok) return live;
  return { ok: true, sids: [...live.assetVersionSids, ...live.functionVersionSids] };
}

/** "/photo-....jpg" — URL-safe path for a new asset. */
function assetPathFor(filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+/, '');
  return `/${safe || `photo-${Date.now()}.jpg`}`;
}

/**
 * Host one local photo publicly on the user's Twilio account and return its
 * URL (usable as an MMS MediaUrl). Slow path: bundling + deploy is ~30-60s.
 */
/**
 * A Twilio Serverless deployment returns before the asset is actually being
 * served at its public URL — propagation takes a few seconds. Sending the MMS
 * immediately means Twilio tries to fetch a URL that isn't live yet, and the
 * message fails at the Twilio stage with no media attached. So: poll the real
 * URL until it answers before handing it to the messaging API.
 */
async function waitForAssetLive(url: string): Promise<boolean> {
  const deadline = Date.now() + ASSET_LIVE_MAX_MS;
  while (Date.now() < deadline) {
    try {
      // MUST be GET: the twil.io asset host answers HEAD with 405, so a HEAD
      // probe never succeeds even when the photo is perfectly live. Range
      // keeps it to a byte where the host honors it (206); hosts that ignore
      // it answer 200, which is equally good news.
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (res.status === 200 || res.status === 206) return true;
    } catch {
      // Network blip mid-propagation — keep waiting.
    }
    await new Promise((r) => setTimeout(r, ASSET_LIVE_POLL_MS));
  }
  return false;
}

export async function uploadPhotoAsset(
  creds: SmsCredentials,
  localUri: string,
  filename: string,
  /** Asset paths to keep regardless of age (photo quick replies). */
  keepPaths: ReadonlySet<string> = new Set()
): Promise<UploadPhotoResult> {
  try {
    const service = await ensureAssetService(creds);
    if (!service.ok) return service;
    const serviceSid = service.serviceSid;

    const envResult = await ensureEnvironment(creds, serviceSid);
    if (!envResult.ok) return envResult;
    const env = envResult.env;

    const path = assetPathFor(filename);
    const mimeType = mimeTypeForFilename(filename);

    console.log('[twilioAssets] creating asset for', path);
    const assetSid = await createAsset(creds, serviceSid, path.slice(1));
    if (!assetSid) return fail('Could not create the photo asset.');

    console.log('[twilioAssets] uploading content');
    const version = await uploadAssetVersion(creds, serviceSid, assetSid, localUri, path, mimeType);
    if (!version) return fail('Photo upload failed. Check your connection and try again.');

    // Retire expired photos first: the build below then simply omits them,
    // so one deploy both publishes the new photo and un-serves the old ones.
    await prunePhotoAssets(creds, serviceSid, keepPaths);

    // A build must include EVERY version that should stay live — existing
    // public assets AND every Function (e.g. the voice webhook), or they go
    // offline when this build deploys. A failed listing aborts the build.
    const live = await collectLiveVersions(creds, serviceSid);
    if (!live.ok) return live;
    const versionSids = new Set<string>([version.versionSid, ...live.assetVersionSids]);

    console.log(
      '[twilioAssets] building with',
      versionSids.size,
      'asset +',
      live.functionVersionSids.length,
      'function version(s)'
    );
    const buildSid = await createBuild(creds, serviceSid, [...versionSids], live.functionVersionSids);
    if (!buildSid) return fail('Could not start the photo publish step.');

    const buildStatus = await waitForBuild(creds, serviceSid, buildSid);
    if (buildStatus === 'failed') return fail('Photo publish failed on Twilio.');
    if (buildStatus === 'timeout') return fail('Photo publish timed out. Try again in a minute.');

    console.log('[twilioAssets] deploying build', buildSid);
    const deployed = await createDeployment(creds, serviceSid, env.sid, buildSid);
    if (!deployed) return fail('Could not publish the photo.');

    const url = `https://${env.domainName}${version.path}`;
    // Do NOT hand back a URL Twilio can't fetch yet — that produces an MMS
    // with no media that fails ~5s later for reasons the user can't see.
    const servingLive = await waitForAssetLive(url);
    if (!servingLive) {
      return fail(
        'The photo was uploaded but is not being served yet. Wait a moment and try again.'
      );
    }
    console.log('[twilioAssets] photo live');
    return { ok: true, url };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Photo upload failed.');
  }
}

/**
 * List public photo assets already hosted on the environment (the photo
 * quick-reply library) as { path, url } pairs.
 */
export async function listPhotoAssets(creds: SmsCredentials): Promise<ListPhotoAssetsResult> {
  try {
    const service = await ensureAssetService(creds);
    if (!service.ok) return service;

    const envResult = await ensureEnvironment(creds, service.serviceSid);
    if (!envResult.ok) return envResult;
    const domain = envResult.env.domainName;

    const assets = await listAssets(creds, service.serviceSid);
    if (!assets) return fail('Could not list hosted photos.');

    const versions = await Promise.all(
      assets.map((a) => latestAssetVersion(creds, service.serviceSid, a.sid))
    );
    const out: { path: string; url: string }[] = [];
    for (const v of versions) {
      if (!v.ok) return fail('Could not list hosted photos.');
      if (v.latest && v.latest.visibility === 'public') {
        out.push({ path: v.latest.path, url: `https://${domain}${v.latest.path}` });
      }
    }
    return { ok: true, assets: out };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not list hosted photos.');
  }
}
