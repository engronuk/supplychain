import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { setAccessToken, AuthApi } from "@/lib/api";

const SessionContext = createContext(null);

const TOKEN_KEY = "tk.access_token";
const ORIGINAL_KEY = "tk.original_token";  // super-admin token stashed during impersonation

function readLocal(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}
function writeLocal(key, val) {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {}
}

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenantId, setTenantId] = useState("");
  const [entity, setEntity] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [impersonator, setImpersonator] = useState(null);

  const refreshMe = useCallback(async () => {
    try {
      const me = await AuthApi.me();
      setUser(me);
      setTenantId(me.tenant_id || "");
      // Hydrate entity (manufacturer/distributor/retailer record) for layout
      if (me.role && me.entity_id) {
        try {
          const ent = await AuthApi.fetchEntity(me.role, me.entity_id);
          setEntity(ent);
        } catch {
          setEntity({ id: me.entity_id, name: me.name || "" });
        }
      } else if (me.role === "super_admin") {
        setEntity({ id: "system", name: "Super Admin Console" });
      } else {
        setEntity(null);
      }
      return me;
    } catch (e) {
      setUser(null);
      setEntity(null);
      setTenantId("");
      return null;
    }
  }, []);

  // Bootstrap on mount from stored token
  useEffect(() => {
    const stored = readLocal(TOKEN_KEY);
    const original = readLocal(ORIGINAL_KEY);
    if (original) setImpersonator({ active: true });
    if (stored) {
      setAccessToken(stored);
      refreshMe().finally(() => setBootstrapping(false));
    } else {
      setBootstrapping(false);
    }
  }, [refreshMe]);

  const signIn = useCallback(async ({ email, password }) => {
    const data = await AuthApi.login({ email, password });
    writeLocal(TOKEN_KEY, data.access_token);
    setAccessToken(data.access_token);
    await refreshMe();
    return data.user;
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    try { await AuthApi.logout(); } catch {}
    writeLocal(TOKEN_KEY, null);
    writeLocal(ORIGINAL_KEY, null);
    setAccessToken(null);
    setUser(null);
    setEntity(null);
    setTenantId("");
    setImpersonator(null);
  }, []);

  const impersonate = useCallback(async (userId) => {
    // Stash super-admin token before swapping in the impersonated user's
    const current = readLocal(TOKEN_KEY);
    if (current) writeLocal(ORIGINAL_KEY, current);
    const data = await AuthApi.impersonate(userId);
    writeLocal(TOKEN_KEY, data.access_token);
    setAccessToken(data.access_token);
    setImpersonator({ active: true, by: data.impersonated_by });
    await refreshMe();
    return data.user;
  }, [refreshMe]);

  const stopImpersonating = useCallback(async () => {
    const original = readLocal(ORIGINAL_KEY);
    if (!original) return;
    writeLocal(TOKEN_KEY, original);
    writeLocal(ORIGINAL_KEY, null);
    setAccessToken(original);
    setImpersonator(null);
    await refreshMe();
  }, [refreshMe]);

  // Back-compat shim: legacy code reads `session.role` and `session.entity`.
  const session = useMemo(() => {
    if (!user) return null;
    return {
      role: user.role,
      entity: entity || { id: user.entity_id, name: user.name || "" },
      user,
      tenant_id: tenantId,
    };
  }, [user, entity, tenantId]);

  return (
    <SessionContext.Provider
      value={{
        session,
        user,
        entity,
        tenantId,
        bootstrapping,
        impersonator,
        signIn,
        signOut,
        impersonate,
        stopImpersonating,
        refreshMe,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
