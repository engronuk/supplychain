// Delivery Execution Timeline — leg-by-leg planned vs actual progress of a
// dispatched route plus its full event audit trail. Auto-refreshes while open.
import { useEffect, useState } from "react";
import { Check, CircleDashed, Flag, MapPin, RefreshCw, Truck } from "lucide-react";
import { Api } from "../../lib/api";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "../../components/ui/sheet";

const num = (n) => (Number(n) || 0).toLocaleString();
const fmtTime = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
};
const dotColor = (sev) =>
  sev === "critical" ? "bg-rose-500" : sev === "warning" ? "bg-amber-400" : "bg-sky-500";

const STATUS_BADGE = {
  dispatched: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  in_progress: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  completed: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export const RouteExecutionSheet = ({ routeId, open, onOpenChange }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!open || !routeId) { setData(null); return; }
    let alive = true;
    const load = () => Api.routeDetail(routeId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [open, routeId]);

  const r = data?.route;
  const v = data?.vehicle;
  const stops = r?.stops || [];
  const nextSeq = stops.find((s) => s.status !== "delivered")?.seq;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md bg-[#0B1220] border-slate-800 text-slate-200 overflow-y-auto" data-testid="route-execution-sheet">
        {!r ? (
          <div className="h-40 grid place-items-center text-slate-500 text-sm">
            <div className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading route…</div>
          </div>
        ) : (
          <>
            <SheetHeader className="space-y-1">
              <SheetTitle className="text-white flex items-center gap-2 flex-wrap">
                Route {r.code}
                <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${STATUS_BADGE[r.status] || STATUS_BADGE.dispatched}`} data-testid="exec-status-badge">
                  {(r.status || "").replace(/_/g, " ")}
                </span>
              </SheetTitle>
              <SheetDescription className="text-slate-500 text-xs">
                {r.vehicle_code} · {r.driver_name} · dispatched {fmtTime(r.dispatched_at)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {/* Summary */}
              <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5 space-y-2.5" data-testid="exec-summary">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Distance</div>
                    <div className="text-[13px] font-bold text-white tabular-nums">{r.total_km} km</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Drive time</div>
                    <div className="text-[13px] font-bold text-white tabular-nums">
                      {Math.floor((r.total_min || 0) / 60)}h {(r.total_min || 0) % 60}m
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">Units</div>
                    <div className="text-[13px] font-bold text-white tabular-nums">{num(r.total_units)}</div>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span className="inline-flex items-center gap-1">
                      <Truck className="h-3 w-3" />
                      {r.status === "completed" ? "Run complete" : v?.status ? `Truck ${(v.status || "").replace(/_/g, " ")}` : "Awaiting telemetry"}
                    </span>
                    <span className="tabular-nums">{r.progress_pct || 0}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800" data-testid="exec-progress">
                    <div className={`h-full rounded-full ${r.status === "completed" ? "bg-sky-500" : "bg-emerald-500"}`}
                         style={{ width: `${Math.min(100, r.progress_pct || 0)}%` }} />
                  </div>
                </div>
              </div>

              {/* Stop-by-stop execution */}
              <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5" data-testid="exec-itinerary">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-3">
                  Delivery execution — planned vs actual
                </div>

                <div className="relative pl-5 pb-3.5 border-l border-slate-800 ml-2">
                  <span className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-blue-500 grid place-items-center ring-2 ring-[#0B1220]">
                    <MapPin className="h-2.5 w-2.5 text-white" />
                  </span>
                  <div className="text-[12px] font-semibold text-slate-100">{r.origin_name}</div>
                  <div className="text-[10px] text-slate-500">Origin · departed {fmtTime(r.dispatched_at)}</div>
                </div>

                {stops.map((s, i) => {
                  const delivered = s.status === "delivered";
                  const isNext = s.seq === nextSeq && r.status !== "completed";
                  const last = i === stops.length - 1;
                  return (
                    <div key={s.seq} className={`relative pl-5 ml-2 ${last ? "" : "pb-3.5 border-l border-slate-800"}`} data-testid="exec-stop-row">
                      <span className={`absolute -left-[9px] top-0 h-4 w-4 rounded-full grid place-items-center ring-2 ring-[#0B1220] ${
                        delivered ? "bg-emerald-500" : isNext ? "bg-amber-400 animate-pulse" : "bg-slate-700"}`}>
                        {delivered
                          ? <Check className="h-2.5 w-2.5 text-[#06291d]" />
                          : last
                            ? <Flag className="h-2.5 w-2.5 text-slate-200" />
                            : <CircleDashed className="h-2.5 w-2.5 text-slate-300" />}
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[12px] font-semibold text-slate-100 truncate">
                          {s.seq}. {s.dest_name}
                          {s.city ? <span className="text-slate-500 font-normal"> · {s.city}</span> : null}
                        </div>
                        <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{num(s.units)}u</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Planned: leg {s.leg_km} km · {s.leg_min} min (cum {s.cum_min} min)
                      </div>
                      <div className={`text-[10px] mt-0.5 ${delivered ? "text-emerald-400" : isNext ? "text-amber-300" : "text-slate-600"}`}>
                        {delivered
                          ? `Delivered ${fmtTime(s.delivered_at)}`
                          : isNext ? "En route — next stop" : "Pending"}
                        {s.tracking_code && <span className="text-slate-600 font-mono"> · {s.tracking_code}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Event audit trail */}
              <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5" data-testid="exec-events">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-3">Event audit trail</div>
                {(data.events || []).length === 0 ? (
                  <div className="text-[12px] text-slate-500 py-2 text-center">No events yet.</div>
                ) : (
                  <div>
                    {data.events.slice().reverse().map((e, i) => (
                      <div key={e.id || i} className="relative pl-5 pb-3 border-l border-slate-800 ml-1.5 last:border-transparent last:pb-0">
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
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
