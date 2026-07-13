import type { VisitorId } from '@live-support/types';

import type { VisitorInfo } from '../types';

export const VISITOR_INFO_HEADER = 'X-Live-Support-Visitor-Info';

interface CloudflareRequest extends Request {
  readonly cf?: Record<string, unknown>;
}

/** Collects privacy-preserving request metadata without calling a GeoIP provider. */
export function collectVisitorInfo(request: Request, visitorId: VisitorId): VisitorInfo {
  const cloudflare = (request as CloudflareRequest).cf ?? {};
  const userAgent = limit(request.headers.get('user-agent') ?? undefined, 512);

  return {
    visitorId,
    website: getWebsite(request),
    country: readString(cloudflare.country),
    region: readString(cloudflare.region),
    city: readString(cloudflare.city),
    timezone: readString(cloudflare.timezone),
    language: getLanguage(request),
    asn: readNumber(cloudflare.asn),
    isp: readString(cloudflare.asOrganization),
    userAgent,
    browser: detectBrowser(userAgent),
    operatingSystem: detectOperatingSystem(userAgent),
    deviceType: detectDeviceType(userAgent),
    connectionTime: Date.now(),
  };
}

export function createDefaultVisitorInfo(
  visitorId: VisitorId,
  connectionTime = Date.now(),
): VisitorInfo {
  return { visitorId, connectionTime };
}

export function encodeVisitorInfo(info: VisitorInfo): string {
  return encodeURIComponent(JSON.stringify(info));
}

/** Decodes metadata passed from the edge Worker to the Durable Object. */
export function decodeVisitorInfo(value: string | null, visitorId: VisitorId): VisitorInfo {
  const fallback = createDefaultVisitorInfo(visitorId);

  if (value === null) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fallback;
    }

    const record = parsed as Record<string, unknown>;
    const connectionTime = readNumber(record.connectionTime);

    return {
      ...fallback,
      nickname: readString(record.nickname),
      website: readString(record.website),
      country: readString(record.country),
      region: readString(record.region),
      city: readString(record.city),
      timezone: readString(record.timezone),
      language: readString(record.language),
      asn: readNumber(record.asn),
      isp: readString(record.isp),
      userAgent: readString(record.userAgent),
      browser: readString(record.browser),
      operatingSystem: readString(record.operatingSystem),
      deviceType: readDeviceType(record.deviceType),
      connectionTime: connectionTime ?? fallback.connectionTime,
    };
  } catch {
    return fallback;
  }
}

function getWebsite(request: Request): string | undefined {
  const source = request.headers.get('origin') ?? request.headers.get('referer');

  if (source !== null) {
    try {
      return new URL(source).hostname;
    } catch {
      return undefined;
    }
  }

  return limit(request.headers.get('host') ?? undefined, 255);
}

function getLanguage(request: Request): string | undefined {
  const language = request.headers.get('accept-language')?.split(',', 1)[0]?.trim();
  return limit(language, 64);
}

function detectBrowser(userAgent: string | undefined): string | undefined {
  if (userAgent === undefined) {
    return undefined;
  }

  return /Edg\//u.test(userAgent)
    ? 'Edge'
    : /OPR\//u.test(userAgent)
      ? 'Opera'
      : /SamsungBrowser\//u.test(userAgent)
        ? 'Samsung Internet'
        : /Chrome\//u.test(userAgent)
          ? 'Chrome'
          : /Firefox\//u.test(userAgent)
            ? 'Firefox'
            : /Safari\//u.test(userAgent)
              ? 'Safari'
              : undefined;
}

function detectOperatingSystem(userAgent: string | undefined): string | undefined {
  if (userAgent === undefined) {
    return undefined;
  }

  return /Windows/u.test(userAgent)
    ? 'Windows'
    : /Android/u.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iPod/u.test(userAgent)
        ? 'iOS'
        : /Mac OS X/u.test(userAgent)
          ? 'macOS'
          : /Linux/u.test(userAgent)
            ? 'Linux'
            : undefined;
}

function detectDeviceType(userAgent: string | undefined): VisitorInfo['deviceType'] {
  if (userAgent === undefined) {
    return undefined;
  }

  return /iPad|Tablet|Android(?!.*Mobile)/u.test(userAgent)
    ? 'Tablet'
    : /Mobi|Android|iPhone|iPod/u.test(userAgent)
      ? 'Mobile'
      : 'Desktop';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readDeviceType(value: unknown): VisitorInfo['deviceType'] {
  return value === 'Desktop' || value === 'Tablet' || value === 'Mobile' ? value : undefined;
}

function limit(value: string | undefined, maxLength: number): string | undefined {
  return value === undefined ? undefined : value.slice(0, maxLength);
}
