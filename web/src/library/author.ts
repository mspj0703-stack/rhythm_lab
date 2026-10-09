/**
 * Persistent anonymous author identity (no account system in v5).
 * - authorId: public UUID shown next to shared charts.
 * - authorSecret: never displayed; proves ownership for update/delete. A future account system can
 *   claim existing charts by presenting the pair once.
 */
export const AUTHOR_ID_KEY = "beatdash.authorId";
export const AUTHOR_SECRET_KEY = "beatdash.authorSecret";

export interface AuthorIdentity {
  authorId: string;
  authorSecret: string;
  /** false when storage is blocked: the identity only lives for this page session. */
  persistent: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let sessionIdentity: AuthorIdentity | null = null;

function newUuid(): string {
  const cryptoApi = typeof crypto !== "undefined" ? crypto as Partial<Crypto> : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getAuthorIdentity(storage: Storage | null = typeof window !== "undefined" ? window.localStorage : null): AuthorIdentity {
  try {
    if (!storage) throw new Error("no storage");
    let authorId = storage.getItem(AUTHOR_ID_KEY) ?? "";
    let authorSecret = storage.getItem(AUTHOR_SECRET_KEY) ?? "";
    // Never replace an existing valid ID: charts on the server are tied to it.
    if (!UUID_PATTERN.test(authorId)) { authorId = newUuid(); storage.setItem(AUTHOR_ID_KEY, authorId); }
    if (!UUID_PATTERN.test(authorSecret)) { authorSecret = newUuid(); storage.setItem(AUTHOR_SECRET_KEY, authorSecret); }
    return { authorId, authorSecret, persistent: true };
  } catch {
    sessionIdentity ??= { authorId: newUuid(), authorSecret: newUuid(), persistent: false };
    return sessionIdentity;
  }
}

export function shortAuthor(authorId: string | undefined): string {
  return authorId ? `#${authorId.replace(/-/g, "").slice(0, 6).toUpperCase()}` : "#익명";
}
