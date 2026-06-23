/**
 * TenantContext — multi-tenant scope manager.
 *
 * A single distributor (or wholesaler) can serve multiple manufacturers.
 * Each `(business, manufacturer)` pair lives as its own `distributors`
 * row in the backend; rows that share a real-world business identity
 * carry the same `business_group_id`. After login, this context calls
 * `GET /api/me/tenants`, finds every row in the caller's
 * business_group_id, lets the user pick one, and propagates the
 * choice on every request via the `X-Active-Tenant-Id` header (see
 * `lib/api.js` interceptor).
 *
 * The context is intentionally read-only outside `<TenantProvider>` —
 * mutations always go through `setActiveTenant(entity_id)` which
 * round-trips through `POST /api/me/active-tenant` for server-side
 * validation before flipping local state.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { setActiveTenantId, getActiveTenantId, getAccessToken } from "@/lib/api";
import { useSession } from "./SessionContext";

const TenantContext = createContext(null);

export function TenantProvider({ children }) {
  const { user, bootstrapping, setActiveTenantOverride } = useSession();
  const [tenants, setTenants] = useState([]);
  const [active, setActive] = useState(null);
  const [multiTenant, setMultiTenant] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picker, setPicker] = useState(false);  // selector modal visibility

  // --- Fetch memberships whenever the session changes ------------------
  const refresh = useCallback(async () => {
    if (bootstrapping) return;
    if (!user || !getAccessToken()) {
      setTenants([]); setActive(null); setMultiTenant(false);
      setActiveTenantId(null);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get("/me/tenants");
      setTenants(data.tenants || []);
      setMultiTenant(Boolean(data.multi_tenant));

      // Prefer the previously-picked tenant if it's still valid; otherwise
      // fall back to the server-side default.
      const stored = getActiveTenantId();
      const fromStored = (data.tenants || []).find((t) => t.entity_id === stored);
      const fallback = (data.tenants || []).find((t) => t.is_default)
                       || (data.tenants || [])[0] || null;
      const chosen = fromStored || fallback;
      setActive(chosen);
      // Only set the header if the user is actually multi-tenant — sending
      // it for single-tenant users is harmless but noisy.
      const headerValue = Boolean(data.multi_tenant) ? chosen?.entity_id : null;
      setActiveTenantId(headerValue);
      // Push the chosen entity_id into SessionContext so every consumer
      // of `session.entity.id` (dashboards, retailer detail, fleet pages,
      // shipment workspaces, …) refetches against the new tenant on the
      // next render.
      if (setActiveTenantOverride) setActiveTenantOverride(headerValue);

      // Show the picker on the very first multi-tenant login until a
      // choice is persisted.
      if (Boolean(data.multi_tenant) && !stored) {
        setPicker(true);
      }
    } catch {
      setTenants([]); setActive(null); setMultiTenant(false);
      setActiveTenantId(null);
    } finally {
      setLoading(false);
    }
  }, [user, bootstrapping, setActiveTenantOverride]);

  useEffect(() => { refresh(); }, [refresh]);

  // --- Switch tenants (validated round-trip) ---------------------------
  const switchTo = useCallback(async (entityId) => {
    if (!entityId) return;
    const target = tenants.find((t) => t.entity_id === entityId);
    if (!target) return;
    // Optimistic — flip immediately, then validate. Roll back on failure.
    const prev = active;
    setActive(target);
    setActiveTenantId(target.entity_id);
    if (setActiveTenantOverride) setActiveTenantOverride(target.entity_id);
    try {
      await api.post("/me/active-tenant", { entity_id: entityId });
      setPicker(false);
    } catch {
      setActive(prev);
      setActiveTenantId(prev?.entity_id || null);
      if (setActiveTenantOverride) setActiveTenantOverride(prev?.entity_id || null);
    }
  }, [tenants, active, setActiveTenantOverride]);

  const value = useMemo(() => ({
    tenants, active, multiTenant, loading,
    pickerOpen: picker, openPicker: () => setPicker(true),
    closePicker: () => setPicker(false),
    switchTo, refresh,
  }), [tenants, active, multiTenant, loading, picker, switchTo, refresh]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used inside <TenantProvider>");
  return ctx;
}
