import { createContext, useContext, useEffect, useState, useCallback } from "react";

const SessionContext = createContext(null);

const STORAGE_KEY = "sch.session.v1";

export function SessionProvider({ children }) {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  }, [session]);

  const signIn = useCallback((role, entity) => {
    setSession({ role, entity });
  }, []);

  const signOut = useCallback(() => setSession(null), []);

  return (
    <SessionContext.Provider value={{ session, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
