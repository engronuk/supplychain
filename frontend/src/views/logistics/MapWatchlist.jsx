// Fullscreen wall-board watchlist — pin up to 3 critical trucks and keep
// their live telemetry (ETA / speed / progress / exceptions) in a side rail
// while the map runs unattended on a monitoring screen.
// Pins persist in localStorage so the board survives reloads.
import { useEffect, useRef, useState } from "react";
import { Gauge, MapPin, Pin, Plus, Timer, X } from "lucide-react";
import { vehicleColor } from "./ControlTowerMap";

const LS_KEY = "tower_watchlist_v1";
const MAX_PINS = 3;

const loadPins = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
};

const etaLabel = (m) => {
  const mins = Number(m);
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
};

const exceptionLabel = (v) => {
  if (v.status === "breakdown") return "BREAKDOWN";
  if (v.status === "stopped") return "UNSCHEDULED STOP";
  if (v.deviation?.active) return "OFF ROUTE";
  if ((Number(v.speed_kmh) || 55) < 40) return "RUNNING SLOW";
  return null;
};

export const MapWatchlist = ({ fleet = [], onFocus }) => {
  const [pins, setPins] = useState(loadPins);
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(pins)); } catch { /* noop */ }
  }, [pins]);

  useEffect(() => {
    if (!picking) return;
    const close = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPicking(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [picking]);

  const byId = new Map(fleet.map((v) => [v.id, v]));
  const active = fleet.filter((v) => v.status !== "idle" && v.lat != null);
  // Exceptions first in the picker — those are the trucks worth watching.
  const candidates = active
    .filter((v) => !pins.includes(v.id))
    .sort((a, b) => (exceptionLabel(a) ? 0 : 1) - (exceptionLabel(b) ? 0 : 1));

  const unpin = (id) => setPins((p) => p.filter((x) => x !== id));
  const pin = (id) => {
    setPins((p) => (p.includes(id) || p.length >= MAX_PINS ? p : [...p, id]));
    setPicking(false);
  };

  return (
    <div
      className="absolute right-3 top-14 w-72 max-h-[calc(100%-7rem)] flex flex-col gap-2 z-10"
      data-testid="map-watchlist"
    >
      <div className="relative z-30 rounded-xl bg-[#0B1220]/90 backdrop-blur-md border border-slate-700/70 px-3 py-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-200">
          <Pin className="h-3.5 w-3.5 text-emerald-400" /> Watchlist
          <span className="text-slate-500 normal-case font-normal">{pins.length}/{MAX_PINS}</span>
        </span>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            disabled={pins.length >= MAX_PINS}
            onClick={() => setPicking((p) => !p)}
            data-testid="watchlist-add-btn"
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40 transition-colors"
          >
            <Plus className="h-3 w-3" /> Pin truck
          </button>
          {picking && (
            <div
              className="absolute right-0 top-8 w-60 max-h-72 overflow-y-auto rounded-xl bg-[#0B1220]/97 backdrop-blur-md border border-slate-700 shadow-2xl z-20"
              data-testid="watchlist-picker"
            >
              {candidates.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-slate-500 text-center">No active trucks to pin.</div>
              ) : candidates.slice(0, 30).map((v) => {
                const exc = exceptionLabel(v);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => pin(v.id)}
                    data-testid="watchlist-pick-item"
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/70 transition-colors"
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: vehicleColor(v) }} />
                    <span className="text-[11px] font-mono text-slate-200 shrink-0">{v.code}</span>
                    <span className="text-[10px] text-slate-500 truncate flex-1">→ {v.dest_name || "—"}</span>
                    {exc && <span className="text-[9px] font-semibold text-orange-300 shrink-0">{exc}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 overflow-y-auto pr-0.5">
        {pins.length === 0 && (
          <div className="rounded-xl bg-[#0B1220]/85 backdrop-blur-md border border-dashed border-slate-700 px-3 py-5 text-center text-[11px] text-slate-500">
            Pin up to {MAX_PINS} critical trucks to keep their live ETA &amp; speed on this board.
          </div>
        )}
        {pins.map((id) => {
          const v = byId.get(id);
          if (!v || v.status === "idle") {
            return (
              <div key={id} className="rounded-xl bg-[#0B1220]/85 backdrop-blur-md border border-slate-800 px-3 py-2.5 flex items-center justify-between" data-testid="watchlist-card">
                <span className="text-[11px] text-slate-500">
                  {v ? `${v.code} — trip complete (idle)` : "Truck no longer active"}
                </span>
                <button type="button" onClick={() => unpin(id)} data-testid="watchlist-unpin-btn"
                        className="text-slate-500 hover:text-slate-300"><X className="h-3.5 w-3.5" /></button>
              </div>
            );
          }
          const color = vehicleColor(v);
          const exc = exceptionLabel(v);
          const prog = Math.min(100, Math.round((Number(v.route_progress) || 0) * 100));
          return (
            <div
              key={id}
              className="rounded-xl bg-[#0B1220]/90 backdrop-blur-md border border-slate-700/70 px-3 py-2.5 cursor-pointer hover:border-emerald-500/40 transition-colors"
              onClick={() => onFocus?.(v)}
              data-testid="watchlist-card"
              title="Click to centre the map on this truck"
            >
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0 animate-pulse" style={{ background: color }} />
                <span className="text-[13px] font-mono font-semibold text-white">{v.code}</span>
                {exc ? (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-orange-500/40 bg-orange-500/10 text-orange-300">{exc}</span>
                ) : (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">ON ROUTE</span>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); unpin(id); }}
                  data-testid="watchlist-unpin-btn"
                  className="ml-auto text-slate-500 hover:text-rose-300 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 text-[10px] text-slate-400 truncate inline-flex items-center gap-1 max-w-full">
                <MapPin className="h-3 w-3 text-slate-600 shrink-0" />
                <span className="truncate">{v.dest_name || "—"}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[11px]">
                <span className="inline-flex items-center gap-1 text-slate-300 tabular-nums">
                  <Timer className="h-3 w-3 text-slate-500" />
                  {prog >= 99 ? "Arriving now" : `ETA ${etaLabel(v.eta_minutes)}`}
                </span>
                <span className="inline-flex items-center gap-1 text-slate-300 tabular-nums justify-end">
                  <Gauge className="h-3 w-3 text-slate-500" /> {Math.round(Number(v.speed_kmh) || 0)} km/h
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="h-1 flex-1 rounded-full bg-slate-800">
                  <div className="h-full rounded-full" style={{ width: `${prog}%`, background: color }} />
                </div>
                <span className="text-[9px] text-slate-500 tabular-nums w-7 text-right">{prog}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
