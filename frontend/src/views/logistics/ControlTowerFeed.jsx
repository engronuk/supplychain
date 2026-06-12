// Live event/alert stream — the visible face of the logistics event bus.
// Self-fetches /logistics/events with server-side filters; re-syncs whenever
// the parent control-tower poll completes (refreshKey).
import { useCallback, useEffect, useState } from "react";
import {
  Activity, Boxes, Check, Package, PackageCheck, Radar, Route as RouteIcon, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Api } from "../../lib/api";

const CAT_ICON = {
  route: RouteIcon, geofence: Radar, vehicle: Truck,
  shipment: Package, delivery: PackageCheck, inventory: Boxes,
};
const SEV = {
  critical: { bar: "bg-rose-500", text: "text-rose-400" },
  warning: { bar: "bg-amber-400", text: "text-amber-300" },
  info: { bar: "bg-sky-500", text: "text-sky-400" },
};
const FILTERS = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warning" },
  { id: "route", label: "Route" },
  { id: "geofence", label: "Geofence" },
  { id: "delivery", label: "Delivery" },
];

const timeAgo = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const EventsFeed = ({ refreshKey, unackedCritical, onFocusVehicle }) => {
  const [filter, setFilter] = useState("all");
  const [events, setEvents] = useState(null);

  const load = useCallback(() => {
    const params = { limit: 60 };
    if (filter === "critical" || filter === "warning") params.severity = filter;
    else if (filter !== "all") params.category = filter;
    return Api.logisticsEvents(params)
      .then((d) => setEvents(d.events || []))
      .catch(() => {});
  }, [filter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const ack = (id) =>
    Api.logisticsAckEvent(id)
      .then(() => {
        setEvents((prev) => (prev || []).map((e) => (e.id === id ? { ...e, acknowledged: true } : e)));
        toast.success("Alert acknowledged");
      })
      .catch((e) => toast.error("Failed to acknowledge", { description: e?.response?.data?.detail || e?.message }));

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col h-[560px] xl:h-[649px] min-w-0" data-testid="events-feed">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2">
        <Activity className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-semibold text-slate-100">Event Stream</span>
        {unackedCritical > 0 && (
          <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300" data-testid="feed-critical-badge">
            {unackedCritical} critical
          </span>
        )}
      </div>
      <div className="px-3 py-2 border-b border-slate-800/70 flex items-center gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id} type="button" onClick={() => setFilter(f.id)}
            data-testid={`events-filter-${f.id}`}
            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors ${
              filter === f.id
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                : "bg-transparent border-slate-800 text-slate-500 hover:border-slate-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
        {events === null ? (
          <div className="text-[12px] text-slate-500 text-center pt-8">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="text-[12px] text-slate-500 text-center pt-8">No events for this filter yet.</div>
        ) : (
          events.map((e) => {
            const sev = SEV[e.severity] || SEV.info;
            const Icon = CAT_ICON[e.category] || Package;
            return (
              <div
                key={e.id}
                className="relative pl-3.5 pr-2 py-2.5 rounded-lg bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition-colors"
                data-testid="event-row"
              >
                <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${sev.bar}`} />
                <div className="flex items-start gap-2.5">
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${sev.text}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-slate-100 leading-snug">{e.title}</div>
                    {e.detail && <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{e.detail}</div>}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {e.vehicle_code && (
                        <button
                          type="button"
                          onClick={() => onFocusVehicle?.(e.vehicle_id)}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 hover:bg-slate-700 transition-colors"
                          data-testid="event-vehicle-chip"
                        >
                          {e.vehicle_code}
                        </button>
                      )}
                      {e.location_name && <span className="text-[10px] text-slate-500 truncate max-w-[130px]">{e.location_name}</span>}
                      <span className="text-[10px] text-slate-600">{timeAgo(e.created_at)}</span>
                      {e.acknowledged && (
                        <span className="text-[10px] text-slate-600 inline-flex items-center gap-0.5">
                          <Check className="h-3 w-3" /> Ack
                        </span>
                      )}
                    </div>
                  </div>
                  {!e.acknowledged && e.severity !== "info" && (
                    <button
                      type="button"
                      onClick={() => ack(e.id)}
                      data-testid="event-ack-btn"
                      className="shrink-0 text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                    >
                      Ack
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
