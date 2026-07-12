import type { VisitorId } from '@live-support/types';

export const SESSION_TOKEN_HEADER = 'X-Live-Support-Session-Token';
export const VISITOR_ID_HEADER = 'X-Live-Support-Visitor-Id';

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DEVELOPMENT_SECRET = 'live-support-development-session-secret';

interface SessionTokenPayload {
  visitorId: VisitorId;
  expiresAt: number;
}

export interface SessionIdentity {
  visitorId: VisitorId;
  token: string;
}

function getSecret(secret: string | undefined): string {
  return secret === undefined || secret.length === 0 ? DEVELOPMENT_SECRET : secret;
}

function encode(value: string): string {
  return encodeBytes(new TextEncoder().encode(value));
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(value: string): string | undefined {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function decodeBytes(value: string): Uint8Array | undefined {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function createSessionIdentity(secret?: string): Promise<SessionIdentity> {
  const visitorId = `visitor_${crypto.randomUUID()}` as VisitorId;
  const payload: SessionTokenPayload = {
    visitorId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importKey(getSecret(secret)),
    new TextEncoder().encode(encodedPayload),
  );
  return {
    visitorId,
    token: `${TOKEN_VERSION}.${encodedPayload}.${encodeBytes(new Uint8Array(signature))}`,
  };
}

export async function verifySessionToken(
  token: string | null,
  secret?: string,
): Promise<VisitorId | undefined> {
  if (token === null) {
    return undefined;
  }

  const [version, encodedPayload, encodedSignature] = token.split('.');

  if (version !== TOKEN_VERSION || encodedPayload === undefined || encodedSignature === undefined) {
    return undefined;
  }

  const payloadText = decode(encodedPayload);
  const signatureBytes = decodeBytes(encodedSignature);

  if (payloadText === undefined || signatureBytes === undefined) {
    return undefined;
  }

  let payload: SessionTokenPayload;

  try {
    payload = JSON.parse(payloadText) as SessionTokenPayload;
  } catch {
    return undefined;
  }

  if (
    typeof payload.visitorId !== 'string' ||
    !payload.visitorId.startsWith('visitor_') ||
    typeof payload.expiresAt !== 'number' ||
    payload.expiresAt <= Date.now()
  ) {
    return undefined;
  }

  const valid = await crypto.subtle.verify(
    'HMAC',
    await importKey(getSecret(secret)),
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(encodedPayload),
  );

  return valid ? (payload.visitorId as VisitorId) : undefined;
}
