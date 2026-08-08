import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { normalizePhone, type SmsCredentials } from './smsCredentials';
import {
  clearAssetState,
  collectLiveVersions,
  ensureAssetService,
  ensureEnvironment,
} from './twilioAssets';

/**
 * Calling & voicemail on the user's OWN Twilio account, zero external
 * servers. One serverless Function (deployed into the same 'dayflow-media'
 * Service that hosts MMS photos) handles everything via ?step=:
 *
 *   incoming (default) — Dial the personal cell (20s) with human screening
 *   screen             — forwarded leg answered: Gather 'press 1 to take it'
 *   bridge             — screening keypress received: connect the legs
 *   after              — Dial follow-up: unanswered/busy → Say + Record
 *   connect            — click-to-call: screen the user-leg (press 1)
 *   connectgo          — screening passed: bridge in the client
 *
 * Config lives in Environment Variables (FORWARD_TO, SHOW_WORK_NUMBER,
 * VM_GREETING) — updates are live at the next invocation, no rebuild.
 *
 * All calls are plain REST with Basic auth. Every exported function returns
 * a Result object ({ ok, ... } | { ok: false, error }) and NEVER throws —
 * failures must degrade to a readable error string.
 */

const SERVERLESS = 'https://serverless.twilio.com/v1';
const UPLOAD = 'https://serverless-upload.twilio.com/v1';
const API = 'https://api.twilio.com/2010-04-01';
const FUNCTION_FRIENDLY_NAME = 'voice';
const FUNCTION_PATH = '/voice';
const STORAGE_KEY = 'dayflow-voice-v1';
const BUILD_POLL_INTERVAL_MS = 3000;
const BUILD_POLL_MAX_MS = 90_000;

// ---------------------------------------------------------------------------
// Result types (single error shape for the whole module)
// ---------------------------------------------------------------------------

export interface VoiceApiFailure {
  ok: false;
  /** Human-readable, safe to show in UI as lastError. */
  error: string;
}

export type EnableCallingResult = { ok: true; voiceUrl: string } | VoiceApiFailure;
export type VoiceOkResult = { ok: true } | VoiceApiFailure;
export type ClickToCallResult = { ok: true; callSid: string } | VoiceApiFailure;
export type ListCallsResult = { ok: true; calls: CallEntry[] } | VoiceApiFailure;
export type ListVoicemailsResult = { ok: true; voicemails: VoicemailEntry[] } | VoiceApiFailure;
export type ListTranscriptionsResult =
  | { ok: true; transcriptions: TranscriptionEntry[] }
  | VoiceApiFailure;
export type DownloadRecordingResult = { ok: true; uri: string } | VoiceApiFailure;

/** One call in the history list (internal forward legs already filtered out). */
export interface CallEntry {
  /** Twilio call SID — stable id for dedup. */
  sid: string;
  /** The other party's number (E.164). */
  counterparty: string;
  direction: 'in' | 'out';
  /** Epoch ms. */
  startedAt: number;
  durationSec: number;
  status: string;
  /** Inbound call the user never picked up (voicemail or abandoned). */
  missed: boolean;
}

/** One voicemail recording. Caller number is joined via the parent call. */
export interface VoicemailEntry {
  /** Recording SID. */
  sid: string;
  /** Parent call SID (GET /Calls/{sid} → from = the caller). */
  callSid: string;
  durationSec: number;
  /** Epoch ms. */
  recordedAt: number;
  /** Authed-fetchable .mp3 URL (see downloadRecording). */
  mediaUrl: string;
}

/** One voicemail transcription, joined to its recording via recordingSid. */
export interface TranscriptionEntry {
  /** Transcription SID. */
  sid: string;
  /** The recording this transcribes (VoicemailEntry.sid). */
  recordingSid: string;
  status: 'completed' | 'in-progress' | 'failed';
  /** Empty until status is 'completed'. */
  text: string;
}

/** What the deployed Function reads from its Environment Variables. */
export interface VoiceEnvVars {
  FORWARD_TO: string;
  /** 'true' | 'false'. */
  SHOW_WORK_NUMBER: string;
  VM_GREETING: string;
  /**
   * Expo push token for the inbound-SMS relay. OMIT (undefined) to leave the
   * deployed value untouched — a failed token fetch must never kill push.
   */
  EXPO_PUSH_TOKEN?: string;
}

/** UI-level calling config (mapped onto VoiceEnvVars). */
export interface CallingConfig {
  /** The user's personal cell (E.164). Empty = straight to voicemail. */
  forwardTo: string;
  /** Show the work (Twilio) number as caller ID on forwarded calls. */
  showWorkNumber: boolean;
  /** Voicemail greeting text. */
  greeting: string;
}

function fail(error: string): VoiceApiFailure {
  console.warn('[voiceApi]', error);
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// The serverless Function source (plain JS — Twilio Runtime provides the
// global `Twilio` helper; config comes from context = Environment Variables)
// ---------------------------------------------------------------------------

const VOICE_FUNCTION_SOURCE = `exports.handler = function (context, event, callback) {
  var twiml = new Twilio.twiml.VoiceResponse();
  var step = event.step || 'incoming';
  var forwardTo = context.FORWARD_TO || '';
  var showWork = context.SHOW_WORK_NUMBER === 'true';
  var greeting =
    context.VM_GREETING ||
    "Sorry I missed you — leave a message after the tone and I'll text you back.";

  function voicemail() {
    twiml.say(greeting);
    // Twilio only transcribes recordings up to 120s — cap maxLength there.
    twiml.record({ maxLength: 120, playBeep: true, transcribe: true });
  }

  if (event.RecordingSid || event.RecordingUrl) {
    // Record finished and called back here — end the call, don't re-record.
    twiml.hangup();
  } else if (step === 'connect') {
    // Click-to-call: something answered the user-leg — but carrier voicemail
    // "answers" too. Without screening, the client would be dialed from the
    // work number and bridged straight into the user's PERSONAL voicemail
    // greeting (their real name — the identity this feature exists to hide).
    // A human presses 1; voicemail can't.
    if (event.to) {
      var cg = twiml.gather({
        input: 'dtmf',
        numDigits: 1,
        timeout: 8,
        action: '/voice?step=connectgo&to=' + encodeURIComponent(event.to),
        method: 'POST',
      });
      cg.say('Press 1 to place your call.');
      twiml.hangup();
    } else {
      twiml.hangup();
    }
  } else if (step === 'connectgo') {
    // Screening keypress received — dial the client from the work number.
    if (event.to) {
      twiml.dial({ callerId: event.From }, event.to);
    } else {
      twiml.hangup();
    }
  } else if (step === 'screen') {
    // Runs on the forwarded leg the moment it answers, BEFORE bridging.
    // A human presses a key; carrier voicemail never does, so the leg hangs
    // up, Twilio treats the dial as unanswered, and step=after runs the
    // work voicemail instead of the personal one.
    var gather = twiml.gather({
      input: 'dtmf',
      numDigits: 1,
      timeout: 5,
      action: '/voice?step=bridge',
      method: 'POST',
    });
    gather.say('Press 1 to take the call.');
    twiml.hangup();
  } else if (step === 'bridge') {
    // Keypress received — no verbs, so the screen doc finishes and the legs
    // bridge.
  } else if (step === 'after') {
    // Dial follow-up: anything but an answered call goes to voicemail.
    var s = event.DialCallStatus;
    if (s !== 'completed' && s !== 'answered') voicemail();
  } else if (!forwardTo) {
    voicemail();
  } else {
    var dial = twiml.dial({
      action: '/voice?step=after',
      method: 'POST',
      timeout: 20,
      callerId: showWork ? event.To : event.From,
    });
    dial.number({ url: '/voice?step=screen', method: 'POST' }, forwardTo);
  }
  return callback(null, twiml);
};
`;

/**
 * The inbound-SMS push relay: Twilio calls this the instant a text arrives;
 * it fires a CONTENT-FREE Expo push (generic title/body, the sender only in
 * the tap-through data) so the app updates in seconds instead of on a poll.
 * Replies with empty TwiML so Twilio neither errors nor auto-responds.
 */
const SMS_FUNCTION_SOURCE = `exports.handler = function (context, event, callback) {
  var twiml = new Twilio.twiml.MessagingResponse();
  var token = context.EXPO_PUSH_TOKEN || '';
  if (!token) return callback(null, twiml);
  var https = require('https');
  var payload = JSON.stringify({
    to: token,
    title: 'DayFlow',
    body: 'You have a new message.',
    sound: 'default',
    // No message content — only the counterparty for tap-through routing.
    data: { messageThread: event.From || '' },
  });
  var req = https.request(
    {
      hostname: 'exp.host',
      path: '/--/api/v2/push/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    function () { callback(null, twiml); }
  );
  req.on('error', function () { callback(null, twiml); });
  req.setTimeout(5000, function () { req.destroy(); callback(null, twiml); });
  req.write(payload);
  req.end();
};
`;

const SMS_FUNCTION_FRIENDLY_NAME = 'sms';
const SMS_FUNCTION_PATH = '/sms';

/** Cheap stable hash (djb2) of the deployed source. */
function hashSource(src: string): string {
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Persisted with the deploy state — a mismatch forces a redeploy of BOTH. */
const FUNCTION_SOURCE_HASH = hashSource(VOICE_FUNCTION_SOURCE + SMS_FUNCTION_SOURCE);

// ---------------------------------------------------------------------------
// Persisted deploy state (function/number survive across sessions)
// ---------------------------------------------------------------------------

interface PersistedVoice {
  functionSid?: string;
  /** The inbound-SMS push relay Function. */
  smsFunctionSid?: string;
  phoneNumberSid?: string;
  /** "https://{domain}/voice" once deployed. */
  voiceUrl?: string;
  /** "https://{domain}/sms" once the number's SMS webhook points at us. */
  smsUrl?: string;
  /** The Expo push token last written into the env vars. */
  pushToken?: string;
  /** Hash of the source that was deployed — stale hash forces a redeploy. */
  sourceHash?: string;
}

async function loadPersisted(): Promise<PersistedVoice> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as PersistedVoice) : {};
  } catch {
    return {};
  }
}

async function savePersisted(patch: Partial<PersistedVoice>): Promise<void> {
  try {
    const current = await loadPersisted();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (e) {
    console.warn('[voiceApi] persist failed', e);
  }
}

// ---------------------------------------------------------------------------
// Low-level REST helpers (defensive JSON parsing throughout)
// ---------------------------------------------------------------------------

function authHeader(creds: SmsCredentials): string {
  return 'Basic ' + btoa(`${creds.accountSid}:${creds.authToken}`);
}

function apiBase(creds: SmsCredentials): string {
  return `${API}/Accounts/${encodeURIComponent(creds.accountSid)}`;
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

async function restDelete(creds: SmsCredentials, url: string): Promise<RestResponse> {
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: authHeader(creds) } });
  const json = asRecord(await res.json().catch(() => null));
  return { status: res.status, ok: res.ok, json };
}

/** Twilio error payloads carry a "message" field; fall back to the status. */
function restError(what: string, res: RestResponse): string {
  return str(res.json, 'message') ?? `${what} failed (${res.status})`;
}

// ---------------------------------------------------------------------------
// Function deploy pipeline (mirrors the twilioAssets photo pipeline)
// ---------------------------------------------------------------------------

/** Find a Function by friendly name in the service, creating it if needed. */
async function findOrCreateFunction(
  creds: SmsCredentials,
  serviceSid: string,
  friendlyName: string
): Promise<string | null> {
  const res = await restGet(creds, `${SERVERLESS}/Services/${serviceSid}/Functions?PageSize=50`);
  const list = res.json?.functions;
  if (res.ok && Array.isArray(list)) {
    for (const item of list) {
      const rec = asRecord(item);
      if (str(rec, 'friendly_name') === friendlyName) {
        const sid = str(rec, 'sid');
        if (sid) return sid;
      }
    }
  }
  const form = new URLSearchParams({ FriendlyName: friendlyName });
  const created = await restPostForm(creds, `${SERVERLESS}/Services/${serviceSid}/Functions`, form);
  if (!created.ok) {
    console.warn('[voiceApi]', restError('Function create', created));
    return null;
  }
  return str(created.json, 'sid');
}

/**
 * Upload the Function source as a new protected Version (multipart form to
 * the dedicated upload host). Returns the version sid or null.
 */
async function uploadFunctionVersion(
  creds: SmsCredentials,
  serviceSid: string,
  functionSid: string,
  fnPath: string,
  source: string,
  stageName: string
): Promise<string | null> {
  const url = `${UPLOAD}/Services/${serviceSid}/Functions/${functionSid}/Versions`;
  try {
    let status = 0;
    let body: unknown = null;

    if (Platform.OS === 'web') {
      // Web preview: standard multipart with the source as a Blob.
      const form = new FormData();
      form.append('Path', fnPath);
      form.append('Visibility', 'protected');
      form.append(
        'Content',
        new Blob([source], { type: 'application/javascript' }),
        stageName
      );
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: authHeader(creds) },
        body: form,
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } else {
      // Native: the upload API wants a real file — stage the source in cache.
      const { File, Paths, UploadType } = require('expo-file-system') as typeof import('expo-file-system');
      const file = new File(Paths.cache, stageName);
      file.write(source);
      const result = await file.upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'Content',
        mimeType: 'application/javascript',
        headers: { Authorization: authHeader(creds) },
        parameters: { Path: fnPath, Visibility: 'protected' },
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
        '[voiceApi] function version upload failed',
        status,
        str(rec, 'message') ?? '(unreadable body)'
      );
      return null;
    }
    return versionSid;
  } catch (e) {
    console.warn('[voiceApi] function version upload error', e);
    return null;
  }
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
    console.warn('[voiceApi]', restError('Build create', res));
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
    console.log('[voiceApi] build status:', status ?? `(http ${res.status})`);
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
  if (!res.ok) console.warn('[voiceApi]', restError('Deployment', res));
  return res.ok;
}

/**
 * Make sure the voice Function exists, is built, and is deployed to 'prod'.
 * Skips the slow build/deploy when a previous deploy is on record (config
 * changes go through Environment Variables — no rebuild needed).
 */
async function deployVoiceFunction(
  creds: SmsCredentials
): Promise<{ ok: true; domainName: string } | VoiceApiFailure> {
  const service = await ensureAssetService(creds);
  if (!service.ok) return service;
  const serviceSid = service.serviceSid;

  const envResult = await ensureEnvironment(creds, serviceSid);
  if (!envResult.ok) return envResult;
  const env = envResult.env;

  // The skip is only valid while the deployed source is the current one —
  // a source change must redeploy even with a persisted functionSid. (The
  // number webhooks — voiceUrl/smsUrl — are configured separately; their
  // absence must not force rebuilds for messaging-only users.)
  const persisted = await loadPersisted();
  if (
    persisted.functionSid &&
    persisted.smsFunctionSid &&
    persisted.sourceHash === FUNCTION_SOURCE_HASH
  ) {
    return { ok: true, domainName: env.domainName };
  }

  const functionSid = await findOrCreateFunction(creds, serviceSid, FUNCTION_FRIENDLY_NAME);
  if (!functionSid) return fail('Could not set up calling on your Twilio account.');
  const smsFunctionSid = await findOrCreateFunction(creds, serviceSid, SMS_FUNCTION_FRIENDLY_NAME);
  if (!smsFunctionSid) return fail('Could not set up message push on your Twilio account.');

  console.log('[voiceApi] uploading function sources');
  const versionSid = await uploadFunctionVersion(
    creds, serviceSid, functionSid, FUNCTION_PATH, VOICE_FUNCTION_SOURCE, 'dayflow-voice-function.js'
  );
  if (!versionSid) return fail('Could not upload the voice setup. Check your connection.');
  const smsVersionSid = await uploadFunctionVersion(
    creds, serviceSid, smsFunctionSid, SMS_FUNCTION_PATH, SMS_FUNCTION_SOURCE, 'dayflow-sms-function.js'
  );
  if (!smsVersionSid) return fail('Could not upload the message push setup.');

  // A Build replaces ALL live content — re-bundle the hosted photos (and any
  // other live functions) alongside the new versions. A failed listing
  // aborts the build rather than un-deploying whatever it missed.
  const live = await collectLiveVersions(creds, serviceSid);
  if (!live.ok) return live;
  const functionVersionSids = new Set<string>([
    versionSid,
    smsVersionSid,
    ...live.functionVersionSids,
  ]);

  console.log(
    '[voiceApi] building with',
    functionVersionSids.size,
    'function +',
    live.assetVersionSids.length,
    'asset version(s)'
  );
  const buildSid = await createBuild(
    creds,
    serviceSid,
    live.assetVersionSids,
    [...functionVersionSids]
  );
  if (!buildSid) return fail('Could not start the voice deploy.');

  const buildStatus = await waitForBuild(creds, serviceSid, buildSid);
  if (buildStatus === 'failed') return fail('Voice deploy failed on Twilio.');
  if (buildStatus === 'timeout') return fail('Voice deploy timed out. Try again in a minute.');

  console.log('[voiceApi] deploying build', buildSid);
  const deployed = await createDeployment(creds, serviceSid, env.sid, buildSid);
  if (!deployed) return fail('Could not publish the voice setup.');

  await savePersisted({ functionSid, smsFunctionSid, sourceHash: FUNCTION_SOURCE_HASH });
  return { ok: true, domainName: env.domainName };
}

// ---------------------------------------------------------------------------
// Environment Variables (live config — no rebuild)
// ---------------------------------------------------------------------------

/**
 * Find-or-create-or-update the Function's Environment Variables. Values are
 * live at the next invocation. Empty values delete the variable (the
 * Function treats missing as unset).
 */
export async function setEnvVariables(
  creds: SmsCredentials,
  vars: VoiceEnvVars
): Promise<VoiceOkResult> {
  try {
    const service = await ensureAssetService(creds);
    if (!service.ok) return service;

    const envResult = await ensureEnvironment(creds, service.serviceSid);
    if (!envResult.ok) return envResult;

    const base = `${SERVERLESS}/Services/${service.serviceSid}/Environments/${envResult.env.sid}/Variables`;
    const res = await restGet(creds, `${base}?PageSize=50`);
    if (!res.ok) return fail(restError('Variable list', res));
    const existing = new Map<string, { sid: string; value: string }>();
    const list = res.json?.variables;
    if (Array.isArray(list)) {
      for (const item of list) {
        const rec = asRecord(item);
        const key = str(rec, 'key');
        const sid = str(rec, 'sid');
        if (key && sid) existing.set(key, { sid, value: str(rec, 'value') ?? '' });
      }
    }

    for (const [key, value] of Object.entries(vars)) {
      // undefined = "leave the deployed value alone"; '' = "delete it".
      if (value === undefined) continue;
      const cur = existing.get(key);
      if (!value) {
        if (cur) {
          const del = await restDelete(creds, `${base}/${cur.sid}`);
          if (!del.ok && del.status !== 404) return fail(restError('Variable delete', del));
        }
        continue;
      }
      if (cur?.value === value) continue;
      const form = cur
        ? new URLSearchParams({ Value: value })
        : new URLSearchParams({ Key: key, Value: value });
      const post = await restPostForm(creds, cur ? `${base}/${cur.sid}` : base, form);
      if (!post.ok) return fail(restError('Variable update', post));
    }
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not update the calling settings.');
  }
}

/** Point the number's SMS webhook at the push relay ('/sms'). */
async function configureSmsWebhook(
  creds: SmsCredentials,
  domainName: string
): Promise<VoiceOkResult> {
  const persisted = await loadPersisted();
  const pnSid = persisted.phoneNumberSid ?? (await findIncomingNumberSid(creds));
  if (!pnSid) return fail('Could not find your Twilio number.');
  const smsUrl = `https://${domainName}${SMS_FUNCTION_PATH}`;
  const form = new URLSearchParams({ SmsUrl: smsUrl, SmsMethod: 'POST' });
  const res = await restPostForm(
    creds,
    `${API}/Accounts/${encodeURIComponent(creds.accountSid)}/IncomingPhoneNumbers/${pnSid}.json`,
    form
  );
  if (!res.ok) return fail(restError('SMS webhook', res));
  await savePersisted({ phoneNumberSid: pnSid, smsUrl });
  return { ok: true };
}

/**
 * Self-healing rollout: if the serverless source shipped in this app version
 * differs from what's deployed on the user's Twilio account — or the SMS
 * push webhook / push token aren't wired yet — fix all of it silently. No
 * manual "Save changes" required, ever. Cheap when current (one AsyncStorage
 * read). Call on app foreground whenever messaging or calling is set up.
 */
export async function ensureVoiceFunctionCurrent(
  creds: SmsCredentials,
  cfg: CallingConfig,
  pushToken?: string | null
): Promise<VoiceOkResult> {
  try {
    const persisted = await loadPersisted();
    const deployCurrent =
      persisted.functionSid &&
      persisted.smsFunctionSid &&
      persisted.sourceHash === FUNCTION_SOURCE_HASH;
    const tokenCurrent = pushToken == null || persisted.pushToken === pushToken;
    if (deployCurrent && persisted.smsUrl && tokenCurrent) return { ok: true };

    const deployed = await deployVoiceFunction(creds);
    if (!deployed.ok) return deployed;

    if (!persisted.smsUrl) {
      const hooked = await configureSmsWebhook(creds, deployed.domainName);
      if (!hooked.ok) return hooked;
    }

    const vars = varsFor(cfg);
    if (pushToken) vars.EXPO_PUSH_TOKEN = pushToken;
    const set = await setEnvVariables(creds, vars);
    if (!set.ok) return set;
    if (pushToken) await savePersisted({ pushToken });
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Voice update failed.');
  }
}

function varsFor(cfg: CallingConfig): VoiceEnvVars {
  return {
    FORWARD_TO: cfg.forwardTo ? normalizePhone(cfg.forwardTo) : '',
    SHOW_WORK_NUMBER: cfg.showWorkNumber ? 'true' : 'false',
    VM_GREETING: cfg.greeting,
  };
}

// ---------------------------------------------------------------------------
// Public API — enable/disable, click-to-call, history, voicemail
// ---------------------------------------------------------------------------

/** Find the Incoming Phone Number resource for the account's own number. */
async function findIncomingNumberSid(creds: SmsCredentials): Promise<string | null> {
  const own = normalizePhone(creds.fromNumber);
  const res = await restGet(
    creds,
    `${apiBase(creds)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(own)}`
  );
  if (!res.ok) return null;
  const list = res.json?.incoming_phone_numbers;
  if (!Array.isArray(list) || list.length === 0) return null;
  return str(asRecord(list[0]), 'sid');
}

/**
 * Turn calling on: deploy the Function (slow the first time, ~30-60s), set
 * its config variables, then point the Twilio number's Voice webhook at it.
 */
export async function enableCalling(
  creds: SmsCredentials,
  cfg: CallingConfig
): Promise<EnableCallingResult> {
  try {
    const deployed = await deployVoiceFunction(creds);
    if (!deployed.ok) return deployed;

    const vars = await setEnvVariables(creds, varsFor(cfg));
    if (!vars.ok) return vars;

    const voiceUrl = `https://${deployed.domainName}${FUNCTION_PATH}`;
    const pnSid = await findIncomingNumberSid(creds);
    if (!pnSid) return fail('Could not find your Twilio phone number.');

    const form = new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: 'POST' });
    const res = await restPostForm(creds, `${apiBase(creds)}/IncomingPhoneNumbers/${pnSid}.json`, form);
    if (!res.ok) return fail(restError('Phone number update', res));

    await savePersisted({ phoneNumberSid: pnSid, voiceUrl });
    return { ok: true, voiceUrl };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not enable calling.');
  }
}

/** Push new forward/caller-ID/greeting config. Live at the next call. */
export async function updateCallingConfig(
  creds: SmsCredentials,
  cfg: CallingConfig
): Promise<VoiceOkResult> {
  // Saving settings is also the upgrade path: redeploy first when the bundled
  // function source changed (deployVoiceFunction self-skips on matching hash),
  // so existing installs pick up TwiML fixes without re-running setup.
  const deployed = await deployVoiceFunction(creds);
  if (!deployed.ok) return deployed;
  return setEnvVariables(creds, varsFor(cfg));
}

/** Detach the voice webhook from the Twilio number (calls stop routing to us). */
export async function disableCalling(creds: SmsCredentials): Promise<VoiceOkResult> {
  try {
    const persisted = await loadPersisted();
    const pnSid = persisted.phoneNumberSid ?? (await findIncomingNumberSid(creds));
    if (!pnSid) return { ok: true }; // nothing was ever pointed at us
    const form = new URLSearchParams({ VoiceUrl: '' });
    const res = await restPostForm(creds, `${apiBase(creds)}/IncomingPhoneNumbers/${pnSid}.json`, form);
    if (!res.ok) return fail(restError('Phone number update', res));
    return { ok: true };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not disable calling.');
  }
}

/**
 * Forget all persisted deploy state (voice function AND the shared asset
 * pipeline). Call on account disconnect — the sids/urls belong to the old
 * account and would make every deploy short-circuit against it.
 */
export async function clearVoiceState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[voiceApi] clear persisted state failed', e);
  }
  await clearAssetState();
}

/**
 * Click-to-call: ring the user's cell first (From = the work number); when
 * they answer, the Function's 'connect' step bridges in the client. The
 * client only ever sees the work number.
 */
export async function clickToCall(
  creds: SmsCredentials,
  forwardTo: string,
  clientNumber: string
): Promise<ClickToCallResult> {
  try {
    const to = normalizePhone(forwardTo);
    if (!to) return fail('Add your personal number in Settings first.');
    const client = normalizePhone(clientNumber);
    if (!client) return fail('That number does not look valid.');

    let voiceUrl = (await loadPersisted()).voiceUrl ?? null;
    if (!voiceUrl) {
      const service = await ensureAssetService(creds);
      if (!service.ok) return service;
      const envResult = await ensureEnvironment(creds, service.serviceSid);
      if (!envResult.ok) return envResult;
      voiceUrl = `https://${envResult.env.domainName}${FUNCTION_PATH}`;
    }

    const form = new URLSearchParams({
      To: to,
      From: creds.fromNumber,
      Url: `${voiceUrl}?step=connect&to=${encodeURIComponent(client)}`,
      Method: 'POST',
    });
    const res = await restPostForm(creds, `${apiBase(creds)}/Calls.json`, form);
    if (!res.ok) return fail(restError('Call create', res));
    const callSid = str(res.json, 'sid');
    if (!callSid) return fail('The call could not be started.');
    return { ok: true, callSid };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The call could not be started.');
  }
}

interface TwilioCallRecord {
  sid?: string;
  parent_call_sid?: string | null;
  from?: string;
  to?: string;
  direction?: string;
  status?: string;
  start_time?: string | null;
  date_created?: string | null;
  /** Twilio returns this as a string of seconds, e.g. "42". */
  duration?: string | null;
}

/**
 * Map one raw call record to a CallEntry, or null for internal legs:
 * - child leg to the user's own cell → the forward hop, skip
 * - top-level outbound to the user's own cell → click-to-call user leg, skip
 */
function toCallEntry(rec: TwilioCallRecord, own: string, forwardTo: string): CallEntry | null {
  if (!rec.sid) return null;
  const from = normalizePhone(rec.from ?? '');
  const to = normalizePhone(rec.to ?? '');
  const status = rec.status ?? 'unknown';

  let counterparty: string;
  let direction: 'in' | 'out';
  if (rec.parent_call_sid) {
    if (forwardTo && to === forwardTo) return null;
    counterparty = to;
    direction = 'out';
  } else if (rec.direction === 'inbound') {
    counterparty = from;
    direction = 'in';
  } else {
    if (forwardTo && to === forwardTo) return null;
    counterparty = to;
    direction = 'out';
  }
  if (!counterparty || counterparty === own) return null;

  const when = rec.start_time ?? rec.date_created;
  const durationSec = parseInt(rec.duration ?? '0', 10) || 0;
  return {
    sid: rec.sid,
    counterparty,
    direction,
    startedAt: when ? Date.parse(when) : Date.now(),
    durationSec,
    status,
    // duration covers the WHOLE parent call (greeting + recording included),
    // so a rang-out call still ends 'completed' with nonzero duration —
    // buildCallRows upgrades voicemail rows to missed on top of this.
    missed: direction === 'in' && (status !== 'completed' || durationSec <= 0),
  };
}

/**
 * Recent call history involving the work number, newest first. Twilio needs
 * two queries (To=us covers inbound, From=us covers click-to-call child
 * legs); results are merged/deduped and internal legs are filtered out.
 */
export async function listCallHistory(
  creds: SmsCredentials,
  forwardTo: string,
  pageSize = 100
): Promise<ListCallsResult> {
  try {
    const own = normalizePhone(creds.fromNumber);
    const fwd = normalizePhone(forwardTo);
    const urls = [
      `${apiBase(creds)}/Calls.json?PageSize=${pageSize}&To=${encodeURIComponent(own)}`,
      `${apiBase(creds)}/Calls.json?PageSize=${pageSize}&From=${encodeURIComponent(own)}`,
    ];
    const results = await Promise.all(
      urls.map(async (url) => {
        const res = await restGet(creds, url);
        if (!res.ok) throw new Error(restError('Call list', res));
        const list = res.json?.calls;
        return Array.isArray(list) ? (list as TwilioCallRecord[]) : [];
      })
    );
    const seen = new Set<string>();
    const calls: CallEntry[] = [];
    for (const rec of results.flat()) {
      const entry = toCallEntry(rec, own, fwd);
      if (entry && !seen.has(entry.sid)) {
        seen.add(entry.sid);
        calls.push(entry);
      }
    }
    calls.sort((a, b) => b.startedAt - a.startedAt);
    return { ok: true, calls };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not load the call history.');
  }
}

/** Recent voicemail recordings, newest first (as Twilio returns them). */
export async function listVoicemails(
  creds: SmsCredentials,
  pageSize = 50
): Promise<ListVoicemailsResult> {
  try {
    const res = await restGet(creds, `${apiBase(creds)}/Recordings.json?PageSize=${pageSize}`);
    if (!res.ok) return fail(restError('Recording list', res));
    const list = res.json?.recordings;
    if (!Array.isArray(list)) return fail('Could not read the voicemail list.');

    const voicemails: VoicemailEntry[] = [];
    for (const item of list) {
      const rec = asRecord(item);
      const sid = str(rec, 'sid');
      const callSid = str(rec, 'call_sid');
      if (!sid || !callSid) continue;
      const when = str(rec, 'date_created');
      voicemails.push({
        sid,
        callSid,
        durationSec: parseInt(str(rec, 'duration') ?? '0', 10) || 0,
        recordedAt: when ? Date.parse(when) : Date.now(),
        mediaUrl: `${apiBase(creds)}/Recordings/${sid}.mp3`,
      });
    }
    return { ok: true, voicemails };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not load voicemails.');
  }
}

/**
 * Recent voicemail transcriptions, newest first (as Twilio returns them).
 * Joined to recordings by recordingSid; a recording with no transcription
 * simply never shows up here (e.g. voicemails from before transcription
 * was enabled).
 */
export async function listTranscriptions(
  creds: SmsCredentials,
  pageSize = 50
): Promise<ListTranscriptionsResult> {
  try {
    const res = await restGet(creds, `${apiBase(creds)}/Transcriptions.json?PageSize=${pageSize}`);
    if (!res.ok) return fail(restError('Transcription list', res));
    const list = res.json?.transcriptions;
    if (!Array.isArray(list)) return fail('Could not read the transcription list.');

    const transcriptions: TranscriptionEntry[] = [];
    for (const item of list) {
      const rec = asRecord(item);
      const sid = str(rec, 'sid');
      const recordingSid = str(rec, 'recording_sid');
      if (!sid || !recordingSid) continue;
      const rawStatus = str(rec, 'status');
      transcriptions.push({
        sid,
        recordingSid,
        status:
          rawStatus === 'completed' || rawStatus === 'failed' ? rawStatus : 'in-progress',
        text: str(rec, 'transcription_text') ?? '',
      });
    }
    return { ok: true, transcriptions };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not load transcriptions.');
  }
}

/**
 * The caller number (E.164) of one call — used to label a voicemail with who
 * left it. Best-effort: null on any failure. The store caches the mapping.
 */
export async function fetchCallFrom(
  creds: SmsCredentials,
  callSid: string
): Promise<string | null> {
  try {
    const res = await restGet(
      creds,
      `${apiBase(creds)}/Calls/${encodeURIComponent(callSid)}.json`
    );
    if (!res.ok) return null;
    const from = str(res.json, 'from');
    return from ? normalizePhone(from) : null;
  } catch {
    return null;
  }
}

/** Does this response look like audio (and not an auth error page)? */
function looksLikeAudio(res: Response): boolean {
  if (!res.ok) return false;
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!type) return true; // some CDNs omit it — trust the 2xx
  return !type.includes('xml') && !type.includes('html') && !type.includes('json');
}

/**
 * Fetch the recording bytes. Same approach as src/lib/mediaCache.ts: the
 * Twilio → S3 redirect can reject a forwarded auth header, so try authed
 * first and retry bare on a non-audio result.
 */
async function fetchRecordingBlob(creds: SmsCredentials, mediaUrl: string): Promise<Blob> {
  let lastStatus = 0;
  try {
    const res = await fetch(mediaUrl, { headers: { Authorization: authHeader(creds) } });
    lastStatus = res.status;
    if (looksLikeAudio(res)) return await res.blob();
    console.warn(`[voiceApi] authed fetch not audio (${res.status}); retrying without auth`);
  } catch (e) {
    console.warn('[voiceApi] authed fetch failed; retrying without auth', e);
  }
  const bare = await fetch(mediaUrl);
  if (looksLikeAudio(bare)) return await bare.blob();
  throw new Error(`Voicemail fetch failed (${bare.status || lastStatus}).`);
}

/** Blob → base64 data URI via FileReader (works on RN Hermes and web). */
function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the recording data.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result.startsWith('data:')) resolve(result);
      else reject(new Error('The recording data was unreadable.'));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Download one voicemail to a playable local uri. Native: cached in the
 * file-system cache dir as "voicemail-{sid}.mp3" (subsequent plays are
 * instant). Web: an object URL from the fetched blob.
 */
export async function downloadRecording(
  creds: SmsCredentials,
  sid: string,
  mediaUrl: string
): Promise<DownloadRecordingResult> {
  try {
    if (Platform.OS !== 'web') {
      // Disk-cached copy short-circuits the network entirely.
      const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
      const cached = new File(Paths.cache, `voicemail-${sid}.mp3`);
      if (cached.exists) return { ok: true, uri: cached.uri };
    }

    const blob = await fetchRecordingBlob(creds, mediaUrl);
    if (Platform.OS === 'web') {
      return { ok: true, uri: URL.createObjectURL(blob) };
    }

    // RN blobs lack arrayBuffer() — go through FileReader, then write bytes.
    const dataUri = await blobToDataUri(blob);
    const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(Paths.cache, `voicemail-${sid}.mp3`);
    file.write(bytes);
    return { ok: true, uri: file.uri };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Voicemail download failed.');
  }
}
