/**
 * Cross-persona widgets that surface wholesaler-driven data into the
 * upstream (manufacturer) and downstream (distributor) workspaces, so the
 * platform feels truly connected end-to-end.
 *
 * All data is fetched LIVE from MongoDB via /api/* endpoints. No mock.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CrossPersonaApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PackageOpen, Truck, ShoppingCart, ChevronRight,
} from "lucide-react";

const FMT_NUM = new Intl.NumberFormat("en-US");
const FMT_CCY = new Intl.NumberFormat("en-NG", {
  style: "currency", currency: "NGN", maximumFractionDigits: 0,
});

const PO_TONE = {
  draft: "bg-slate-100 text-slate-700",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-violet-100 text-violet-700",
  allocated: "bg-amber-100 text-amber-700",
  shipped: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-slate-200 text-slate-700",
};

const SHIP_TONE = {
  created: "bg-slate-100 text-slate-700",
  loaded: "bg-blue-100 text-blue-700",
  in_transit: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  delayed: "bg-amber-100 text-amber-700",
};

/* =======================================================================
 * Manufacturer side — Wholesaler Replenishment Requests
 * ===================================================================== */
export function ManufacturerWholesalerPosWidget({ manufacturerId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!manufacturerId) return;
    CrossPersonaApi.manufacturerWholesalerPos(manufacturerId)
      .then(setData)
      .catch(() => setData(null));
  }, [manufacturerId]);

  if (!data) return null;
  const { kpis, purchase_orders } = data;

  return (
    <Card data-testid="manufacturer-wholesaler-pos-widget">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <PackageOpen className="h-4 w-4 text-violet-600" />
          Wholesaler Replenishment Requests
        </CardTitle>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
          {kpis.open_pos + kpis.in_fulfillment} active
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <KpiTile label="Open POs" value={FMT_NUM.format(kpis.open_pos)} tone={kpis.open_pos ? "warning" : "default"} />
          <KpiTile label="In Fulfilment" value={FMT_NUM.format(kpis.in_fulfillment)} />
          <KpiTile label="Delivered (90d)" value={FMT_NUM.format(kpis.delivered_90d)} tone="positive" />
          <KpiTile label="Open Value" value={FMT_CCY.format(kpis.total_open_value)} />
        </div>

        {purchase_orders.length === 0 ? (
          <p className="text-sm text-slate-500 py-3">No wholesaler POs in this tenant yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="wh-pos-table">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b">
                  <th className="py-2 px-3 font-medium">PO #</th>
                  <th className="py-2 px-3 font-medium">Wholesaler</th>
                  <th className="py-2 px-3 font-medium">Region</th>
                  <th className="py-2 px-3 font-medium text-right">Units</th>
                  <th className="py-2 px-3 font-medium text-right">Value</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {purchase_orders.slice(0, 10).map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium text-slate-800">{p.po_number}</td>
                    <td className="py-2 px-3">{p.wholesaler_name}</td>
                    <td className="py-2 px-3 text-slate-500">{p.wholesaler_region || "—"}</td>
                    <td className="py-2 px-3 text-right">{FMT_NUM.format(p.total_units)}</td>
                    <td className="py-2 px-3 text-right">{FMT_CCY.format(p.total_amount)}</td>
                    <td className="py-2 px-3">
                      <Badge className={`font-medium ${PO_TONE[p.status] || ""}`}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =======================================================================
 * Distributor side — My Orders to Wholesalers
 * ===================================================================== */
export function DistributorWholesalerOrdersWidget({ distributorId }) {
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!distributorId) return;
    CrossPersonaApi.distributorWholesalerOrders(distributorId)
      .then(setData)
      .catch(() => setData(null));
  }, [distributorId]);

  if (!data) return null;
  const { kpis, orders, shipments } = data;

  return (
    <Card data-testid="distributor-wholesaler-orders-widget">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-violet-600" />
          My Orders to Wholesalers
        </CardTitle>
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
          {kpis.open_orders} open
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <KpiTile label="Open Orders" value={FMT_NUM.format(kpis.open_orders)} tone={kpis.open_orders ? "warning" : "default"} />
          <KpiTile label="Delivered (90d)" value={FMT_NUM.format(kpis.delivered_90d)} tone="positive" />
          <KpiTile label="Active Shipments" value={FMT_NUM.format(kpis.active_shipments)} />
          <KpiTile label="Open Value" value={FMT_CCY.format(kpis.open_value)} />
        </div>

        {orders.length === 0 ? (
          <p className="text-sm text-slate-500 py-3">You haven't placed any orders with wholesalers yet.</p>
        ) : (
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Recent Orders</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="dist-wh-orders-table">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 px-3 font-medium">Order #</th>
                    <th className="py-2 px-3 font-medium">Wholesaler</th>
                    <th className="py-2 px-3 font-medium text-right">Lines</th>
                    <th className="py-2 px-3 font-medium text-right">Value</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 8).map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium text-slate-800">{o.order_number}</td>
                      <td className="py-2 px-3">{o.wholesaler_name}</td>
                      <td className="py-2 px-3 text-right">{(o.items || []).length}</td>
                      <td className="py-2 px-3 text-right">{FMT_CCY.format(o.total_amount)}</td>
                      <td className="py-2 px-3">
                        <Badge className={`font-medium ${PO_TONE[o.status] || ""}`}>{o.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {shipments.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Inbound Shipments</div>
            <div className="space-y-1.5">
              {shipments.filter((s) => s.status !== "delivered").slice(0, 5).map((s) => (
                <div key={s.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-lg px-3 py-2 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-800 truncate">
                      {s.shipment_number} <span className="text-slate-400">·</span> {s.wholesaler_name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {FMT_NUM.format(s.total_units)} units · ETA {s.eta_minutes || "—"} min
                    </div>
                  </div>
                  <Badge className={`font-medium ${SHIP_TONE[s.status] || ""}`}>{s.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiTile({ label, value, tone = "default" }) {
  const map = {
    default: "border-slate-200 bg-white",
    warning: "border-amber-200 bg-amber-50",
    positive: "border-emerald-200 bg-emerald-50",
  };
  return (
    <div className={`rounded-lg border p-2 ${map[tone] || map.default}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
