// Digital twin side panel — live vehicle + shipment state with the full
// event audit trail from the logistics event bus.
import { useEffect, useState } from "react";
import {
  AlertTriangle, Fuel, Gauge, MapPin, Navigation, Phone, Timer, User, Wrench,
} from "lucide-react";
import { Api } from "../../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../../components/ui/sheet";

const STATUS_BADGE = {
  in_transit: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  stopped: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  breakdown: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  idle: "bg-slate-700/40 text-slate-300 border-slate-600",
};

const num = (n) => (Number(n) || 0).toLocaleString();
const etaLabel = (mins) => {
  if (mins == null) return "—";
  if (mins <= 0) return "Arriving";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
};
const dotColor = (sev) =>
  sev === "critical" ? "bg-rose-500" : sev === "warning" ? "bg-amber-400" : "bg-sky-500";

export const VehicleTwinSheet = ({ open, onOpenChange, vehicle: v, shipment: s }) => {
  const sid = v?.ref_id || s?.id;
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    if (!open || !sid) { setTimeline(null); return; }
    let alive = true;
    Api.shipmentTimeline(sid)
      .then((d) => { if (alive) setTimeline(d.timeline || []); })
      .catch(() => { if (alive) setTimeline([]); });
    return () => { alive = false; };
  }, [open, sid]);

  const progress = v ? Math.round((Number(v.route_progress) || 0) * 100) : (s?.route_progress ?? null);
  const fuel = v ? Number(v.fuel_pct) || 0 : null;
  const fuelBar = fuel == null ? "" : fuel < 20 ? "bg-rose-500" : fuel < 40 ? "bg-amber-400" : "bg-emerald-500";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        className="w-full sm:max-w-md bg-[#0B1220] border-slate-800 text-slate-200 overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        data-testid="vehicle-twin-sheet"
      >
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-white flex items-center gap-2 flex-wrap">
            {v ? <>Truck {v.code}</> : <>Shipment {s?.tracking_code}</>}
            {v && (
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${STATUS_BADGE[v.status] || STATUS_BADGE.idle}`} data-testid="twin-status-badge">
                {(v.status || "").replace(/_/g, " ")}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-slate-500 text-xs">
            {v ? `Plate ${v.plate} · digital twin & event audit trail` : "Shipment digital twin & event audit trail"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Exception banners */}
          {v?.status === "breakdown" && (
            <Banner Icon={Wrench} cls="bg-rose-500/10 border-rose-500/30 text-rose-300"
                    text="Breakdown reported — recovery dispatched" />
          )}
          {v?.status === "stopped" && (
            <Banner Icon={AlertTriangle} cls="bg-orange-500/10 border-orange-500/30 text-orange-300"
                    text="Unscheduled stop in progress — contact driver" />
          )}
          {v?.deviation?.active && (
            <Banner Icon={Navigation} cls="bg-orange-500/10 border-orange-500/30 text-orange-300"
                    text={`${v.deviation.offset_km} km off approved route — risk flagged`} />
          )}

          {/* Vehicle telemetry */}
          {v && (
            <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5 space-y-3" data-testid="twin-telemetry">
              <div className="grid grid-cols-3 gap-3">
                <Stat Icon={Gauge} label="Speed" value={`${num(v.speed_kmh)} km/h`} />
                <Stat Icon={Fuel} label="Fuel" value={`${fuel}%`} />
                <Stat Icon={Timer} label="ETA" value={v.status === "in_transit" ? etaLabel(v.eta_minutes) : "—"} />
              </div>
              {fuel != null && (
                <div className="h-1 rounded-full bg-slate-800">
                  <div className={`h-full rounded-full ${fuelBar}`} style={{ width: `${Math.min(100, fuel)}%` }} />
                </div>
              )}
              <div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                  <span>Route progress</span>
                  <span className="tabular-nums">{progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, progress || 0)}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/70">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                  <User className="h-3.5 w-3.5 text-slate-500" /> {v.driver_name || "—"}
                </span>
                {v.driver_phone && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                    <Phone className="h-3 w-3 text-slate-500" /> {v.driver_phone}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Route */}
          {v && (
            <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5" data-testid="twin-route">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Route</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                  v.route_source === "google"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-slate-800/60 border-slate-700 text-slate-400"
                }`} data-testid="twin-route-source">
                  {v.route_source === "google" ? "Google road route" : "Estimated path"}
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <MapPin className="h-3.5 w-3.5 text-sky-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[12px] text-slate-200">{v.origin_name || "Origin"}</div>
                    <div className="text-[10px] text-slate-500">Origin</div>
                  </div>
                </div>
                <div className="ml-[7px] border-l border-dashed border-slate-700 h-3" />
                <div className="flex items-start gap-2">
                  <Navigation className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[12px] text-slate-200">{v.dest_name || s?.to_name || "Destination"}</div>
                    <div className="text-[10px] text-slate-500">
                      Destination{v.route_km ? ` · ${num(Math.round(v.route_km))} km route` : ""}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shipment cargo */}
          {s && (
            <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5" data-testid="twin-shipment">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-2">Shipment</div>
              {!v && !["received", "delivered", "completed"].includes(s.status) && (
                <div className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300">
                  {["in_transit", "delayed"].includes(s.status)
                    ? "Truck being assigned — live tracking starts shortly."
                    : "Awaiting dispatch — no truck assigned yet."}
                </div>
              )}
              <div className="grid grid-cols-2 gap-y-1.5 text-[12px]">
                <span className="text-slate-500">Tracking</span>
                <span className="text-slate-200 font-mono text-right">{s.tracking_code}</span>
                <span className="text-slate-500">Status</span>
                <span className="text-slate-200 text-right uppercase text-[11px] font-semibold">{(s.status || "").replace(/_/g, " ")}</span>
                <span className="text-slate-500">Units</span>
                <span className="text-slate-200 text-right tabular-nums">{num(s.units)}</span>
                <span className="text-slate-500">To</span>
                <span className="text-slate-200 text-right truncate">{s.to_name}{s.to_city ? ` · ${s.to_city}` : ""}</span>
              </div>
              {(s.items || []).length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-slate-800/70" data-testid="twin-cargo-manifest">
                  <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Cargo manifest</div>
                  <div className="space-y-1">
                    {s.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-300 truncate">{it.name}</span>
                        <span className="text-slate-400 tabular-nums shrink-0">{num(it.quantity)} units</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Event timeline */}
          <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5" data-testid="twin-timeline">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-3">Event Audit Trail</div>
            {timeline === null ? (
              <div className="text-[12px] text-slate-500 py-3 text-center">Loading timeline…</div>
            ) : timeline.length === 0 ? (
              <div className="text-[12px] text-slate-500 py-3 text-center">No events recorded yet.</div>
            ) : (
              <div>
                {timeline.slice().reverse().map((e, i) => (
                  <div key={e.id || i} className="relative pl-5 pb-3.5 border-l border-slate-800 ml-1.5 last:border-transparent last:pb-0">
                    <span className={`absolute -left-[5px] top-0.5 h-2.5 w-2.5 rounded-full ${dotColor(e.severity)} ring-2 ring-[#0B1220]`} />
                    <div className="text-[12px] font-semibold text-slate-100 leading-snug">{e.title}</div>
                    {e.detail && <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{e.detail}</div>}
                    <div className="text-[10px] text-slate-600 mt-0.5">{fmtTime(e.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

function Stat({ Icon, label, value }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] text-slate-500 uppercase tracking-wide font-semibold">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-[13px] font-bold text-white mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function Banner({ Icon, cls, text }) {
  return (
    <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 text-[12px] font-medium ${cls}`} data-testid="twin-exception-banner">
      <Icon className="h-3.5 w-3.5 shrink-0" /> {text}
    </div>
  );
}
