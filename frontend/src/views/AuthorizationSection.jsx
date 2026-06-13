// Standalone Authorization wrapper used inside the Procurement → Shipments
// tab. Authorizations were previously embedded in Planning & Ops; moving
// them here keeps the "outbound" lifecycle (authorize → ship) in one place.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Api } from "../lib/api";
import { Button } from "../components/ui/button";
import { AuthorizationPanel } from "./logistics/LogisticsActionPanels";

export default function AuthorizationSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  const reload = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Api.logisticsOverview()
      .then((d) => setData(d?.authorization || {}))
      .catch((e) => {
        toast.error("Failed to load authorizations", {
          description: e?.response?.data?.detail || e?.message,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(true); }, [reload]);

  const counts = data
    ? (data.warehouse?.length || 0) + (data.distributor?.length || 0) + (data.wholesaler?.length || 0)
    : 0;

  return (
    <div className="px-4 md:px-8 pt-4" data-testid="shipments-authorization-section">
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left"
          data-testid="auth-section-toggle"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 grid place-items-center shrink-0">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                Shipment Authorization Center
                {counts > 0 && (
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                    {counts} pending
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500 truncate">
                Approve warehouse, distributor and wholesaler requests before they ship.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {open && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 border-slate-200 text-xs"
                onClick={(e) => { e.stopPropagation(); reload(); }}
                data-testid="auth-section-refresh"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
              </Button>
            )}
            {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
          </div>
        </button>
        {open && (
          <div className="border-t border-slate-100 p-3 md:p-4">
            {loading && !data ? (
              <div className="text-center py-8 text-slate-400 text-sm">Loading authorizations…</div>
            ) : (
              <AuthorizationPanel authorization={data || {}} onChanged={() => reload(true)} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
