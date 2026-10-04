// Upstream valid case: `QueryClient` from another library is not TanStack's.
import { QueryClient } from 'other-library'

export function App() {
  const queryClient = new QueryClient()
  return queryClient
}
