import { describe, expect, it } from 'vitest';
import { classifyOfflineCaptureTime } from './offlineClock';

const anchor = {
  serverUtcAtAnchorMs: 1_800_000_000_000,
  localMonotonicAtAnchorMs: 10_000,
  sameMonotonicOrigin: true,
};

describe('classifyOfflineCaptureTime', () => {
  it('accepts skew at or below five minutes', () => {
    const result = classifyOfflineCaptureTime({
      ...anchor,
      localMonotonicAtCaptureMs: 70_000,
      deviceCapturedAtMs: anchor.serverUtcAtAnchorMs + 60_000 + 300_000,
    });

    expect(result).toEqual({
      deviceCapturedAtMs: anchor.serverUtcAtAnchorMs + 360_000,
      estimatedServerAtCaptureMs: anchor.serverUtcAtAnchorMs + 60_000,
      skewMs: 300_000,
      reviewRequired: false,
      reason: 'within_tolerance',
    });
  });

  it.each([330_001, -330_001])('flags skew beyond five minutes (%s ms)', (skewMs) => {
    const result = classifyOfflineCaptureTime({
      ...anchor,
      localMonotonicAtCaptureMs: 70_000,
      deviceCapturedAtMs: anchor.serverUtcAtAnchorMs + 60_000 + skewMs,
    });

    expect(result.skewMs).toBe(skewMs);
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toBe('clock_skew');
  });

  it('preserves capture time and requests review when the anchor is unavailable', () => {
    const result = classifyOfflineCaptureTime({
      sameMonotonicOrigin: true,
      deviceCapturedAtMs: 1_800_000_123_000,
      localMonotonicAtCaptureMs: 70_000,
    });

    expect(result.deviceCapturedAtMs).toBe(1_800_000_123_000);
    expect(result.estimatedServerAtCaptureMs).toBeNull();
    expect(result.skewMs).toBeNull();
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toBe('unverified_clock');
  });

  it('requires review when anchor and capture do not share a monotonic origin', () => {
    const result = classifyOfflineCaptureTime({
      ...anchor,
      sameMonotonicOrigin: false,
      localMonotonicAtCaptureMs: 70_000,
      deviceCapturedAtMs: anchor.serverUtcAtAnchorMs + 60_000,
    });

    expect(result.deviceCapturedAtMs).toBe(anchor.serverUtcAtAnchorMs + 60_000);
    expect(result.estimatedServerAtCaptureMs).toBeNull();
    expect(result.skewMs).toBeNull();
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toBe('unverified_clock');
  });

  it.each([9_999, Number.NaN])('flags invalid monotonic elapsed time (%s)', (captureMonotonicMs) => {
    const result = classifyOfflineCaptureTime({
      ...anchor,
      localMonotonicAtCaptureMs: captureMonotonicMs,
      deviceCapturedAtMs: anchor.serverUtcAtAnchorMs,
    });

    expect(result.deviceCapturedAtMs).toBe(anchor.serverUtcAtAnchorMs);
    expect(result.estimatedServerAtCaptureMs).toBeNull();
    expect(result.reviewRequired).toBe(true);
    expect(result.reason).toBe('unverified_clock');
  });

  it('uses the supplied fixed anchor for duplicate retries', () => {
    const capture = {
      ...anchor,
      localMonotonicAtCaptureMs: 70_000,
      deviceCapturedAtMs: anchor.serverUtcAtAnchorMs + 60_000,
    };

    expect(classifyOfflineCaptureTime(capture).estimatedServerAtCaptureMs)
      .toBe(anchor.serverUtcAtAnchorMs + 60_000);
    expect(classifyOfflineCaptureTime(capture).estimatedServerAtCaptureMs)
      .toBe(anchor.serverUtcAtAnchorMs + 60_000);
  });
});
