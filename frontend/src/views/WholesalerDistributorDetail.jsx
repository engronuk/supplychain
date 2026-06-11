import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PageHeader, KpiCard, fmtCurrency, fmtNumber, EmptyState,
} from "./wholesaler/ui";
import {
  ChevronLeft, Activity, ClipboardList, Truck, Package, TrendingUp,
  CalendarDays, Phone, Mail, MapPin, Wallet, Plus,
} from "lucide-react";

const STATUS_TONE = {
  submitted: "bg-blue-100 text-blue-700",
  allocated: "bg-violet-100 text-violet-700",
  picking: "bg-amber-100 text-amber-700",
  packing: "bg-amber-100 text-amber-700",
  packed: "bg-amber-100 text-amber-700",
  shipped: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-700",
  backordered: "bg-orange-100 text-orange-700",
};

const SHIP_TONE = {
  created: "bg-slate-100 text-slate-700",
  loaded: "bg-blue-100 text-blue-700",
  in_transit: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  delayed: "bg-amber-100 text-amber-700",
  cancelled: "bg-slate-200 text-slate-700",
};

export default function WholesalerDistributorDetail() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const { distributorId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [orderLines, setOrderLines] = useState([{ product_id: "", quantity: 1 }]);
  const [orderPriority, setOrderPriority] = useState("normal");
  const [orderNote, setOrderNote] = useState("");
  const [orderDeliveryDate, setOrderDeliveryDate] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!wid || !distributorId) return;
    setLoading(true);
    WholesalerApi.distributorDetail(wid, distributorId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [wid, distributorId, reloadKey]);

  // Lazy-load wholesaler inventory the first time the modal opens
  useEffect(() => {
    if (!placingOrder || !wid || inventory.length > 0) return;
    WholesalerApi.inventory(wid)
      .then((res) => setInventory(res?.rows || []))
      .catch(() => setInventory([]));
  }, [placingOrder, wid, inventory.length]);

  const resetOrderForm = () => {
    setOrderLines([{ product_id: "", quantity: 1 }]);
    setOrderPriority("normal");
    setOrderNote("");
    setOrderDeliveryDate("");
  };

  const addLine = () =>
    setOrderLines((prev) => [...prev, { product_id: "", quantity: 1 }]);
  const removeLine = (idx) =>
    setOrderLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  const updateLine = (idx, key, value) =>
    setOrderLines((prev) =>
      prev.map((ln, i) => (i === idx ? { ...ln, [key]: value } : ln)),
    );

  const orderTotal = orderLines.reduce((sum, ln) => {
    const inv = inventory.find((r) => r.product_id === ln.product_id);
    const price = inv?.unit_price || 0;
    return sum + price * (parseInt(ln.quantity, 10) || 0);
  }, 0);

  const submitOrder = async () => {
    const items = orderLines
      .filter((ln) => ln.product_id && parseInt(ln.quantity, 10) > 0)
      .map((ln) => ({ product_id: ln.product_id, quantity: parseInt(ln.quantity, 10) }));
    if (items.length === 0) {
      toast.error("Add at least one product with quantity > 0");
      return;
    }
    setSubmitting(true);
    try {
      const res = await WholesalerApi.createOrder(wid, {
        distributor_id: distributorId,
        items,
        priority: orderPriority,
        requested_delivery_date: orderDeliveryDate || null,
        note: orderNote || null,
      });
      toast.success(`Order ${res?.order_number || ""} placed`);
      setPlacingOrder(false);
      resetOrderForm();
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="distributor-detail-loading">
        Loading distributor profile…
      </div>
    );
  }

  const k = data.kpis;
  const p = data.profile;

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="distributor-detail-page">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/network")}
        className="text-slate-600 -ml-2"
        data-testid="dist-detail-back"
      >
        <ChevronLeft className="h-4 w-4 mr-1" /> Back to Distributor Network
      </Button>

      <PageHeader
        title={p.name || "Distributor"}
        subtitle={`${p.code || "—"} · ${p.city ? `${p.city}, ` : ""}${p.region || "—"}`}
        action={
          <Button
            onClick={() => setPlacingOrder(true)}
            data-testid="dd-place-order-btn"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Place Order on Their Behalf
          </Button>
        }
      />

      {/* Profile + Contact */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Manager</div>
              <div className="font-medium">{p.manager_name || "—"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Region</div>
              <div className="font-medium">{p.region || "—"}</div>
            </div>
            <div className="flex items-start gap-2">
              <Mail className="h-3.5 w-3.5 text-slate-400 mt-0.5" />
              <span className="text-slate-700">{p.contact_email || "—"}</span>
            </div>
            <div className="flex items-start gap-2">
              <Phone className="h-3.5 w-3.5 text-slate-400 mt-0.5" />
              <span className="text-slate-700">{p.contact_phone || "—"}</span>
            </div>
            <div className="col-span-2 flex items-start gap-2">
              <MapPin className="h-3.5 w-3.5 text-slate-400 mt-0.5" />
              <span className="text-slate-700">{p.address || "—"}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-violet-600" /> Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Last order</span>
              <span className="font-medium">
                {k.last_order_at ? new Date(k.last_order_at).toLocaleDateString() : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status</span>
              {k.orders_30d > 0 ? (
                <Badge className="bg-emerald-100 text-emerald-700">Active</Badge>
              ) : k.orders_90d > 0 ? (
                <Badge className="bg-amber-100 text-amber-700">Slowing</Badge>
              ) : (
                <Badge className="bg-rose-100 text-rose-700">Dormant</Badge>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Inventory health</span>
              <span className="font-medium">{k.inventory_health_pct}% ({k.inventory_skus} SKUs)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard testid="dd-orders-90d" icon={ClipboardList} label="Orders (90d)" value={fmtNumber(k.orders_90d)} hint={`${k.orders_30d} in last 30d`} />
        <KpiCard testid="dd-revenue-90d" icon={Wallet} label="Revenue (90d)" value={fmtCurrency(k.revenue_90d)} tone="positive" />
        <KpiCard testid="dd-units-90d" icon={Package} label="Units (90d)" value={fmtNumber(k.units_90d)} />
        <KpiCard testid="dd-aov" icon={TrendingUp} label="Avg Order Value" value={fmtCurrency(k.average_order_value)} />
        <KpiCard testid="dd-fill-rate" icon={Activity} label="Fill Rate (90d)" value={`${k.fill_rate_pct}%`}
                 tone={k.fill_rate_pct >= 80 ? "positive" : k.fill_rate_pct >= 50 ? "warning" : "alert"} />
        <KpiCard testid="dd-delivery-time" icon={Truck} label="Avg Delivery Time"
                 value={k.avg_delivery_hours != null ? `${k.avg_delivery_hours}h` : "—"} />
        <KpiCard testid="dd-inv-health" icon={Activity} label="Their Inventory Health"
                 value={`${k.inventory_health_pct}%`}
                 tone={k.inventory_health_pct >= 80 ? "positive" : k.inventory_health_pct >= 60 ? "warning" : "alert"} />
        <KpiCard testid="dd-status-cnt" icon={Activity} label="Status Mix"
                 value={Object.keys(data.status_distribution || {}).length} hint="distinct statuses observed" />
      </div>

      {/* Order trend */}
      <Card data-testid="dd-trend-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-violet-600" /> 90-Day Order Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.trend_90d.length === 0 ? (
            <EmptyState title="No order activity in the last 90 days" />
          ) : (
            <MiniTrend rows={data.trend_90d} />
          )}
        </CardContent>
      </Card>

      {/* Top products + Status distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top Products Purchased (90d)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.top_products.length === 0 ? (
              <EmptyState title="No product history yet" />
            ) : (
              <table className="w-full text-sm" data-testid="dd-top-products">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 px-2 font-medium">Product</th>
                    <th className="py-2 px-2 font-medium text-right">Units</th>
                    <th className="py-2 px-2 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.map((tp) => (
                    <tr key={tp.product_id} className="border-b border-slate-100">
                      <td className="py-2 px-2">
                        <div className="font-medium text-slate-800">{tp.product_name}</div>
                        <div className="text-xs text-slate-500">{tp.sku || "—"}</div>
                      </td>
                      <td className="py-2 px-2 text-right">{fmtNumber(tp.units)}</td>
                      <td className="py-2 px-2 text-right">{fmtCurrency(tp.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.status_distribution).length === 0 ? (
              <EmptyState title="No orders yet" />
            ) : (
              Object.entries(data.status_distribution).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <Badge className={`font-medium ${STATUS_TONE[status] || "bg-slate-100"}`}>{status}</Badge>
                  <span className="font-medium text-slate-700">{fmtNumber(count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-violet-600" /> Order History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.orders.length === 0 ? (
            <EmptyState title="No orders from this distributor yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="dd-orders-table">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 px-3 font-medium">Order #</th>
                    <th className="py-2 px-3 font-medium">Date</th>
                    <th className="py-2 px-3 font-medium text-right">Lines</th>
                    <th className="py-2 px-3 font-medium text-right">Units</th>
                    <th className="py-2 px-3 font-medium text-right">Value</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-medium text-slate-800">{o.order_number}</td>
                      <td className="py-2 px-3 text-xs text-slate-500">
                        {o.created_at ? new Date(o.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">{(o.items || []).length}</td>
                      <td className="py-2 px-3 text-right">{fmtNumber(o.total_units)}</td>
                      <td className="py-2 px-3 text-right">{fmtCurrency(o.total_amount)}</td>
                      <td className="py-2 px-3">
                        <Badge className={`font-medium ${STATUS_TONE[o.status] || ""}`}>{o.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shipment history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Truck className="h-4 w-4 text-violet-600" /> Shipment History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.shipments.length === 0 ? (
            <EmptyState title="No shipments yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="dd-shipments-table">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 px-3 font-medium">Shipment #</th>
                    <th className="py-2 px-3 font-medium">Order</th>
                    <th className="py-2 px-3 font-medium">Date</th>
                    <th className="py-2 px-3 font-medium text-right">Units</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shipments.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-medium text-slate-800">{s.shipment_number}</td>
                      <td className="py-2 px-3 text-slate-600">{s.order_number}</td>
                      <td className="py-2 px-3 text-xs text-slate-500">
                        {s.shipment_date ? new Date(s.shipment_date).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 px-3 text-right">{fmtNumber(s.total_units)}</td>
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
      {/* Place Order Modal */}
      <Dialog
        open={placingOrder}
        onOpenChange={(open) => {
          setPlacingOrder(open);
          if (!open) resetOrderForm();
        }}
      >
        <DialogContent className="max-w-2xl" data-testid="dd-place-order-dialog">
          <DialogHeader>
            <DialogTitle>Place Order for {p.name || "Distributor"}</DialogTitle>
            <DialogDescription>
              Draft a replenishment order on behalf of this distributor. Stock is pulled from your hub inventory; the distributor will see this in their procurement inbox once submitted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Priority</Label>
                <Select value={orderPriority} onValueChange={setOrderPriority}>
                  <SelectTrigger data-testid="dd-po-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Requested Delivery Date</Label>
                <Input
                  type="date"
                  value={orderDeliveryDate}
                  onChange={(e) => setOrderDeliveryDate(e.target.value)}
                  data-testid="dd-po-delivery-date"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Order Lines</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addLine}
                  data-testid="dd-po-add-line"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add line
                </Button>
              </div>
              {orderLines.map((ln, idx) => {
                const inv = inventory.find((r) => r.product_id === ln.product_id);
                const available = inv?.available ?? 0;
                const overStock = inv && parseInt(ln.quantity, 10) > available;
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-2 items-end border border-slate-200 rounded-md p-2"
                    data-testid={`dd-po-line-${idx}`}
                  >
                    <div className="col-span-7">
                      <Label className="text-[10px] uppercase text-slate-500">Product</Label>
                      <Select
                        value={ln.product_id}
                        onValueChange={(v) => updateLine(idx, "product_id", v)}
                      >
                        <SelectTrigger data-testid={`dd-po-product-${idx}`}>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {inventory.map((r) => (
                            <SelectItem key={r.product_id} value={r.product_id}>
                              {r.product_name} — {fmtNumber(r.available)} avail · {fmtCurrency(r.unit_price)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-[10px] uppercase text-slate-500">Quantity</Label>
                      <Input
                        type="number"
                        min={1}
                        value={ln.quantity}
                        onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                        data-testid={`dd-po-qty-${idx}`}
                        className={overStock ? "border-amber-400" : ""}
                      />
                      {overStock && (
                        <div className="text-[10px] text-amber-600 mt-0.5">
                          Exceeds available ({available})
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLine(idx)}
                        disabled={orderLines.length === 1}
                        data-testid={`dd-po-remove-${idx}`}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <Label className="text-xs">Note</Label>
              <Textarea
                rows={2}
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                placeholder="Optional context (sales call, promo, etc.)"
                data-testid="dd-po-note"
              />
            </div>

            <div className="flex items-center justify-between text-sm border-t pt-3">
              <span className="text-slate-500">Estimated total</span>
              <span className="font-semibold text-slate-800" data-testid="dd-po-total">
                {fmtCurrency(orderTotal)}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPlacingOrder(false);
                resetOrderForm();
              }}
              disabled={submitting}
              data-testid="dd-po-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={submitOrder}
              disabled={submitting}
              data-testid="dd-po-submit"
            >
              {submitting ? "Placing…" : "Place Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function MiniTrend({ rows }) {
  const max = Math.max(...rows.map((r) => r.orders), 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {rows.map((r) => (
          <div key={r.date} className="flex-1 flex flex-col items-center justify-end" title={`${r.date}: ${r.orders} orders`}>
            <div
              className="w-full bg-violet-500 rounded-t hover:bg-violet-600 transition-colors"
              style={{ height: `${(r.orders / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-2">
        <span>{rows[0]?.date}</span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  );
}
