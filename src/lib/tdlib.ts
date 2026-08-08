import { Platform } from 'react-native';
import { loadTelegramCredentials } from './telegramCredentials';

/**
 * The ONLY file that touches react-native-tdlib (personal-account Telegram).
 *
 * OTA SAFETY: the binary currently on users' phones may NOT contain the
 * native module, and its JS entry THROWS at require time when the module is
 * not linked. Every access goes through a lazy, cached, try/catch'd require —
 * never import the package at the top level, here or anywhere else. On web or
 * an old binary every call degrades to a typed failure ('unavailable').
 *
 * PRIVACY: never log message bodies, phone numbers, or credentials.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TdAuthState =
  | 'unconfigured'
  | 'waitPhone'
  | 'waitCode'
  | 'waitPassword'
  | 'ready'
  | 'unavailable';

/** A parsed Telegram message, normalized for DayFlow. */
export interface TgMessage {
  /** '<chatId>:<messageId>' — stable id for dedup. */
  id: string;
  /** 'tgc:<chatId>' — sits beside SMS E.164 ids in client linking. */
  counterparty: string;
  direction: 'in' | 'out';
  body: string;
  /** Epoch ms. */
  sentAt: number;
  /** Largest photo size's TDLib file id, when the message is a photo. */
  photoFileId?: number;
  senderName?: string;
}

/** A private chat from the user's Telegram account. */
export interface TgChat {
  chatId: string;
  title: string;
  isPrivate: boolean;
  unreadCount: number;
  lastMessage?: TgMessage;
  smallPhotoFileId?: number;
}

/** Parsed, typed TDLib updates DayFlow cares about. */
export type TdUpdate =
  | { kind: 'newMessage'; chatId: string; message: TgMessage }
  | { kind: 'sendSucceeded'; chatId: string; oldMessageId: number; message: TgMessage }
  | { kind: 'chatLastMessage'; chatId: string; message: TgMessage | null }
  | { kind: 'authState'; state: TdAuthState }
  | { kind: 'file'; fileId: number; localPath: string | null; completed: boolean }
  | { kind: 'user'; userId: string; name: string };

/** Typed success/failure for every TDLib operation. */
export type TdOutcome<T = void> = { ok: true; value: T } | { ok: false; error: string };

const UNAVAILABLE: { ok: false; error: string } = {
  ok: false,
  error: 'Telegram arrives with the next app build.',
};

// ---------------------------------------------------------------------------
// Lazy native module access
// ---------------------------------------------------------------------------

type TdModule = typeof import('react-native-tdlib')['default'];

let cachedModule: TdModule | null | undefined;

function tdModule(): TdModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS === 'web') {
    cachedModule = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-tdlib') as { default?: TdModule };
    cachedModule = mod?.default ?? null;
  } catch {
    // Old binary without the native module — the package throws on require.
    cachedModule = null;
  }
  return cachedModule;
}

/** Is the native TDLib module present in this binary? Cached probe. */
export function tdAvailable(): boolean {
  return tdModule() != null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let started = false;
let emitterWired = false;
let currentAuthState: TdAuthState = 'unconfigured';
const listeners = new Set<(u: TdUpdate) => void>();
/** user_id → display name, fed by updateUser events. */
const userNames = new Map<number, string>();

function emit(update: TdUpdate): void {
  for (const cb of [...listeners]) {
    try {
      cb(update);
    } catch {
      // A broken subscriber must not break the stream.
    }
  }
}

/**
 * Subscribe to parsed TDLib updates. Returns an unsubscribe function.
 * Safe everywhere (on web/old binaries no updates ever arrive).
 */
export function onTdUpdate(cb: (u: TdUpdate) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Raw JSON parsing helpers (TDLib objects — defensively typed)
// ---------------------------------------------------------------------------

interface RawObject {
  [key: string]: unknown;
}

function asObject(value: unknown): RawObject | null {
  return typeof value === 'object' && value !== null ? (value as RawObject) : null;
}

function safeParse(raw: unknown): RawObject | null {
  if (typeof raw !== 'string') return asObject(raw);
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function typeOf(obj: RawObject | null): string {
  return (obj && str(obj['@type'])) || '';
}

/** Largest photo size's file id from a TDLib photo object. */
function largestPhotoFileId(photo: RawObject | null): number | undefined {
  const sizes = photo?.sizes;
  if (!Array.isArray(sizes)) return undefined;
  let best: number | undefined;
  let bestArea = -1;
  for (const entry of sizes) {
    const size = asObject(entry);
    if (!size) continue;
    const file = asObject(size.photo);
    const id = num(file?.id);
    if (id == null) continue;
    const area = (num(size.width) ?? 0) * (num(size.height) ?? 0);
    if (area >= bestArea) {
      bestArea = area;
      best = id;
    }
  }
  return best;
}

/** Parse a raw TDLib message object into a TgMessage (null when malformed). */
function parseMessage(rawMsg: RawObject | null): TgMessage | null {
  if (!rawMsg || typeOf(rawMsg) !== 'message') return null;
  const messageId = num(rawMsg.id);
  const chatId = num(rawMsg.chat_id);
  if (messageId == null || chatId == null) return null;

  const content = asObject(rawMsg.content);
  const text = asObject(content?.text);
  const caption = asObject(content?.caption);
  const body = str(text?.text) ?? str(caption?.text) ?? '';
  const photoFileId =
    typeOf(content) === 'messagePhoto' ? largestPhotoFileId(asObject(content?.photo)) : undefined;

  const sender = asObject(rawMsg.sender_id);
  const senderUserId = num(sender?.user_id);
  const senderName = senderUserId != null ? userNames.get(senderUserId) : undefined;

  const message: TgMessage = {
    id: `${chatId}:${messageId}`,
    counterparty: `tgc:${chatId}`,
    direction: rawMsg.is_outgoing === true ? 'out' : 'in',
    body,
    sentAt: (num(rawMsg.date) ?? 0) * 1000,
  };
  if (photoFileId != null) message.photoFileId = photoFileId;
  if (senderName) message.senderName = senderName;
  return message;
}

function mapAuthState(tdType: string): TdAuthState | null {
  switch (tdType) {
    case 'authorizationStateWaitTdlibParameters':
    case 'authorizationStateWaitEncryptionKey':
      return 'unconfigured';
    case 'authorizationStateWaitPhoneNumber':
    case 'authorizationStateWaitOtherDeviceConfirmation':
      return 'waitPhone';
    case 'authorizationStateWaitCode':
    case 'authorizationStateWaitRegistration':
      return 'waitCode';
    case 'authorizationStateWaitPassword':
      return 'waitPassword';
    case 'authorizationStateReady':
      return 'ready';
    case 'authorizationStateLoggingOut':
    case 'authorizationStateClosing':
    case 'authorizationStateClosed':
      return 'unconfigured';
    default:
      return null;
  }
}

function rememberUser(user: RawObject | null): { userId: string; name: string } | null {
  const id = num(user?.id);
  if (user == null || id == null) return null;
  const name = [str(user.first_name) ?? '', str(user.last_name) ?? '']
    .filter(Boolean)
    .join(' ')
    .trim();
  if (name) userNames.set(id, name);
  return { userId: String(id), name };
}

/** Route one raw 'tdlib-update' event into the typed dispatcher. */
function handleRawUpdate(event: { type?: string; raw?: string } | null | undefined): void {
  const raw = safeParse(event?.raw);
  const tdType = typeOf(raw) || (event?.type ?? '');
  if (!raw) return;

  switch (tdType) {
    case 'updateAuthorizationState': {
      const state = mapAuthState(typeOf(asObject(raw.authorization_state)));
      if (state) {
        currentAuthState = state;
        emit({ kind: 'authState', state });
      }
      return;
    }
    case 'updateNewMessage': {
      const message = parseMessage(asObject(raw.message));
      if (message) {
        emit({ kind: 'newMessage', chatId: message.counterparty.slice(4), message });
      }
      return;
    }
    case 'updateMessageSendSucceeded': {
      // A just-sent message traded its temporary id for the permanent one —
      // without this, the pending copy and the confirmed copy both render.
      const message = parseMessage(asObject(raw.message));
      const oldMessageId = num(raw.old_message_id);
      if (message && oldMessageId != null) {
        emit({
          kind: 'sendSucceeded',
          chatId: message.counterparty.slice(4),
          oldMessageId,
          message,
        });
      }
      return;
    }
    case 'updateChatLastMessage': {
      const chatId = num(raw.chat_id);
      if (chatId == null) return;
      emit({
        kind: 'chatLastMessage',
        chatId: String(chatId),
        message: parseMessage(asObject(raw.last_message)),
      });
      return;
    }
    case 'updateFile': {
      const file = asObject(raw.file);
      const fileId = num(file?.id);
      if (fileId == null) return;
      const local = asObject(file?.local);
      const completed = local?.is_downloading_completed === true;
      emit({
        kind: 'file',
        fileId,
        localPath: completed ? str(local?.path) : null,
        completed,
      });
      return;
    }
    case 'updateUser': {
      const info = rememberUser(asObject(raw.user));
      if (info && info.name) emit({ kind: 'user', userId: info.userId, name: info.name });
      return;
    }
    default:
      return;
  }
}

function wireEmitter(): void {
  if (emitterWired || Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require('react-native') as typeof import('react-native');
    const native = rn.NativeModules?.TdLibModule;
    if (!native) return;
    const emitter = new rn.NativeEventEmitter(native);
    emitter.addListener('tdlib-update', (event: { type?: string; raw?: string }) => {
      try {
        handleRawUpdate(event);
      } catch {
        // Malformed update — ignore.
      }
    });
    emitterWired = true;
  } catch {
    // Emitter unavailable on this binary.
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start TDLib with the stored api credentials + device metadata and wire the
 * update stream (once). Idempotent — repeat calls are cheap no-ops.
 */
export async function tdStart(): Promise<TdOutcome> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  if (started) return { ok: true, value: undefined };

  const creds = await loadTelegramCredentials();
  if (!creds) {
    currentAuthState = 'unconfigured';
    return { ok: false, error: 'Telegram is not set up yet.' };
  }

  let deviceModel = 'iPhone';
  let systemVersion = String(Platform.Version ?? '');
  try {
    const device = await import('expo-device');
    deviceModel = device.modelName ?? deviceModel;
    systemVersion = device.osVersion ?? systemVersion;
  } catch {
    // Defaults are fine.
  }

  try {
    wireEmitter();
    await td.startTdLib({
      api_id: creds.apiId,
      api_hash: creds.apiHash,
      system_language_code: 'en',
      device_model: deviceModel,
      system_version: systemVersion,
      application_version: '1.0.0',
    });
    started = true;
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Telegram failed to start.' };
  }
}

/**
 * Current authorization state. Polls TDLib when running; otherwise derived
 * from availability/credentials. Also kept live by updateAuthorizationState.
 */
export async function tdAuthState(): Promise<TdAuthState> {
  const td = tdModule();
  if (!td) return 'unavailable';
  if (!started) {
    const creds = await loadTelegramCredentials();
    return creds ? currentAuthState : 'unconfigured';
  }
  try {
    const raw = safeParse(await td.getAuthorizationState());
    // Some builds wrap the state, some return it directly.
    const direct = mapAuthState(typeOf(raw));
    const nested = mapAuthState(typeOf(asObject(raw?.authorization_state)));
    const state = direct ?? nested;
    if (state) currentAuthState = state;
  } catch {
    // Keep the last event-driven state.
  }
  return currentAuthState;
}

/** Submit the phone number (starts the OTP flow). */
export async function tdLogin(countryCode: string, phone: string): Promise<TdOutcome> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  try {
    await td.login({ countrycode: countryCode, phoneNumber: phone });
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send the code.' };
  }
}

/** Submit the login code Telegram sent. */
export async function tdVerifyCode(code: string): Promise<TdOutcome> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  try {
    await td.verifyPhoneNumber(code);
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Code check failed.' };
  }
}

/** Submit the two-step verification password. */
export async function tdVerifyPassword(password: string): Promise<TdOutcome> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  try {
    await td.verifyPassword(password);
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Password check failed.' };
  }
}

/** Log out of the Telegram account (clears TDLib's local database). */
export async function tdLogout(): Promise<TdOutcome> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  try {
    await td.logout();
    started = false;
    currentAuthState = 'unconfigured';
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Logout failed.' };
  }
}

// ---------------------------------------------------------------------------
// Chats & messages
// ---------------------------------------------------------------------------

/** Load the chat list and return PRIVATE chats only (DMs), parsed. */
export async function tdLoadChats(): Promise<TdOutcome<TgChat[]>> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  try {
    try {
      await td.loadChats(200);
    } catch {
      // TDLib answers 404 when every chat is already loaded — fine.
    }
    const parsed = safeParse(await td.getChats(200));
    const list = Array.isArray(parsed) ? parsed : (parsed?.chats as unknown);
    const rawChats: unknown[] = Array.isArray(list) ? list : [];
    const chats: TgChat[] = [];
    for (const entry of rawChats) {
      const chat = asObject(entry);
      const id = num(chat?.id);
      if (chat == null || id == null) continue;
      const type = asObject(chat.type);
      if (typeOf(type) !== 'chatTypePrivate') continue; // private DMs only
      const photo = asObject(chat.photo);
      const small = asObject(photo?.small);
      const smallPhotoFileId = num(small?.id) ?? undefined;
      const lastMessage = parseMessage(asObject(chat.last_message)) ?? undefined;
      const item: TgChat = {
        chatId: String(id),
        title: str(chat.title) ?? 'Telegram chat',
        isPrivate: true,
        unreadCount: num(chat.unread_count) ?? 0,
      };
      if (lastMessage) item.lastMessage = lastMessage;
      if (smallPhotoFileId != null) item.smallPhotoFileId = smallPhotoFileId;
      chats.push(item);
    }
    return { ok: true, value: chats };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not load chats.' };
  }
}

/**
 * Recent history for one chat, oldest first. TDLib returns partial batches
 * (often a single message on the first call), so we page until `limit`.
 */
export async function tdHistory(chatId: string, limit = 40): Promise<TdOutcome<TgMessage[]>> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  const chat = Number(chatId);
  if (!Number.isFinite(chat)) return { ok: false, error: 'Bad chat id.' };
  try {
    const byId = new Map<string, TgMessage>();
    let fromMessageId = 0;
    for (let page = 0; page < 8 && byId.size < limit; page += 1) {
      const items = await td.getChatHistory(chat, fromMessageId, limit - byId.size, 0);
      if (!Array.isArray(items) || items.length === 0) break;
      let oldestId: number | null = null;
      for (const item of items) {
        const rawMsg = safeParse(item?.raw_json);
        const messageId = num(rawMsg?.id);
        if (messageId != null && (oldestId == null || messageId < oldestId)) {
          oldestId = messageId;
        }
        const message = parseMessage(rawMsg);
        if (message) byId.set(message.id, message);
      }
      if (oldestId == null || oldestId === fromMessageId) break;
      fromMessageId = oldestId;
    }
    const messages = [...byId.values()].sort(
      (a, b) => a.sentAt - b.sentAt || a.id.localeCompare(b.id)
    );
    return { ok: true, value: messages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not load history.' };
  }
}

/** Send a text message; returns the (locally pending) parsed message. */
export async function tdSendText(chatId: string, text: string): Promise<TdOutcome<TgMessage>> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  const chat = Number(chatId);
  if (!Number.isFinite(chat)) return { ok: false, error: 'Bad chat id.' };
  try {
    const result = await td.sendMessage(chat, text);
    const message = parseMessage(safeParse(result?.raw));
    if (message) return { ok: true, value: message };
    // Result parse failed but the send went through — synthesize optimistically.
    return {
      ok: true,
      value: {
        id: `${chatId}:local-${Date.now()}`,
        counterparty: `tgc:${chatId}`,
        direction: 'out',
        body: text,
        sentAt: Date.now(),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Send failed.' };
  }
}

/**
 * Send a local photo via the raw client (inputMessagePhoto). Returns an
 * optimistic TgMessage — the confirmed message arrives via updateNewMessage.
 */
export async function tdSendPhoto(
  chatId: string,
  localPath: string
): Promise<TdOutcome<TgMessage>> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  const chat = Number(chatId);
  if (!Number.isFinite(chat)) return { ok: false, error: 'Bad chat id.' };
  const path = localPath.startsWith('file://') ? localPath.slice(7) : localPath;
  try {
    await td.td_json_client_send({
      '@type': 'sendMessage',
      chat_id: chat,
      input_message_content: {
        '@type': 'inputMessagePhoto',
        photo: { '@type': 'inputFileLocal', path },
      },
    });
    return {
      ok: true,
      value: {
        id: `${chatId}:local-${Date.now()}`,
        counterparty: `tgc:${chatId}`,
        direction: 'out',
        body: '',
        sentAt: Date.now(),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Photo send failed.' };
  }
}

/** Mark messages as read (viewMessages with force). */
export async function tdMarkRead(chatId: string, messageIds: number[]): Promise<TdOutcome> {
  const td = tdModule();
  if (!td) return UNAVAILABLE;
  const chat = Number(chatId);
  if (!Number.isFinite(chat) || messageIds.length === 0) return { ok: true, value: undefined };
  try {
    await td.viewMessages(chat, messageIds, true);
    return { ok: true, value: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Mark read failed.' };
  }
}

/** Local path from a TDLib file object, when the download has completed. */
function completedLocalPath(file: RawObject | null): string | null {
  const local = asObject(file?.local);
  if (local?.is_downloading_completed !== true) return null;
  return str(local.path);
}

/**
 * Download a photo file and resolve its local path. Waits on both updateFile
 * events and getFile polling; gives up (null) after ~15s.
 */
export async function tdResolvePhoto(fileId: number): Promise<string | null> {
  const td = tdModule();
  if (!td) return null;
  try {
    const initial = completedLocalPath(safeParse((await td.downloadFile(fileId))?.raw));
    if (initial) return initial;
  } catch {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (path: string | null) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearInterval(poll);
      clearTimeout(cap);
      resolve(path);
    };
    const unsubscribe = onTdUpdate((u) => {
      if (u.kind === 'file' && u.fileId === fileId && u.completed) finish(u.localPath);
    });
    const poll = setInterval(async () => {
      try {
        const path = completedLocalPath(safeParse((await td.getFile(fileId))?.raw));
        if (path) finish(path);
      } catch {
        // keep waiting until the cap
      }
    }, 750);
    const cap = setTimeout(() => finish(null), 15000);
  });
}
