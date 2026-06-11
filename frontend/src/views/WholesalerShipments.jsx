import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PageHeader, KpiCard, fmtNumber, EmptyState,
} from "./wholesaler/ui";
import {
  Truck, Activity, AlertTriangle, RefreshCw, MapPin, ChevronRight,
} from "lucide-react";

const SHIP_STAGES = ["created", "loaded", "in_transit", "delivered"];
const SHIP_TONE = {
  created:    "bg-slate-100 text-slate-700",
  loaded:     "bg-blue-100 text-blue-700",
  in_transit: "bg-sky-100 text-sky-700",
  delivered:  "bg-emerald-100 text-emerald-700",
  delayed:    "bg-amber-100 text-amber-700",
  cancelled:  "bg-slate-200 text-slate-700",
  failed:     "bg-rose-100 text-rose-700",
};

export default function WholesalerShipments() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [dashboard, setDashboard] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeId, setActiveId] = useState(null);

  const refresh = () => {
    if (!wid) return;
    setLoading(true);
    Promise.all([
      WholesalerApi.shipmentsDashboard(wid),
      WholesalerApi.listShipments(wid),
    ])
      .then(([d, r]) => { setDashboard(d); setRows(r); })
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [wid]);

  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);

  if (loading || !dashboard) {
    return <div className="p-8 text-sm text-slate-500" data-testid="wholesaler-shipments-loading">Loading shipments…</div>;
  }
  const k = dashboard.kpis;

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-shipments">
      <PageHeader
        title="Shipment Management"
        subtitle="Outbound shipments from your aggregation hub to distributors."
        action={
          <Button variant="outline" size="sm" onClick={refresh} data-testid="ship-refresh">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard testid="ship-active" icon={Truck} label="Active Shipments" value={fmtNumber(k.active_shipments)} />
        <KpiCard testid="ship-delivered-today" icon={Activity} label="Delivered Today" value={fmtNumber(k.delivered_today)} tone="positive" />
        <KpiCard testid="ship-delayed" icon={AlertTriangle} label="Delayed" value={fmtNumber(k.delayed_shipments)} tone={k.delayed_shipments > 0 ? "alert" : "default"} />
        <KpiCard testid="ship-pending" icon={Truck} label="Pending Dispatch" value={fmtNumber(k.pending_dispatch)} />
        <KpiCard
          testid="ship-avg-time"
          icon={Activity}
          label="Avg Delivery Time"
          value={k.avg_delivery_hours != null ? `${k.avg_delivery_hours}h` : "—"}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Shipment Ledger ({filtered.length})</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="ship-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {["created", "loaded", "in_transit", "delivered", "delayed", "cancelled"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No shipments" body="Dispatch a fulfillment to create a shipment." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="ship-table">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 px-3 font-medium">Shipment #</th>
                    <th className="py-2 px-3 font-medium">Order</th>
                    <th className="py-2 px-3 font-medium">Distributor</th>
                    <th className="py-2 px-3 font-medium">Region</th>
                    <th className="py-2 px-3 font-medium">Shipment Date</th>
                    <th className="py-2 px-3 font-medium">ETA</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setActiveId(s.id)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                      data-testid={`ship-row-${s.shipment_number}`}
                    >
                      <td className="py-2 px-3 font-medium text-slate-800">{s.shipment_number}</td>
                      <td className="py-2 px-3 text-slate-700">{s.order_number}</td>
                      <td className="py-2 px-3">{s.distributor?.name}</td>
                      <td className="py-2 px-3 text-slate-500">{s.distributor?.region || "—"}</td>
                      <td className="py-2 px-3 text-slate-500 text-xs">
                        {s.shipment_date ? new Date(s.shipment_date).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-500">
                        {s.eta_minutes ? `${s.eta_minutes} min` : (s.expected_delivery_date ? new Date(s.expected_delivery_date).toLocaleDateString() : "—")}
                      </td>
                      <td className="py-2 px-3">
                        <Badge className={`font-medium ${SHIP_TONE[s.status] || ""}`}>{s.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ShipmentModal
        sid={activeId}
        wid={wid}
        onClose={() => setActiveId(null)}
        onChange={refresh}
      />
    </div>
  );
}

function ShipmentModal({ sid, wid, onClose, onChange }) {
  const [ship, setShip] = useState(null);
  const [delayReason, setDelayReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sid) { setShip(null); return; }
    WholesalerApi.shipmentDetail(wid, sid).then(setShip);
  }, [sid, wid]);

  if (!sid) return null;
  if (!ship) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent><div className="p-4 text-sm text-slate-500">Loading…</div></DialogContent>
      </Dialog>
    );
  }

  const run = async (action, payload) => {
    setSaving(true);
    try {
      await WholesalerApi.shipmentAction(wid, sid, action, payload);
      toast.success(`Shipment ${action.replace("-", " ")}d`);
      const updated = await WholesalerApi.shipmentDetail(wid, sid);
      setShip(updated);
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed");
    } finally { setSaving(false); }
  };

  const stepIdx = SHIP_STAGES.indexOf(ship.status);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="shipment-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ship.shipment_number}
            <Badge className={SHIP_TONE[ship.status]}>{ship.status}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Related Order</div>
              <div className="font-medium text-slate-800">{ship.order_number}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Distributor</div>
              <div className="font-medium text-slate-800">{ship.distributor?.name}</div>
              <div className="text-xs text-slate-500">{ship.distributor?.city ? `${ship.distributor.city}, ` : ""}{ship.distributor?.region}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">ETA</div>
              <div className="font-medium">{ship.eta_minutes ? `${ship.eta_minutes} min` : (ship.expected_delivery_date ? new Date(ship.expected_delivery_date).toLocaleDateString() : "—")}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Total Units</div>
              <div className="font-medium">{fmtNumber(ship.total_units)}</div>
            </div>
          </div>

          {/* Progress strip */}
          {!["cancelled", "failed"].includes(ship.status) && (
            <div>
              <div className="flex items-center gap-1">
                {SHIP_STAGES.map((s, i) => (
                  <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-violet-500" : "bg-slate-100"}`} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-slate-400">
                {SHIP_STAGES.map((s) => <span key={s}>{s}</span>)}
              </div>
            </div>
          )}

          {ship.status === "delayed" && ship.delay_reason && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>Delay reason:</strong> {ship.delay_reason}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4 text-violet-600" /> Shipment Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="py-2 px-2 font-medium">Product</th>
                      <th className="py-2 px-2 font-medium">SKU</th>
                      <th className="py-2 px-2 font-medium">Batch</th>
                      <th className="py-2 px-2 font-medium text-right">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ship.items || []).map((it) => (
                      <tr key={it.product_id} className="border-b border-slate-100">
                        <td className="py-2 px-2 font-medium">{it.product_name}</td>
                        <td className="py-2 px-2 text-slate-500 text-xs">{it.sku || "—"}</td>
                        <td className="py-2 px-2 text-slate-500 text-xs">{it.batch_number || "—"}</td>
                        <td className="py-2 px-2 text-right">{fmtNumber(it.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {(ship.status_history || []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {ship.status_history.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-slate-600">
                    <Badge className={SHIP_TONE[ev.status] || "bg-slate-100 text-slate-700"}>{ev.status}</Badge>
                    <span className="text-slate-400">{new Date(ev.at).toLocaleString()}</span>
                    <span className="text-slate-500 truncate">— {ev.by}{ev.note ? `: ${ev.note}` : ""}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {ship.status === "created" && (
            <Button onClick={() => run("load", {})} disabled={saving} data-testid="ship-load-btn">Mark Loaded</Button>
          )}
          {ship.status === "loaded" && (
            <Button onClick={() => run("start-transit", {})} disabled={saving} data-testid="ship-transit-btn">Start Transit</Button>
          )}
          {(ship.status === "in_transit" || ship.status === "delayed") && (
            <Button onClick={() => run("deliver", {})} disabled={saving} data-testid="ship-deliver-btn">
              Mark Delivered
            </Button>
          )}
          {["loaded", "in_transit"].includes(ship.status) && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Delay reason"
                value={delayReason}
                onChange={(e) => setDelayReason(e.target.value)}
                className="w-44"
                data-testid="ship-delay-reason"
              />
              <Button
                variant="outline"
                onClick={() => run("delay", { reason: delayReason })}
                disabled={saving || !delayReason}
                className="border-amber-200 text-amber-700 hover:bg-amber-50"
                data-testid="ship-delay-btn"
              >
                <AlertTriangle className="h-4 w-4 mr-1" /> Flag Delay
              </Button>
            </div>
          )}
          {!["delivered", "cancelled", "failed"].includes(ship.status) && (
            <Button
              variant="outline"
              onClick={() => run("cancel", {})}
              disabled={saving}
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
              data-testid="ship-cancel-btn"
            >
              Cancel Shipment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
