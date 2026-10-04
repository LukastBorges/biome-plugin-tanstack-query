// Upstream valid case: Solid components run once, so creating the client in
// the component body is fine. The rule only applies to @tanstack/react-query.
import { QueryClient } from '@tanstack/solid-query'

export function App() {
  const queryClient = new QueryClient()
  return queryClient
}
