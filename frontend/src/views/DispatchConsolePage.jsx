/**
 * Standalone Dispatch Console workspace.
 *
 * Top-level route `/dispatch` — the single place where dispatch actions
 * (assign, reassign-driver, reassign-vehicle, cancel) happen. Available
 * to manufacturer, distributor, wholesaler, warehouse and super_admin.
 * Driver and retailer roles are denied with a friendly redirect.
 *
 * Per IA: Fleet workspace is master-data only; Logistics Command Center is
 * monitoring only; Dispatch Console is the single home for execution.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import { useSession } from "@/context/SessionContext";
import DispatchConsole from "@/views/fleet/DispatchConsole";

const ALLOWED_ROLES = new Set([
  "manufacturer", "distributor", "wholesaler", "warehouse", "super_admin",
]);

export default function DispatchConsolePage() {
  const { session } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session && !ALLOWED_ROLES.has(session.role)) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, navigate]);

  if (!session || !ALLOWED_ROLES.has(session.role)) return null;

  return (
    <div className="p-4 md:p-8 space-y-5" data-testid="dispatch-console-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-indigo-700 font-semibold mb-1">
            <ClipboardList className="h-3 w-3" /> Planning · Execution
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dispatch Console</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Assign, reassign and cancel shipments. The only workspace where dispatch
            mutations happen — Fleet stays master-data only and Logistics Command
            Center stays monitoring only.
          </p>
        </div>
      </div>
      <DispatchConsole />
    </div>
  );
}
