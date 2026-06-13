import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PageHeader, KpiCard, fmtCurrency, fmtNumber, EmptyState, ToneCard,
} from "./wholesaler/ui";
import {
  RefreshCw, ClipboardList, CheckCircle2, AlertTriangle, ShieldX, Wrench,
  TimerReset, Package, ChevronRight,
} from "lucide-react";

const FUNNEL_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "approved", label: "Approved" },
  { key: "allocated", label: "Allocated" },
  { key: "picking", label: "Picking" },
  { key: "packing", label: "Packing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

const STATUS_TONE = {
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-violet-100 text-violet-700",
  allocated: "bg-violet-100 text-violet-700",
  picking: "bg-amber-100 text-amber-700",
  picked: "bg-amber-100 text-amber-700",
  packing: "bg-amber-100 text-amber-700",
  packed: "bg-amber-100 text-amber-700",
  ready_for_dispatch: "bg-amber-100 text-amber-700",
  shipped: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  cancelled: "bg-slate-200 text-slate-700",
  backordered: "bg-orange-100 text-orange-700",
};

const PRIORITY_TONE = {
  normal: "bg-slate-100 text-slate-700",
  high:   "bg-amber-100 text-amber-700",
  urgent: "bg-rose-100 text-rose-700",
};

export default function WholesalerOrders({ embedded = false }) {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState(null);

  const refresh = () => {
    if (!wid) return;
    setLoading(true);
    Promise.all([
      WholesalerApi.ordersDashboard(wid),
      WholesalerApi.customerOrders(wid),
    ])
      .then(([d, l]) => { setDashboard(d); setOrders(l); })
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [wid]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      const hay = `${o.order_number || ""} ${o.customer?.name || o.distributor?.name || ""}`.toLowerCase();
      if (search && !hay.includes(search.toLowerCase())) return false;
      return true;
    });
  }, [orders, statusFilter, search]);

  if (loading || !dashboard) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="wholesaler-orders-loading">
        Loading orders…
      </div>
    );
  }
  const k = dashboard.kpis;

  return (
    <div className={embedded ? "space-y-6" : "p-6 md:p-8 space-y-6"} data-testid="wholesaler-orders">
      {!embedded && (
        <PageHeader
          title="Customer Orders"
          subtitle="Incoming orders from retailers (primary) and distributors (legacy / key-account)."
          action={
            <Button variant="outline" size="sm" onClick={refresh} data-testid="orders-refresh">
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
          }
        />
      )}
      {embedded && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={refresh} data-testid="orders-refresh">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3" data-testid="orders-kpi-strip">
        <KpiCard testid="orders-kpi-new" label="New (today)" value={fmtNumber(k.new_orders)} icon={ClipboardList} />
        <KpiCard testid="orders-kpi-pending" label="Pending Approval" value={fmtNumber(k.pending_approval)} tone={k.pending_approval > 0 ? "warning" : "default"} icon={TimerReset} />
        <KpiCard testid="orders-kpi-approved" label="Approved" value={fmtNumber(k.approved)} icon={CheckCircle2} />
        <KpiCard testid="orders-kpi-fulfillment" label="In Fulfillment" value={fmtNumber(k.in_fulfillment)} icon={Wrench} />
        <KpiCard testid="orders-kpi-shipped" label="Shipped" value={fmtNumber(k.shipped)} icon={Package} />
        <KpiCard testid="orders-kpi-delivered" label="Delivered" value={fmtNumber(k.delivered)} tone="positive" icon={CheckCircle2} />
        <KpiCard testid="orders-kpi-backordered" label="Backordered" value={fmtNumber(k.backordered)} tone={k.backordered > 0 ? "alert" : "default"} icon={AlertTriangle} />
      </div>

      {/* Funnel */}
      <Card data-testid="orders-funnel">
        <CardHeader>
          <CardTitle className="text-base">Order Status Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-stretch gap-2 overflow-x-auto">
            {FUNNEL_STEPS.map((step, idx) => (
              <div
                key={step.key}
                className="flex-1 min-w-[100px] rounded-lg border border-slate-200 p-3 bg-slate-50"
                data-testid={`funnel-${step.key}`}
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{step.label}</div>
                <div className="text-xl font-semibold mt-1 text-slate-900">
                  {fmtNumber(dashboard.funnel[step.key] || 0)}
                </div>
                {idx < FUNNEL_STEPS.length - 1 && (
                  <ChevronRight className="hidden lg:block absolute h-4 w-4 text-slate-300" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Order queue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Order Queue ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search order / customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
              data-testid="orders-search"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="orders-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="allocated">Allocated</SelectItem>
                <SelectItem value="picking">Picking</SelectItem>
                <SelectItem value="packed">Packed</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="backordered">Backordered</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="No orders match your filters" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="orders-table">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 px-3 font-medium">Order #</th>
                    <th className="py-2 px-3 font-medium">Customer</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Region</th>
                    <th className="py-2 px-3 font-medium text-right">Lines</th>
                    <th className="py-2 px-3 font-medium text-right">Units</th>
                    <th className="py-2 px-3 font-medium text-right">Value</th>
                    <th className="py-2 px-3 font-medium">Requested</th>
                    <th className="py-2 px-3 font-medium">Priority</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const customer = o.customer || o.distributor || {};
                    const ctype = o.customer_type || customer.type || "distributor";
                    return (
                      <tr
                        key={o.id}
                        onClick={() => o.source !== "purchase_orders" && setActiveId(o.id)}
                        className={`border-b border-slate-100 hover:bg-slate-50 ${o.source === "purchase_orders" ? "cursor-default" : "cursor-pointer"}`}
                        data-testid={`order-row-${o.order_number}`}
                      >
                        <td className="py-2 px-3 font-medium text-slate-800">{o.order_number}</td>
                        <td className="py-2 px-3 text-slate-700">{customer.name || "—"}</td>
                        <td className="py-2 px-3">
                          <Badge
                            className={`font-medium ${
                              ctype === "retailer" ? "bg-violet-100 text-violet-700"
                              : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {ctype}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-slate-500">{customer.region || "—"}</td>
                        <td className="py-2 px-3 text-right">{o.items?.length || 0}</td>
                        <td className="py-2 px-3 text-right">{fmtNumber(o.total_units)}</td>
                        <td className="py-2 px-3 text-right">{fmtCurrency(o.total_amount)}</td>
                        <td className="py-2 px-3 text-slate-500 text-xs">
                          {o.requested_delivery_date ? new Date(o.requested_delivery_date).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-2 px-3">
                          <Badge className={`font-medium ${PRIORITY_TONE[o.priority] || PRIORITY_TONE.normal}`}>
                            {o.priority}
                          </Badge>
                        </td>
                        <td className="py-2 px-3">
                          <Badge className={`font-medium ${STATUS_TONE[o.status] || ""}`}>{o.status}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <OrderDetailModal
        orderId={activeId}
        wid={wid}
        onClose={() => setActiveId(null)}
        onChange={refresh}
      />
    </div>
  );
}

function OrderDetailModal({ orderId, wid, onClose, onChange }) {
  const [order, setOrder] = useState(null);
  const [modify, setModify] = useState(null);   // { items: [{product_id, approved_quantity}], backorder_remainder }
  const [rejectReason, setRejectReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId) { setOrder(null); return; }
    WholesalerApi.orderDetail(wid, orderId).then(setOrder);
  }, [orderId, wid]);

  if (!orderId || !order) {
    if (!orderId) return null;
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="sr-only">Loading order detail</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-sm text-slate-500">Loading…</div>
        </DialogContent>
      </Dialog>
    );
  }

  const canApprove = order.status === "submitted";
  const canReject = order.status === "submitted";
  const canCancel = !["shipped", "delivered", "cancelled", "rejected"].includes(order.status);

  const doApprove = async () => {
    setSaving(true);
    try {
      await WholesalerApi.approveOrder(wid, orderId);
      toast.success("Order approved & inventory reserved");
      onChange(); onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Approve failed"); }
    finally { setSaving(false); }
  };
  const doReject = async () => {
    if (!rejectReason || rejectReason.length < 2) {
      toast.error("Provide a reject reason"); return;
    }
    setSaving(true);
    try {
      await WholesalerApi.rejectOrder(wid, orderId, rejectReason);
      toast.success("Order rejected");
      onChange(); onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Reject failed"); }
    finally { setSaving(false); }
  };
  const doCancel = async () => {
    setSaving(true);
    try {
      await WholesalerApi.cancelOrder(wid, orderId);
      toast.success("Order cancelled");
      onChange(); onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Cancel failed"); }
    finally { setSaving(false); }
  };
  const doModify = async () => {
    setSaving(true);
    try {
      await WholesalerApi.modifyOrder(wid, orderId, modify);
      toast.success("Order modified for partial fulfilment");
      onChange(); onClose();
    } catch (e) { toast.error(e?.response?.data?.detail || "Modify failed"); }
    finally { setSaving(false); }
  };

  const recTone = {
    approve_full: "positive",
    partial: "warning",
    reject_or_backorder: "alert",
    no_items: "neutral",
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="order-detail-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {order.order_number}
            <Badge className={STATUS_TONE[order.status]}>{order.status}</Badge>
            <Badge className={PRIORITY_TONE[order.priority]}>{order.priority}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Customer + summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                {(order.customer_type || order.customer?.type) === "retailer" ? "Retailer" : "Distributor"}
              </div>
              <div className="font-medium text-slate-800">{(order.customer || order.distributor)?.name}</div>
              <div className="text-xs text-slate-500">
                {(order.customer || order.distributor)?.region}
                {(order.customer || order.distributor)?.city ? ` · ${(order.customer || order.distributor).city}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-500">Requested Delivery</div>
              <div className="font-medium">{order.requested_delivery_date ? new Date(order.requested_delivery_date).toLocaleDateString() : "—"}</div>
              <div className="text-xs text-slate-500 mt-1">{fmtCurrency(order.total_amount)} · {fmtNumber(order.total_units)} units</div>
            </div>
          </div>

          {/* Recommendation */}
          <ToneCard
            tone={recTone[order.recommendation?.verdict] || "neutral"}
            title={`Fulfilment Recommendation — ${order.recommendation?.verdict || "—"}`}
            body={order.recommendation?.message}
          />

          {/* Availability table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Inventory Availability</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="order-availability">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                      <th className="py-2 px-2 font-medium">Product</th>
                      <th className="py-2 px-2 font-medium text-right">Requested</th>
                      <th className="py-2 px-2 font-medium text-right">Available</th>
                      <th className="py-2 px-2 font-medium text-right">Reserved</th>
                      <th className="py-2 px-2 font-medium text-right">On Hand</th>
                      <th className="py-2 px-2 font-medium">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.availability.map((a) => (
                      <tr key={a.product_id} className="border-b border-slate-100">
                        <td className="py-2 px-2 font-medium text-slate-800">{a.product_name}</td>
                        <td className="py-2 px-2 text-right">{fmtNumber(a.requested)}</td>
                        <td className="py-2 px-2 text-right">{fmtNumber(a.available)}</td>
                        <td className="py-2 px-2 text-right text-slate-500">{fmtNumber(a.reserved)}</td>
                        <td className="py-2 px-2 text-right text-slate-500">{fmtNumber(a.on_hand)}</td>
                        <td className="py-2 px-2">
                          <Badge className={
                            a.signal === "full" ? "bg-emerald-100 text-emerald-700"
                            : a.signal === "partial" ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                          }>{a.signal}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Risks */}
          {(order.recommendation?.risks || []).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {order.recommendation.risks.map((r) => (
                <ToneCard key={r.type} tone="warning" title={r.title} body={r.body} />
              ))}
            </div>
          )}

          {/* Linked fulfillment + shipment */}
          {order.fulfillment && (
            <ToneCard
              tone="neutral"
              title={`Fulfillment ${order.fulfillment.fulfillment_number} · ${order.fulfillment.status}`}
              body={`Created ${new Date(order.fulfillment.created_at).toLocaleString()}`}
            />
          )}
          {order.shipment && (
            <ToneCard
              tone="neutral"
              title={`Shipment ${order.shipment.shipment_number} · ${order.shipment.status}`}
              body={`ETA ${order.shipment.eta_minutes || 0} min · expected ${order.shipment.expected_delivery_date ? new Date(order.shipment.expected_delivery_date).toLocaleDateString() : "—"}`}
            />
          )}

          {/* Modify section */}
          {modify && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Modify Approved Quantities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {order.items.map((it, idx) => {
                  const mline = modify.items[idx];
                  return (
                    <div key={it.product_id} className="flex items-center gap-2">
                      <div className="flex-1 text-sm">{it.product_name} · req {fmtNumber(it.quantity)}</div>
                      <Input
                        type="number"
                        min={0}
                        max={it.quantity}
                        value={mline.approved_quantity}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(it.quantity, Number(e.target.value) || 0));
                          setModify((m) => {
                            const items = [...m.items];
                            items[idx] = { ...items[idx], approved_quantity: v };
                            return { ...m, items };
                          });
                        }}
                        className="w-28"
                        data-testid={`modify-qty-${it.product_id}`}
                      />
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    id="backorder-cb"
                    checked={modify.backorder_remainder}
                    onChange={(e) => setModify((m) => ({ ...m, backorder_remainder: e.target.checked }))}
                    data-testid="modify-backorder-cb"
                  />
                  <label htmlFor="backorder-cb" className="text-slate-700">Backorder the remainder</label>
                </div>
                <Textarea
                  placeholder="Notes (visible to distributor)"
                  value={modify.note || ""}
                  onChange={(e) => setModify((m) => ({ ...m, note: e.target.value }))}
                />
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          {(order.status_history || []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {order.status_history.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-slate-600">
                    <Badge className={STATUS_TONE[ev.status]}>{ev.status}</Badge>
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
          {canCancel && (
            <Button variant="outline" onClick={doCancel} disabled={saving}
                    className="border-slate-200 text-slate-700"
                    data-testid="order-cancel-btn">
              Cancel Order
            </Button>
          )}
          {canReject && (
            <div className="flex items-center gap-2">
              <Input placeholder="Reject reason" value={rejectReason}
                     onChange={(e) => setRejectReason(e.target.value)}
                     className="w-44" data-testid="order-reject-reason" />
              <Button variant="outline" onClick={doReject} disabled={saving}
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      data-testid="order-reject-btn">
                <ShieldX className="h-4 w-4 mr-1" /> Reject
              </Button>
            </div>
          )}
          {canApprove && !modify && (
            <>
              <Button variant="outline" onClick={() => setModify({
                items: order.items.map((it) => ({ product_id: it.product_id, approved_quantity: it.quantity })),
                backorder_remainder: false,
                note: "",
              })} data-testid="order-modify-toggle">
                <Wrench className="h-4 w-4 mr-1" /> Modify / Partial
              </Button>
              <Button onClick={doApprove} disabled={saving} data-testid="order-approve-btn">
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
            </>
          )}
          {canApprove && modify && (
            <>
              <Button variant="outline" onClick={() => setModify(null)}>Discard</Button>
              <Button onClick={doModify} disabled={saving} data-testid="order-modify-submit">
                Save Modification
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
