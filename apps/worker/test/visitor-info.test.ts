import { describe, expect, it } from 'vitest';

import type { VisitorId } from '@live-support/types';

import {
  collectVisitorInfo,
  decodeVisitorInfo,
  encodeVisitorInfo,
} from '../src/utils/visitor-info';

describe('visitor request metadata', () => {
  it('collects Cloudflare location and browser metadata without external services', () => {
    const request = new Request('https://worker.example/ws?visitorId=visitor-1', {
      headers: {
        origin: 'https://merchant.example',
        'accept-language': 'zh-TW,zh;q=0.9',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      },
    });
    Object.defineProperty(request, 'cf', {
      value: {
        country: 'TW',
        region: 'Taiwan',
        city: 'Taipei City',
        timezone: 'Asia/Taipei',
        asn: 1234,
        asOrganization: 'Example ISP',
      },
    });

    const info = collectVisitorInfo(request, 'visitor-1' as VisitorId);

    expect(info).toMatchObject({
      visitorId: 'visitor-1',
      website: 'merchant.example',
      country: 'TW',
      region: 'Taiwan',
      city: 'Taipei City',
      timezone: 'Asia/Taipei',
      language: 'zh-TW',
      asn: 1234,
      isp: 'Example ISP',
      browser: 'Chrome',
      operatingSystem: 'Windows',
      deviceType: 'Desktop',
    });
  });

  it('round-trips metadata and always trusts the connection visitor ID', () => {
    const request = new Request('https://worker.example/ws', {
      headers: { origin: 'https://merchant.example' },
    });
    const info = collectVisitorInfo(request, 'visitor-original' as VisitorId);

    const decoded = decodeVisitorInfo(
      encodeVisitorInfo({ ...info, visitorId: 'spoofed' as VisitorId }),
      'visitor-original' as VisitorId,
    );

    expect(decoded.visitorId).toBe('visitor-original');
    expect(decoded.website).toBe('merchant.example');
  });
});
