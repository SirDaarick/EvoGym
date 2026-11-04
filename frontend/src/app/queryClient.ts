import { QueryClient } from '@tanstack/react-query';
import { HttpError } from '../api/http';

const MAX_RETRIES = 2;

function statusOf(error: unknown): number | undefined {
  if (error instanceof HttpError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Retry network errors and 5xx up to twice; never retry 4xx (they will not change). */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetryQuery },
      mutations: { retry: false },
    },
  });
}

/** App-wide singleton. ProductAccessProvider clears it whenever the principal changes. */
export const queryClient = createQueryClient();
