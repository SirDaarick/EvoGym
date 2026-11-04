import { useState, type ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function QueryWrapper({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [fallback] = useState(() => client ?? createTestQueryClient());
  return <QueryClientProvider client={fallback}>{children}</QueryClientProvider>;
}

export function withQuery(ui: ReactElement, client: QueryClient = createTestQueryClient()): ReactElement {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

export function renderWithQuery(
  ui: ReactElement,
  options: Omit<RenderOptions, 'wrapper'> & { queryClient?: QueryClient } = {},
): RenderResult & { queryClient: QueryClient } {
  const { queryClient = createTestQueryClient(), ...rest } = options;
  const result = render(withQuery(ui, queryClient), rest);
  return Object.assign(result, { queryClient });
}
