import type { VisitorId } from '@live-support/types';

/** Request metadata captured from Cloudflare and the connecting browser. */
export interface VisitorInfo {
  readonly visitorId: VisitorId;
  readonly website?: string | undefined;
  readonly country?: string | undefined;
  readonly region?: string | undefined;
  readonly city?: string | undefined;
  readonly timezone?: string | undefined;
  readonly language?: string | undefined;
  readonly asn?: number | undefined;
  readonly isp?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly browser?: string | undefined;
  readonly operatingSystem?: string | undefined;
  readonly deviceType?: 'Desktop' | 'Tablet' | 'Mobile' | undefined;
  readonly connectionTime: number;
}
