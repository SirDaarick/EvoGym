export const OFFLINE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export type OfflineClockInput = {
  deviceCapturedAtMs: number;
  localMonotonicAtCaptureMs: number;
  serverUtcAtAnchorMs?: number;
  localMonotonicAtAnchorMs?: number;
};

export type OfflineClockClassification = {
  deviceCapturedAtMs: number;
  estimatedServerAtCaptureMs: number | null;
  skewMs: number | null;
  reviewRequired: boolean;
  reason: 'within_tolerance' | 'clock_skew' | 'unverified_clock';
};

/**
 * Compares the raw device capture time with a server-time estimate based on one
 * trusted UTC/monotonic anchor. The helper never changes the captured time.
 */
export function classifyOfflineCaptureTime(input: OfflineClockInput): OfflineClockClassification {
  const {
    deviceCapturedAtMs,
    serverUtcAtAnchorMs,
    localMonotonicAtAnchorMs,
    localMonotonicAtCaptureMs,
  } = input;

  if (typeof serverUtcAtAnchorMs !== 'number'
    || !Number.isFinite(serverUtcAtAnchorMs)
    || typeof localMonotonicAtAnchorMs !== 'number'
    || !Number.isFinite(localMonotonicAtAnchorMs)
    || !Number.isFinite(deviceCapturedAtMs)
    || !Number.isFinite(localMonotonicAtCaptureMs)) {
    return {
      deviceCapturedAtMs,
      estimatedServerAtCaptureMs: null,
      skewMs: null,
      reviewRequired: true,
      reason: 'unverified_clock',
    };
  }

  const elapsedMs = localMonotonicAtCaptureMs - localMonotonicAtAnchorMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return {
      deviceCapturedAtMs,
      estimatedServerAtCaptureMs: null,
      skewMs: null,
      reviewRequired: true,
      reason: 'unverified_clock',
    };
  }

  const estimatedServerAtCaptureMs = serverUtcAtAnchorMs + elapsedMs;
  const skewMs = deviceCapturedAtMs - estimatedServerAtCaptureMs;
  const reviewRequired = Math.abs(skewMs) > OFFLINE_CLOCK_SKEW_TOLERANCE_MS;

  return {
    deviceCapturedAtMs,
    estimatedServerAtCaptureMs,
    skewMs,
    reviewRequired,
    reason: reviewRequired ? 'clock_skew' : 'within_tolerance',
  };
}
