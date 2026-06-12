// Live shipments — inventory in transit across the network with progress,
// ETA and one-click digital-twin tracking.
import { useState } from "react";
import { PackageSearch } from "lucide-react";
import { unitsCompact } from "./ControlTowerPanels";

const BADGE = {
  in_transit: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  dispatched: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  delayed: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  received: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  delivered: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  completed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  default: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

const bucketOf = (s) => {
  if (s.status === "delayed") return "delayed";
  if (["in_transit", "dispatched"].includes(s.status)) return "moving";
  if (["received", "delivered", "completed"].includes(s.status)) return "delivered";
  return "queued";
};

const etaLabel = (mins) => {
  if (mins == null) return "—";
  if (mins <= 0) return "Arriving";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

const BUCKETS = [
  { id: "all", label: "All" },
  { id: "moving", label: "In Transit" },
  { id: "delayed", label: "Delayed" },
  { id: "delivered", label: "Delivered" },
  { id: "queued", label: "Queued" },
];

export const ShipmentsTable = ({ shipments = [], onTrack, onLocate }) => {
  const [bucket, setBucket] = useState("all");
  const counts = shipments.reduce((acc, s) => {
    const b = bucketOf(s);
    acc[b] = (acc[b] || 0) + 1;
    return acc;
  }, {});
  const filtered = bucket === "all" ? shipments : shipments.filter((s) => bucketOf(s) === bucket);

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden" data-testid="shipments-live-table">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <PackageSearch className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-100">Live Shipments</span>
        <span className="text-[10px] text-slate-500">inventory in transit · 14-day window</span>
        <div className="ml-auto flex items-center gap-1 flex-wrap">
          {BUCKETS.map((b) => (
            <button
              key={b.id} type="button" onClick={() => setBucket(b.id)}
              data-testid={`shipments-filter-${b.id}`}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors ${
                bucket === b.id
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                  : "bg-transparent border-slate-800 text-slate-500 hover:border-slate-600"
              }`}
            >
              {b.label} {b.id === "all" ? shipments.length : (counts[b.id] || 0)}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-[#0B1424] z-10">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-3.5 py-2 font-semibold">Tracking</th>
              <th className="px-2 py-2 font-semibold">Cargo</th>
              <th className="px-2 py-2 font-semibold text-right">Units</th>
              <th className="px-2 py-2 font-semibold">Destination</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold w-28">Progress</th>
              <th className="px-2 py-2 font-semibold">ETA</th>
              <th className="px-2 py-2 font-semibold">Vehicle · Driver</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-3.5 py-8 text-center text-[12px] text-slate-500">No shipments in this bucket.</td></tr>
            ) : filtered.map((s) => (
              <tr
                key={s.id}
                onClick={() => {
                  if (s.vehicle_code && ["in_transit", "delayed"].includes(s.status)) onLocate?.(s);
                }}
                title={s.vehicle_code && ["in_transit", "delayed"].includes(s.status)
                  ? "Click to locate this truck on the map" : undefined}
                className={`border-t border-slate-800/60 hover:bg-slate-800/30 transition-colors ${
                  s.vehicle_code && ["in_transit", "delayed"].includes(s.status) ? "cursor-pointer" : ""
                }`}
                data-testid="shipment-row"
              >
                <td className="px-3.5 py-2 text-[11px] font-mono text-slate-300">{s.tracking_code}</td>
                <td className="px-2 py-2">
                  <div className="text-[12px] text-slate-200 truncate max-w-[150px]">{s.product}</div>
                  {s.skus > 1 && <div className="text-[10px] text-slate-500">{s.skus} SKUs</div>}
                </td>
                <td className="px-2 py-2 text-[12px] text-slate-200 text-right tabular-nums">{unitsCompact(s.units)}</td>
                <td className="px-2 py-2">
                  <div className="text-[12px] text-slate-200 truncate max-w-[160px]">{s.to_name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{s.to_city}{s.to_region ? ` · ${s.to_region}` : ""}</div>
                </td>
                <td className="px-2 py-2">
                  <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${BADGE[s.status] || BADGE.default}`}>
                    {(s.status || "").replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {s.route_progress != null ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 flex-1 rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            s.status === "delayed" ? "bg-rose-500"
                              : ["received", "delivered", "completed"].includes(s.status) ? "bg-sky-500"
                                : "bg-emerald-500"
                          }`}
                          style={{ width: `${Math.min(100, s.route_progress)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 tabular-nums w-7 text-right">{s.route_progress}%</span>
                    </div>
                  ) : <span className="text-[11px] text-slate-600">—</span>}
                </td>
                <td className="px-2 py-2 text-[11px] whitespace-nowrap tabular-nums">
                  {["received", "delivered", "completed"].includes(s.status) ? (
                    <span className="text-sky-300 font-medium">Delivered</span>
                  ) : ["in_transit", "delayed"].includes(s.status) ? (
                    <span className="text-slate-300">{etaLabel(s.eta_minutes)}</span>
                  ) : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-2 py-2">
                  {s.vehicle_code ? (
                    <>
                      <div className="text-[11px] font-mono text-emerald-300">{s.vehicle_code}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[110px]">{s.driver || ""}</div>
                    </>
                  ) : ["in_transit", "delayed"].includes(s.status) ? (
                    <span className="text-[10px] text-amber-300/90 italic">assigning truck…</span>
                  ) : <span className="text-[11px] text-slate-600">—</span>}
                </td>
                <td className="px-2 py-2 text-right pr-3.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onTrack?.(s); }}
                    data-testid="shipment-track-btn"
                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap"
                  >
                    {s.vehicle_code ? "Track →" : "Details"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
