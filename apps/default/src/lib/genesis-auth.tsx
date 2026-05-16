import type * as React from 'react';
import { AuthProvider } from 'react-oidc-context';

/**
 * Pre-built Genesis OIDC auth wrapper.
 *
 * Fetches the discovery document at `/_genesis/auth/.well-known/openid-configuration`
 * and infers all other config (endpoints, supported scopes, etc.) automatically.
 *
 * Trade-off: small initial load for the discovery fetch, acceptable for
 * the reliability gain of not hardcoding any OIDC config.
 *
 * Usage in App.tsx:
 * ```tsx
 * import { GenesisAuth } from '@/lib/genesis-auth';
 *
 * function App() {
 *   return (
 *     <GenesisAuth>
 *       <ProtectedApp />
 *     </GenesisAuth>
 *   );
 * }
 * ```
 *
 * Access user profile after login:
 * ```tsx
 * import { useAuth } from 'react-oidc-context';
 *
 * function Profile() {
 *   const auth = useAuth();
 *   const { email, name, preferred_username, sub } = auth.user?.profile ?? {};
 *   // ...
 * }
 * ```
 */
export function GenesisAuth({ children }: { children: React.ReactNode }) {
  const origin = window.location.origin;
  return (
    <AuthProvider
      authority={`${origin}/_genesis/auth`}
      client_id="default"
      redirect_uri={`${origin}/`}
      scope="openid profile email"
    >
      {children}
    </AuthProvider>
  );
}
