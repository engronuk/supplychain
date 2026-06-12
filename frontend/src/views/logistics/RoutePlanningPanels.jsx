// Route Planning panels — pending shipment dispatch board + active routes.
import { ClipboardList, ListOrdered, PackagePlus } from "lucide-react";
import { unitsCompact } from "./ControlTowerPanels";

const ageLabel = (h) => {
  if (h == null) return "";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export const PendingShipmentsPanel = ({
  pending, warehouses, selectedIds, lockedOrigin, onToggle, onAddAdhoc,
}) => {
  const whName = Object.fromEntries((warehouses || []).map((w) => [w.id, w.name]));
  const groups = {};
  (pending || []).forEach((p) => { (groups[p.from_id] = groups[p.from_id] || []).push(p); });

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col min-w-0 xl:h-[692px]" data-testid="pending-shipments-panel">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold text-slate-100">Awaiting Dispatch</span>
        <span className="text-[10px] text-slate-500">{(pending || []).length} shipments</span>
        <button
          type="button" onClick={onAddAdhoc}
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors"
          data-testid="adhoc-stop-btn"
        >
          <PackagePlus className="h-3 w-3" /> Ad-hoc delivery
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {Object.keys(groups).length === 0 ? (
          <div className="text-[12px] text-slate-500 text-center pt-10">
            No shipments waiting for dispatch right now.
          </div>
        ) : Object.entries(groups).map(([wid, list]) => {
          const lockedOut = lockedOrigin && wid !== lockedOrigin;
          return (
            <div key={wid}>
              <div className="px-1.5 py-1 text-[10px] uppercase tracking-wide text-slate-500 font-semibold flex items-center justify-between">
                <span className="truncate">{whName[wid] || "Warehouse"}</span>
                <span>{list.length}</span>
              </div>
              <div className="space-y-1.5">
                {list.map((p) => {
                  const sel = selectedIds.has(p.id);
                  return (
                    <button
                      key={p.id} type="button" onClick={() => onToggle(p)}
                      data-testid="pending-shipment-row"
                      className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${
                        sel
                          ? "bg-emerald-500/10 border-emerald-500/40"
                          : lockedOut
                            ? "bg-slate-900/40 border-slate-800/60 opacity-40"
                            : "bg-slate-900/80 border-slate-800 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-3.5 w-3.5 rounded border grid place-items-center shrink-0 ${
                          sel ? "bg-emerald-500 border-emerald-400" : "border-slate-600"}`}>
                          {sel && <svg viewBox="0 0 10 8" className="h-2 w-2 fill-none stroke-[#06291d]" strokeWidth="2"><path d="M1 4l2.5 2.5L9 1" /></svg>}
                        </span>
                        <span className="text-[11px] font-mono text-slate-300">{p.tracking_code}</span>
                        <span className={`text-[9px] font-semibold uppercase px-1 py-0.5 rounded border ${
                          p.status === "picking"
                            ? "bg-sky-500/10 border-sky-500/30 text-sky-300"
                            : "bg-amber-500/10 border-amber-500/30 text-amber-300"}`}>
                          {(p.status || "").replace(/_/g, " ")}
                        </span>
                        <span className="ml-auto text-[10px] text-slate-500">{ageLabel(p.age_hours)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 pl-5.5">
                        <span className="text-[11px] text-slate-300 truncate">
                          → {p.to_name}{p.to_city ? <span className="text-slate-500"> · {p.to_city}</span> : null}
                        </span>
                        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{unitsCompact(p.units)}u</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
const ROUTE_BADGE = {
  dispatched: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  in_progress: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  completed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export const ActiveRoutesTable = ({ routes, onOpenTimeline }) => (
  <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden" data-testid="active-routes-table">
    <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2">
      <ListOrdered className="h-4 w-4 text-slate-400" />
      <span className="text-sm font-semibold text-slate-100">Planned Routes</span>
      <span className="text-[10px] text-slate-500">{(routes || []).length} routes · execution tracked live</span>
    </div>
    <div className="max-h-[340px] overflow-y-auto">
      <table className="w-full text-left">
        <thead className="sticky top-0 bg-[#0B1424] z-10">
          <tr className="text-[10px] uppercase tracking-wider text-slate-500">
            <th className="px-3.5 py-2 font-semibold">Route</th>
            <th className="px-2 py-2 font-semibold">Vehicle · Driver</th>
            <th className="px-2 py-2 font-semibold">Origin</th>
            <th className="px-2 py-2 font-semibold">Stops</th>
            <th className="px-2 py-2 font-semibold text-right">Units</th>
            <th className="px-2 py-2 font-semibold text-right">Distance</th>
            <th className="px-2 py-2 font-semibold">Status</th>
            <th className="px-2 py-2 font-semibold w-28">Progress</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {(routes || []).length === 0 ? (
            <tr><td colSpan={9} className="px-3.5 py-8 text-center text-[12px] text-slate-500">
              No routes planned yet — build your first multi-stop run above.
            </td></tr>
          ) : routes.map((r) => (
            <tr key={r.id} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition-colors" data-testid="route-row">
              <td className="px-3.5 py-2">
                <div className="text-[11px] font-mono text-emerald-300">{r.code}</div>
                {r.optimized && <div className="text-[9px] text-slate-500">optimized</div>}
              </td>
              <td className="px-2 py-2">
                <div className="text-[11px] font-mono text-slate-300">{r.vehicle_code}</div>
                <div className="text-[10px] text-slate-500 truncate max-w-[120px]">{r.driver_name}</div>
              </td>
              <td className="px-2 py-2 text-[11px] text-slate-300 truncate max-w-[150px]">{r.origin_name}</td>
              <td className="px-2 py-2">
                <span className="text-[11px] text-slate-200 tabular-nums">{r.stops_delivered}/{(r.stops || []).length}</span>
                <span className="text-[10px] text-slate-500"> delivered</span>
              </td>
              <td className="px-2 py-2 text-[11px] text-slate-200 text-right tabular-nums">{unitsCompact(r.total_units)}</td>
              <td className="px-2 py-2 text-[11px] text-slate-300 text-right tabular-nums">{r.total_km} km</td>
              <td className="px-2 py-2">
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${ROUTE_BADGE[r.status] || ROUTE_BADGE.dispatched}`}>
                  {(r.status || "").replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <div className="h-1 flex-1 rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${r.status === "completed" ? "bg-sky-500" : "bg-emerald-500"}`}
                         style={{ width: `${Math.min(100, r.progress_pct || 0)}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-500 tabular-nums w-7 text-right">{r.progress_pct || 0}%</span>
                </div>
              </td>
              <td className="px-2 py-2 text-right pr-3.5">
                <button
                  type="button" onClick={() => onOpenTimeline(r.id)}
                  data-testid="route-timeline-btn"
                  className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap"
                >
                  Timeline →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);
