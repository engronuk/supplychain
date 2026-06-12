// Phase 1 Logistics Control Tower — real-time, event-driven cockpit.
// Polls /logistics/control-tower every 25s; everything on screen is fed by
// the logistics event bus + live vehicle telemetry.
import { useCallback, useEffect, useState } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { ControlTowerMap } from "./ControlTowerMap";
import { KpiStrip, TierFlow, DigitalTwinPanel } from "./ControlTowerPanels";
import { EventsFeed } from "./ControlTowerFeed";
import { ShipmentsTable } from "./ControlTowerShipments";
import { VehicleTwinSheet } from "./VehicleTwinSheet";
import { WholesalerPendingSheet } from "./WholesalerPendingSheet";

const POLL_MS = 25000;

export const ControlTowerView = () => {
  const [data, setData] = useState(null);
  const [geofences, setGeofences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [sel, setSel] = useState({});
  const [pendingWho, setPendingWho] = useState(null);

  const reload = useCallback((silent = true) => {
    if (!silent) setRefreshing(true);
    return Api.controlTower()
      .then((d) => { setData(d); setLastSync(Date.now()); })
      .catch((e) => {
        if (!silent) {
          toast.error("Failed to refresh control tower", {
            description: e?.response?.data?.detail || e?.message,
          });
        }
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    reload(false);
    Api.logisticsGeofences().then((d) => setGeofences(d.geofences || [])).catch(() => {});
    const t = setInterval(() => reload(true), POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const openVehicle = useCallback((vid) => {
    if (vid) setSel({ vehicleId: vid });
  }, []);
  const openShipment = useCallback((s) => {
    const v = (data?.fleet || []).find((x) => x.ref_id === s.id && x.status !== "idle");
    setSel({ vehicleId: v?.id || null, shipmentId: s.id });
  }, [data]);

  if (loading) {
    return (
      <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 h-[480px] grid place-items-center text-slate-500 text-sm" data-testid="tower-loading">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Initializing control tower…
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 h-[320px] grid place-items-center text-slate-500 text-sm" data-testid="tower-error">
        <div className="text-center">
          Could not load the control tower.
          <Button variant="outline" className="ml-3 border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => reload(false)}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const k = data.kpis || {};
  const twin = data.digital_twin || {};
  const selVehicle = sel.vehicleId ? (data.fleet || []).find((v) => v.id === sel.vehicleId) : null;
  const selShipment = sel.shipmentId
    ? (data.shipments || []).find((s) => s.id === sel.shipmentId)
    : (selVehicle ? (data.shipments || []).find((s) => s.id === selVehicle.ref_id) : null);
  const sheetOpen = !!(selVehicle || selShipment);

  return (
    <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 p-4 md:p-5 space-y-4" data-testid="control-tower-view">
      {/* Status bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-[0.22em]">Live · Event-Driven</span>
          {lastSync && (
            <span className="text-[11px] text-slate-500" data-testid="tower-last-sync">
              Synced {new Date(lastSync).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] text-slate-400 inline-flex items-center gap-1.5" data-testid="tower-fleet-chip">
            <Radio className="h-3.5 w-3.5 text-emerald-400" /> Fleet {k.fleet_active || 0}/{k.fleet_total || 0} active
          </span>
          <Button
            size="sm" variant="outline"
            className="h-7 px-2 border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => reload(false)} disabled={refreshing} data-testid="tower-refresh-btn"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <KpiStrip kpis={k} />

      {/* Map + Event stream */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] gap-4">
        <ControlTowerMap
          fleet={data.fleet || []}
          geofences={geofences}
          warehouses={twin.warehouses || []}
          distributors={twin.distributors || []}
          retailerClusters={data.retailer_clusters || []}
          selectedVehicleId={sel.vehicleId}
          onSelectVehicle={openVehicle}
        />
        <EventsFeed refreshKey={lastSync} unackedCritical={k.unacked_critical} onFocusVehicle={openVehicle} />
      </div>

      <TierFlow tiers={data.tier_inventory || {}} />
      <DigitalTwinPanel twin={twin} onShowPending={setPendingWho} />
      <ShipmentsTable shipments={data.shipments || []} onTrack={openShipment} />

      <VehicleTwinSheet
        open={sheetOpen}
        onOpenChange={(o) => { if (!o) setSel({}); }}
        vehicle={selVehicle}
        shipment={selShipment}
      />
      <WholesalerPendingSheet wholesaler={pendingWho} onClose={() => setPendingWho(null)} />
    </div>
  );
};
