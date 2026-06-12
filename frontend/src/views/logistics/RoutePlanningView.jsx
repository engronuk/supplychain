// Phase 2 — Route Planning Center: dispatch board, multi-stop route builder
// (Google-optimized sequencing) and active route monitoring.
import { useCallback, useEffect, useState } from "react";
import { Map, PackagePlus, RefreshCw, Route as RouteIcon, Sparkles, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { Api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../components/ui/select";
import { RouteBuilderMap } from "./RouteBuilderMap";
import { PendingShipmentsPanel, ActiveRoutesTable } from "./RoutePlanningPanels";
import { AdHocStopDialog } from "./AdHocStopDialog";
import { RouteExecutionSheet } from "./RouteExecutionSheet";
import { unitsCompact } from "./ControlTowerPanels";

const errDetail = (e) => e?.response?.data?.detail || e?.message;

export const RoutePlanningView = () => {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState([]);
  const [originId, setOriginId] = useState("");
  const [optimize, setOptimize] = useState(true);
  const [vehicleId, setVehicleId] = useState("auto");
  const [driver, setDriver] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [execRouteId, setExecRouteId] = useState(null);

  const reload = useCallback(() =>
    Api.routePlanningBoard()
      .then(setBoard)
      .catch((e) => toast.error("Failed to load route planning board", { description: errDetail(e) }))
      .finally(() => setLoading(false)), []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  const hasShipmentStops = stops.some((s) => !s.ad_hoc);

  const toggleShipment = (p) => {
    setPreview(null);
    setStops((prev) => {
      if (prev.some((s) => s.shipment_id === p.id)) {
        const next = prev.filter((s) => s.shipment_id !== p.id);
        if (!next.some((s) => !s.ad_hoc) && !next.length) setOriginId("");
        return next;
      }
      if (prev.length >= 8) { toast.error("A route supports at most 8 stops"); return prev; }
      const shipmentStops = prev.filter((s) => !s.ad_hoc);
      if (shipmentStops.length && p.from_id !== originId) {
        toast.error("All shipments on one route must leave from the same warehouse");
        return prev;
      }
      if (!shipmentStops.length) setOriginId(p.from_id);
      return [...prev, {
        key: p.id, shipment_id: p.id, ad_hoc: false,
        dest_id: p.to_id, dest_type: p.to_role, dest_name: p.to_name,
        city: p.to_city, lat: p.lat, lng: p.lng,
        units: p.units, tracking_code: p.tracking_code,
      }];
    });
  };

  const removeStop = (key) => {
    setPreview(null);
    setStops((prev) => {
      const next = prev.filter((s) => s.key !== key);
      if (!next.length) setOriginId("");
      return next;
    });
  };

  const addAdhoc = (stop) => {
    if (stops.length >= 8) return toast.error("A route supports at most 8 stops");
    setPreview(null);
    setStops((prev) => [...prev, stop]);
  };

  const buildPayload = () => ({
    origin_id: originId,
    optimize,
    stops: stops.map((s) => s.ad_hoc
      ? { dest_id: s.dest_id, dest_type: s.dest_type, items: s.items }
      : { shipment_id: s.shipment_id }),
  });

  const computePreview = () => {
    if (!originId) return toast.error("Pick an origin warehouse first");
    if (!stops.length) return toast.error("Add at least one stop");
    setPreviewing(true);
    Api.routePreview(buildPayload())
      .then(setPreview)
      .catch((e) => toast.error("Could not compute route", { description: errDetail(e) }))
      .finally(() => setPreviewing(false));
  };

  const dispatchRoute = () => {
    if (!originId) return toast.error("Pick an origin warehouse first");
    if (!stops.length) return toast.error("Add at least one stop");
    setDispatching(true);
    Api.routeDispatch({
      ...buildPayload(),
      vehicle_id: vehicleId === "auto" ? null : vehicleId,
      driver_name: driver || null,
    })
      .then((d) => {
        toast.success(`Route ${d.route.code} dispatched`, {
          description: `Truck ${d.vehicle_code} · ${d.route.stops.length} stop(s) · ${d.route.total_km} km`,
        });
        setStops([]); setPreview(null); setOriginId("");
        setDriver(""); setVehicleId("auto");
        reload();
      })
      .catch((e) => toast.error("Dispatch failed", { description: errDetail(e) }))
      .finally(() => setDispatching(false));
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 h-[420px] grid place-items-center text-slate-500 text-sm" data-testid="route-planning-loading">
        <div className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading route planning center…</div>
      </div>
    );
  }
  if (!board) {
    return (
      <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 h-[320px] grid place-items-center text-slate-500 text-sm" data-testid="route-planning-error">
        Could not load the planning board.
        <Button variant="outline" className="ml-3 border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={reload}>Retry</Button>
      </div>
    );
  }

  const activeRoutes = (board.routes || []).filter((r) => r.status !== "completed").length;
  const selectedIds = new Set(stops.filter((s) => !s.ad_hoc).map((s) => s.shipment_id));
  const originObj = (board.warehouses || []).find((w) => w.id === originId) || null;

  return (
    <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 p-4 md:p-5 space-y-4" data-testid="route-planning-view">
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2">
          <Map className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-slate-100">Route Planning Center</span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">bundle deliveries · optimize the run · dispatch in one click</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatChip label="awaiting dispatch" value={(board.pending_shipments || []).length} tone="amber" testId="plan-stat-pending" />
          <StatChip label="idle trucks" value={(board.idle_vehicles || []).length} tone="sky" testId="plan-stat-idle" />
          <StatChip label="active routes" value={activeRoutes} tone="emerald" testId="plan-stat-routes" />
          <Button size="sm" variant="outline" className="h-7 px-2 border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={reload} data-testid="plan-refresh-btn">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Board + builder */}
      <div className="grid grid-cols-1 xl:grid-cols-[370px_minmax(0,1fr)] gap-4">
        <PendingShipmentsPanel
          pending={board.pending_shipments || []}
          warehouses={board.warehouses || []}
          selectedIds={selectedIds}
          lockedOrigin={hasShipmentStops ? originId : null}
          onToggle={toggleShipment}
          onAddAdhoc={() => setAdhocOpen(true)}
        />
        <div className="space-y-4 min-w-0">
          <RouteBuilderMap origin={originObj} stops={stops} preview={preview} />

          {/* Builder controls */}
          <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 space-y-3" data-testid="route-builder">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Origin</span>
                <Select value={originId} onValueChange={(v) => { setOriginId(v); setPreview(null); }} disabled={hasShipmentStops}>
                  <SelectTrigger className="h-8 w-[230px] bg-slate-900 border-slate-700 text-slate-200 text-xs" data-testid="builder-origin-select">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    {(board.warehouses || []).map((w) => (
                      <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer" data-testid="builder-optimize-toggle">
                <Switch checked={optimize} onCheckedChange={(v) => { setOptimize(v); setPreview(null); }} />
                <span className="text-[11px] text-slate-300 inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-emerald-400" /> Optimize stop sequence
                </span>
              </label>
              <span className="ml-auto text-[11px] text-slate-500" data-testid="builder-stop-count">
                {stops.length}/8 stops · {unitsCompact(stops.reduce((a, s) => a + (s.units || 0), 0))} units
              </span>
            </div>

            {/* Stops / itinerary */}
            {stops.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-[12px] text-slate-500" data-testid="builder-empty">
                Tick pending shipments on the left or add an ad-hoc delivery to start building a route.
              </div>
            ) : preview ? (
              <Itinerary preview={preview} onRemove={removeStop} stops={stops} />
            ) : (
              <div className="flex items-center gap-1.5 flex-wrap">
                {stops.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-slate-800/80 border border-slate-700 text-[11px] text-slate-200" data-testid="builder-stop-chip">
                    {s.ad_hoc && <PackagePlus className="h-3 w-3 text-violet-400" />}
                    <span className="truncate max-w-[160px]">{s.dest_name}</span>
                    <span className="text-slate-500">{unitsCompact(s.units)}u</span>
                    <button type="button" onClick={() => removeStop(s.key)} className="p-0.5 rounded hover:bg-slate-700 text-slate-400" data-testid="builder-stop-remove">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Dispatch row */}
            <div className="flex items-center gap-2.5 flex-wrap pt-1 border-t border-slate-800/70">
              <div className="flex items-center gap-2">
                <Truck className="h-3.5 w-3.5 text-slate-500" />
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger className="h-8 w-[190px] bg-slate-900 border-slate-700 text-slate-200 text-xs" data-testid="builder-vehicle-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                    <SelectItem value="auto" className="text-xs">Auto — commission new truck</SelectItem>
                    {(board.idle_vehicles || []).map((v) => (
                      <SelectItem key={v.id} value={v.id} className="text-xs">
                        {v.code} · {v.driver_name || "no driver"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={driver} onChange={(e) => setDriver(e.target.value)}
                placeholder="Driver (optional)"
                className="h-8 w-[170px] bg-slate-900 border-slate-700 text-slate-200 text-xs placeholder:text-slate-600"
                data-testid="builder-driver-input"
              />
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm" variant="outline"
                  className="h-8 border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
                  onClick={computePreview} disabled={previewing || !stops.length}
                  data-testid="builder-preview-btn"
                >
                  <RouteIcon className={`h-3.5 w-3.5 mr-1.5 ${previewing ? "animate-pulse" : ""}`} />
                  {previewing ? "Computing…" : "Compute route"}
                </Button>
                <Button
                  size="sm"
                  className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white"
                  onClick={dispatchRoute} disabled={dispatching || !stops.length}
                  data-testid="builder-dispatch-btn"
                >
                  <Truck className="h-3.5 w-3.5 mr-1.5" />
                  {dispatching ? "Dispatching…" : "Dispatch route"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ActiveRoutesTable routes={board.routes || []} onOpenTimeline={setExecRouteId} />

      <AdHocStopDialog
        open={adhocOpen} onOpenChange={setAdhocOpen}
        destinations={board.destinations || []} products={board.products || []}
        onAdd={addAdhoc}
      />
      <RouteExecutionSheet
        routeId={execRouteId} open={!!execRouteId}
        onOpenChange={(o) => { if (!o) setExecRouteId(null); }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
function Itinerary({ preview, stops, onRemove }) {
  // Match preview stops back to local drafts so removal still works.
  const used = new Set();
  const keyFor = (ps) => {
    const draft = stops.find((s) => !used.has(s.key) && (
      ps.shipment_id ? s.shipment_id === ps.shipment_id : (s.ad_hoc && s.dest_id === ps.dest_id)));
    if (draft) { used.add(draft.key); return draft.key; }
    return null;
  };
  return (
    <div className="space-y-1.5" data-testid="builder-itinerary">
      {preview.stops.map((s) => {
        const k = keyFor(s);
        return (
          <div key={s.seq} className="flex items-center gap-2.5 rounded-lg bg-slate-800/50 border border-slate-700/60 px-2.5 py-1.5" data-testid="itinerary-stop">
            <span className="h-5 w-5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold grid place-items-center shrink-0">{s.seq}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-slate-200 truncate">
                {s.dest_name}{s.city ? <span className="text-slate-500"> · {s.city}</span> : null}
              </div>
              <div className="text-[10px] text-slate-500">
                leg {s.leg_km} km · {s.leg_min} min · cumulative {s.cum_km} km / {s.cum_min} min
              </div>
            </div>
            <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{unitsCompact(s.units)}u</span>
            {k && (
              <button type="button" onClick={() => onRemove(k)} className="p-0.5 rounded hover:bg-slate-700 text-slate-500" data-testid="itinerary-stop-remove">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3 px-1 pt-1 text-[11px] text-slate-400 flex-wrap" data-testid="builder-totals">
        <span className="font-semibold text-slate-200">{preview.total_km} km</span>
        <span>{Math.floor(preview.total_min / 60)}h {preview.total_min % 60}m drive</span>
        <span>{unitsCompact(preview.total_units)} units</span>
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
          preview.source === "google"
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
          {preview.source === "google" ? "Google roads" : "Estimated"}
        </span>
        {preview.optimized && <span className="text-emerald-400 inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> optimized</span>}
      </div>
    </div>
  );
}

function StatChip({ label, value, tone, testId }) {
  const tones = {
    amber: "text-amber-300 border-amber-500/30 bg-amber-500/10",
    sky: "text-sky-300 border-sky-500/30 bg-sky-500/10",
    emerald: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  };
  return (
    <span className={`text-[11px] px-2 py-1 rounded-md border font-medium ${tones[tone]}`} data-testid={testId}>
      <span className="font-bold tabular-nums">{value}</span> {label}
    </span>
  );
}
