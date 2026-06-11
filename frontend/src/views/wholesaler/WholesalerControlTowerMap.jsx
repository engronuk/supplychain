import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { LogisticsMap } from "@/views/logistics/LogisticsMap";

/**
 * Wholesaler Control Tower Map (Phase 3E live).
 *
 * Wraps the existing LogisticsMap component with data sourced from
 * `/api/wholesaler/{wid}/control-tower/map`. The wholesaler hub renders
 * as the primary warehouse marker; each customer distributor renders as
 * an additional health-coloured node. Active shipments produce both an
 * animated route line and a truck marker that linearly interpolates
 * between origin and destination based on elapsed time vs ETA. Demand
 * hotspots are surfaced as toggleable circle overlays.
 *
 * Auto-refreshes every 30 seconds so trucks actually move on screen.
 */
export default function WholesalerControlTowerMap() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wid) return;
    let cancelled = false;
    const load = () =>
      WholesalerApi.controlTowerMap(wid)
        .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
        .catch(() => { if (!cancelled) setLoading(false); });
    load();
    const handle = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(handle); };
  }, [wid]);

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500"
           data-testid="ct-map-loading">
        Loading live map…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
        Map data unavailable.
      </div>
    );
  }

  // Combine hub + distributors as warehouse-style markers. The hub gets a
  // synthetic high count so it visually stands out as the network anchor.
  const warehouses = [
    {
      id: data.hub.id,
      name: data.hub.name,
      city: data.hub.city,
      region: data.hub.region,
      lat: data.hub.lat,
      lng: data.hub.lng,
      health: data.hub.health || "healthy",
      units: 9999,
      total_skus: 0,
      low_stock_skus: 0,
    },
    ...(data.distributors || []).map((d) => ({
      id: d.id,
      name: d.name,
      city: d.city,
      region: d.region,
      lat: d.lat,
      lng: d.lng,
      health: d.health,
      units: Math.round((d.revenue_90d || 0) / 1000),
      total_skus: d.orders_90d || 0,
      low_stock_skus: 0,
    })),
  ];

  return (
    <div data-testid="ct-live-map">
      <LogisticsMap
        warehouses={warehouses}
        routes={data.routes || []}
        trucks={data.trucks || []}
        demandOverlay={data.demand_overlay || []}
        onViewWarehouse={() => {}}
        autoFit
      />
    </div>
  );
}
