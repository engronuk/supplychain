/**
 * Distributor Procurement Inbox.
 *
 * Replaces the legacy "Stock Requests" view for distributors. Two tabs:
 *   - Purchase Orders (incoming POs from retailers, full lifecycle actions)
 *   - Quote Requests  (RFQs they were invited on; respond with price/MOQ/lead time)
 */
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FileText, MessageSquareQuote, ChevronRight, Loader2, Award,
  Inbox, ShieldCheck, Send, ShoppingCart, Package, Plus, Minus, X,
  Sparkles, ArrowRight, Search, Factory, Truck, PackageCheck,
  AlertTriangle, Ban, Clock,
} from "lucide-react";
import { toast } from "sonner";
import POStatusBadge from "@/components/procurement/POStatusBadge";
import PODetailDrawer from "@/components/procurement/PODetailDrawer";
import { ShipmentTrackerLegacy } from "@/views/ShipmentTracker";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function DistributorProcurementInbox() {
  const { session } = useSession();
  const distributorId = session?.entity?.id;
  const [tab, setTab] = useState("place");

  if (!distributorId) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="distributor-procurement-inbox">
      <div className="px-8 py-7 max-w-[1600px] mx-auto">
        <div className="flex items-start justify-between gap-6 mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-violet-700 font-semibold mb-1">
              <Inbox className="h-3 w-3" /> Procurement
            </div>
            <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Procurement Workspace</h1>
            <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
              Place new orders with your manufacturer, track every PO end-to-end, and process retailer demand & RFQs.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 h-auto gap-1 flex-wrap">
            <TabsTrigger value="place" data-testid="inbox-tab-place"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <ShoppingCart className="h-4 w-4" /> Place Order
            </TabsTrigger>
            <TabsTrigger value="my-orders" data-testid="inbox-tab-my-orders"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <Package className="h-4 w-4" /> My Purchase Orders
            </TabsTrigger>
            <TabsTrigger value="orders" data-testid="inbox-tab-orders"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <FileText className="h-4 w-4" /> Retailer Orders
            </TabsTrigger>
            <TabsTrigger value="quotes" data-testid="inbox-tab-quotes"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <MessageSquareQuote className="h-4 w-4" /> Quote Requests
            </TabsTrigger>
            <TabsTrigger value="shipments" data-testid="inbox-tab-shipments"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <Truck className="h-4 w-4" /> Shipments
            </TabsTrigger>
          </TabsList>

          <TabsContent value="place" className="mt-5">
            <PlaceOrderTab distributorId={distributorId} manufacturerId={session?.user?.manufacturer_id} />
          </TabsContent>
          <TabsContent value="my-orders" className="mt-5">
            <MyOrdersTab distributorId={distributorId} />
          </TabsContent>
          <TabsContent value="orders" className="mt-5">
            <DistributorPOInbox distributorId={distributorId} />
          </TabsContent>
          <TabsContent value="quotes" className="mt-5">
            <DistributorQuoteInbox distributorId={distributorId} />
          </TabsContent>
          <TabsContent value="shipments" className="mt-5">
            {/* Inbound + outbound shipment ledger (legacy Shipments view, now merged here). */}
            <ShipmentTrackerLegacy />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ------------ Purchase Orders inbox (distributor side) ------------ */
function DistributorPOInbox({ distributorId }) {
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [drawer, setDrawer] = useState({ open: false, id: null });

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.purchaseOrders({ distributor_id: distributorId })
      .then((r) => { if (!cancelled) { setOrders(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [distributorId, reloadKey]);

  const counts = useMemo(() => {
    const c = {};
    for (const o of (orders || [])) c[o.status] = (c[o.status] || 0) + 1;
    c.all = (orders || []).length;
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    if (!orders) return [];
    if (statusFilter === "all") return orders;
    return orders.filter((o) => o.status === statusFilter);
  }, [orders, statusFilter]);

  if (loading) return <Loading />;

  const tabs = [
    { key: "submitted",  label: "Pending Approval" },
    { key: "approved",   label: "Approved" },
    { key: "processing", label: "Processing" },
    { key: "shipped",    label: "Shipped" },
    { key: "delivered",  label: "Delivered" },
    { key: "cancelled",  label: "Cancelled" },
    { key: "rejected",   label: "Rejected" },
    { key: "all",        label: "All" },
  ];

  return (
    <div className="space-y-4" data-testid="distributor-po-inbox">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatusFilter(t.key)}
            data-testid={`inbox-po-filter-${t.key}`}
            className={`inline-flex items-center gap-2 h-8 rounded-full px-3 text-[12px] font-semibold transition-colors ${
              statusFilter === t.key
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t.label}
            <span className={`tabular-nums text-[10px] rounded-full px-1.5 ${statusFilter === t.key ? "bg-white/20" : "bg-white"}`}>
              {counts[t.key] || 0}
            </span>
          </button>
        ))}
      </div>

      <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <CardContent className="p-12 text-center text-slate-400">
            <Inbox className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            No POs in this state.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-5 py-3 font-semibold">PO #</th>
                  <th className="text-left px-5 py-3 font-semibold">Retailer</th>
                  <th className="text-left px-5 py-3 font-semibold">Date</th>
                  <th className="text-right px-5 py-3 font-semibold">Items</th>
                  <th className="text-right px-5 py-3 font-semibold">Amount</th>
                  <th className="text-left px-5 py-3 font-semibold">Status</th>
                  <th className="px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((po) => (
                  <tr key={po.id}
                      onClick={() => setDrawer({ open: true, id: po.id })}
                      className="hover:bg-violet-50/40 cursor-pointer"
                      data-testid={`inbox-po-row-${po.po_number}`}>
                    <td className="px-5 py-3 font-mono text-slate-900 font-semibold">{po.po_number}</td>
                    <td className="px-5 py-3 text-slate-700">{po.retailer?.name || "—"}</td>
                    <td className="px-5 py-3 text-slate-500 tabular-nums">{fmtDate(po.created_at)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{po.items?.length || 0}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">{fmtMoney(po.total_amount)}</td>
                    <td className="px-5 py-3"><POStatusBadge status={po.status} /></td>
                    <td className="px-2 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PODetailDrawer
        poId={drawer.id}
        open={drawer.open}
        onOpenChange={(o) => setDrawer({ ...drawer, open: o })}
        role="distributor"
        onMutated={reload}
      />
    </div>
  );
}

/* ------------ Quote Inbox (distributor side) ------------ */
function DistributorQuoteInbox({ distributorId }) {
  const [quotes, setQuotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [respondQuote, setRespondQuote] = useState(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.quotes({ distributor_id: distributorId })
      .then((r) => { if (!cancelled) { setQuotes(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [distributorId, reloadKey]);

  if (loading) return <Loading />;

  const open = (quotes || []).filter((q) => q.status !== "closed");
  return (
    <div className="space-y-4" data-testid="distributor-quote-inbox">
      <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden">
        {open.length === 0 ? (
          <CardContent className="p-12 text-center text-slate-400">
            <MessageSquareQuote className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            No quote requests in your inbox.
          </CardContent>
        ) : (
          <div className="divide-y divide-slate-100">
            {open.map((q) => {
              const myResponse = (q.responses || []).find((r) => r.distributor_id === distributorId);
              return (
                <div key={q.id} className="px-5 py-4" data-testid={`inbox-quote-${q.quote_number}`}>
                  <div className="flex items-start gap-4">
                    <div className="h-10 w-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                      <MessageSquareQuote className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-semibold text-slate-900">{q.quote_number}</div>
                      <div className="text-sm font-medium text-slate-900 mt-0.5">{q.product?.name || "—"}</div>
                      <div className="text-[12px] text-slate-500">
                        {q.quantity} units · From <span className="font-medium text-slate-700">{q.retailer?.name || "—"}</span> · {fmtDate(q.created_at)}
                      </div>
                      {myResponse && (
                        <div className="inline-flex items-center gap-2 mt-2 text-[12px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 h-6">
                          <Award className="h-3 w-3" /> Your quote: {fmtMoney(myResponse.unit_price)}/unit · Lead {myResponse.lead_time_days}d
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={() => setRespondQuote(q)}
                      className="bg-violet-700 hover:bg-violet-800 text-white shrink-0"
                      data-testid={`inbox-respond-${q.id}`}
                    >
                      <Send className="h-4 w-4 mr-1.5" />
                      {myResponse ? "Update quote" : "Send quote"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <RespondQuoteDialog
        quote={respondQuote}
        distributorId={distributorId}
        onClose={() => setRespondQuote(null)}
        onSaved={() => { setRespondQuote(null); reload(); }}
      />
    </div>
  );
}

function RespondQuoteDialog({ quote, distributorId, onClose, onSaved }) {
  if (!quote) return null;
  return (
    <RespondQuoteDialogInner
      key={quote.id}
      quote={quote}
      distributorId={distributorId}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function RespondQuoteDialogInner({ quote, distributorId, onClose, onSaved }) {
  // Initial state derived from the quote prop once on mount; re-mounts when
  // parent passes a different quote (via the wrapper's key prop).
  const mine = (quote.responses || []).find((r) => r.distributor_id === distributorId);
  const [unitPrice, setUnitPrice] = useState(() => mine?.unit_price ?? 0);
  const [leadTime, setLeadTime] = useState(() => mine?.lead_time_days ?? 3);
  const [moq, setMoq] = useState(() => mine?.moq ?? 50);
  const [validUntil, setValidUntil] = useState(() =>
    mine?.valid_until?.slice(0, 10) ||
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState(() => mine?.notes || "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (unitPrice <= 0 || !validUntil) {
      toast.error("Enter a unit price and validity date");
      return;
    }
    setSaving(true);
    try {
      await Api.respondQuote(quote.id, {
        distributor_id: distributorId,
        unit_price: Number(unitPrice),
        lead_time_days: Number(leadTime),
        moq: Number(moq),
        valid_until: validUntil,
        notes: notes || null,
      });
      toast.success("Quote submitted");
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not submit quote");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!quote} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Respond to {quote.quote_number}</DialogTitle>
          <DialogDescription>
            {quote.product?.name} · {quote.quantity} units · Retailer: {quote.retailer?.name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Unit Price (₦)</Label>
              <Input type="number" min="0" step="0.01" value={unitPrice}
                     onChange={(e) => setUnitPrice(Number(e.target.value))}
                     className="mt-1 tabular-nums" data-testid="resp-unit-price" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Lead time (days)</Label>
              <Input type="number" min="0" value={leadTime}
                     onChange={(e) => setLeadTime(Number(e.target.value))}
                     className="mt-1 tabular-nums" data-testid="resp-lead-time" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">MOQ</Label>
              <Input type="number" min="1" value={moq}
                     onChange={(e) => setMoq(Number(e.target.value))}
                     className="mt-1 tabular-nums" data-testid="resp-moq" />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Valid until</Label>
              <Input type="date" value={validUntil}
                     onChange={(e) => setValidUntil(e.target.value)}
                     className="mt-1" data-testid="resp-valid-until" />
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)}
                   className="mt-1" placeholder="Bulk discount, delivery, etc."
                   data-testid="resp-notes" />
          </div>
          <div className="rounded-lg bg-violet-50 border border-violet-100 p-3 text-sm">
            <span className="text-violet-700 font-semibold">Total at this price:</span>{" "}
            <span className="text-violet-900 font-bold tabular-nums">₦{(quote.quantity * unitPrice).toLocaleString()}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}
                  className="bg-violet-700 hover:bg-violet-800 text-white"
                  data-testid="confirm-quote-response">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />}
            Submit quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Loading() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-10 flex items-center justify-center text-slate-400 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading…
    </div>
  );
}


/* ===========================================================================
 * Place Order — distributor browses manufacturer's catalogue and submits a PO
 * that lands in the Manufacturer's Allocation Center (status="pending" →
 * "New Orders" bucket).
 * ===========================================================================
 */
function PlaceOrderTab({ distributorId, manufacturerId }) {
  const [products, setProducts] = useState(null);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState({});           // pid → qty
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Api.products()
      .then((rows) => setProducts(rows.filter((p) => !manufacturerId || p.manufacturer_id === manufacturerId)))
      .catch(() => setProducts([]));
  }, [manufacturerId]);

  const filtered = useMemo(() => {
    if (!products) return [];
    const ql = q.trim().toLowerCase();
    if (!ql) return products;
    return products.filter((p) => `${p.name} ${p.sku || ""}`.toLowerCase().includes(ql));
  }, [products, q]);

  const cartLines = useMemo(() => {
    if (!products) return [];
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([pid, qty]) => {
        const p = products.find((x) => x.id === pid) || {};
        return { ...p, quantity: qty, line_total: (p.unit_price || 0) * qty };
      });
  }, [cart, products]);

  const totalUnits = cartLines.reduce((s, l) => s + l.quantity, 0);
  const totalValue = cartLines.reduce((s, l) => s + l.line_total, 0);

  const bump = (pid, by) => setCart((prev) => {
    const next = { ...prev, [pid]: Math.max(0, (prev[pid] || 0) + by) };
    if (next[pid] === 0) delete next[pid];
    return next;
  });
  const setQty = (pid, value) => setCart((prev) => {
    const n = parseInt(value, 10) || 0;
    const next = { ...prev, [pid]: Math.max(0, n) };
    if (next[pid] === 0) delete next[pid];
    return next;
  });

  const submit = async () => {
    if (cartLines.length === 0) return toast.error("Add at least one product to your order.");
    if (!manufacturerId) return toast.error("Your distributor account is not linked to a manufacturer.");
    setSubmitting(true);
    try {
      const r = await Api.distributorCreateOrder(distributorId, {
        manufacturer_id: manufacturerId,
        items: cartLines.map((l) => ({ product_id: l.id, quantity: l.quantity })),
        note: note || null,
      });
      toast.success(`Order ${r.id?.slice(0, 8).toUpperCase()} submitted to manufacturer`);
      setCart({});
      setNote("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to submit order");
    } finally { setSubmitting(false); }
  };

  if (!products) return <Loading />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-5" data-testid="place-order-tab">
      {/* Product catalogue */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2">
            <Factory className="h-4 w-4 text-violet-600" />
            <div className="font-semibold text-slate-900 text-sm">Manufacturer Catalogue</div>
          </div>
          <span className="text-xs text-slate-500">{filtered.length} products</span>
          <div className="flex-1" />
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or SKU"
              className="w-72 rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              data-testid="catalogue-search" />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">No products match your search.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-100 sticky top-0">
                <tr>
                  <th className="text-left py-3 px-5 font-medium">Product</th>
                  <th className="text-left py-3 font-medium">SKU</th>
                  <th className="text-right py-3 font-medium">Unit Price</th>
                  <th className="text-right py-3 px-5 font-medium">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const inCart = cart[p.id] || 0;
                  return (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{p.category || "—"}</div>
                      </td>
                      <td className="py-3 text-slate-600 font-mono text-xs">{p.sku}</td>
                      <td className="py-3 text-right text-slate-700 font-medium">{fmtMoney(p.unit_price)}</td>
                      <td className="py-3 px-5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => bump(p.id, -10)}
                            className="h-7 w-7 grid place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">
                            <Minus className="h-3 w-3" />
                          </button>
                          <input type="number" min="0" value={inCart || ""} onChange={(e) => setQty(p.id, e.target.value)}
                            placeholder="0" className="w-20 text-center rounded-md border border-slate-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                            data-testid={`qty-${p.sku}`} />
                          <button onClick={() => bump(p.id, 10)}
                            className="h-7 w-7 grid place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50">
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cart */}
      <aside className="rounded-2xl bg-white border border-slate-200 shadow-sm h-fit lg:sticky lg:top-6">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="inline-flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-violet-600" />
            <div className="font-semibold text-slate-900 text-sm">Order Summary</div>
          </div>
          {cartLines.length > 0 && (
            <button onClick={() => setCart({})} className="text-xs text-rose-600 hover:text-rose-700">Clear</button>
          )}
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[40vh] overflow-y-auto">
          {cartLines.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-8">
              <Package className="h-8 w-8 mx-auto text-slate-300 mb-2" />
              No items yet. Adjust quantities from the catalogue.
            </div>
          ) : cartLines.map((l) => (
            <div key={l.id} className="flex items-start gap-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 truncate">{l.name}</div>
                <div className="text-xs text-slate-500">{l.quantity.toLocaleString()} × {fmtMoney(l.unit_price)}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-slate-900">{fmtMoney(l.line_total)}</div>
                <button onClick={() => setQty(l.id, 0)} className="text-[10px] text-rose-500 hover:text-rose-700 mt-0.5 inline-flex items-center gap-0.5">
                  <X className="h-2.5 w-2.5" /> remove
                </button>
              </div>
            </div>
          ))}
        </div>
        {cartLines.length > 0 && (
          <>
            <div className="px-5 py-3 border-t border-slate-100 space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-slate-500">Total Units</span><span className="font-semibold text-slate-900">{totalUnits.toLocaleString()}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Order Value</span><span className="font-bold text-violet-700">{fmtMoney(totalValue)}</span></div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100">
              <Label htmlFor="po-note" className="text-xs font-medium text-slate-600 uppercase tracking-wider">Note (optional)</Label>
              <textarea id="po-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Delivery instructions, urgency, etc." data-testid="order-note"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500" />
            </div>
          </>
        )}
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40 rounded-b-2xl">
          <Button onClick={submit} disabled={submitting || cartLines.length === 0}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white" data-testid="submit-order">
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Submit Order to Manufacturer
          </Button>
          <p className="text-[11px] text-slate-500 mt-2 leading-relaxed text-center">
            The manufacturer will allocate inventory across warehouses; you&apos;ll see status updates in <strong>My Purchase Orders</strong>.
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ===========================================================================
 * My Purchase Orders — distributor's own outbound POs with status tracker
 * ===========================================================================
 */
const MY_ORDER_STATUS_META = {
  pending:                  { label: "Submitted",            tint: "bg-slate-100 text-slate-700",     Icon: Send },
  awaiting_allocation:      { label: "Awaiting Allocation",  tint: "bg-amber-100 text-amber-700",     Icon: Clock },
  allocated:                { label: "Allocated",            tint: "bg-emerald-100 text-emerald-700", Icon: ShieldCheck },
  partially_allocated:      { label: "Partially Allocated",  tint: "bg-amber-100 text-amber-700",     Icon: AlertTriangle },
  fulfillment_in_progress:  { label: "In Progress",          tint: "bg-blue-100 text-blue-700",       Icon: Truck },
  completed:                { label: "Delivered",            tint: "bg-violet-100 text-violet-700",   Icon: PackageCheck },
  back_ordered:             { label: "Back Ordered",         tint: "bg-rose-100 text-rose-700",       Icon: AlertTriangle },
  rejected:                 { label: "Rejected",             tint: "bg-slate-200 text-slate-600",     Icon: Ban },
};
const PROGRESS_STAGES = ["pending", "allocated", "fulfillment_in_progress", "completed"];

function MyOrdersTab({ distributorId }) {
  const [orders, setOrders] = useState(null);
  const [statusF, setStatusF] = useState("all");

  useEffect(() => {
    Api.distributorListMyOrders(distributorId).then(setOrders).catch(() => setOrders([]));
  }, [distributorId]);

  const filtered = useMemo(() => {
    if (!orders) return [];
    if (statusF === "all") return orders;
    if (statusF === "open") return orders.filter((o) => !["completed", "rejected"].includes(o.status));
    return orders.filter((o) => o.status === statusF);
  }, [orders, statusF]);

  if (!orders) return <Loading />;

  return (
    <div className="space-y-4" data-testid="my-orders-tab">
      {/* Filter pills */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap">
        {[["all","All"],["open","Open"],...Object.entries(MY_ORDER_STATUS_META).map(([k,v])=>[k,v.label])].map(([k, l]) => (
          <button key={k} onClick={() => setStatusF(k)}
            className={`text-xs px-2.5 py-1 rounded-md font-medium ${statusF === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            data-testid={`mo-filter-${k}`}>
            {l} ({k === "all" ? orders.length : k === "open" ? orders.filter((o) => !["completed", "rejected"].includes(o.status)).length : orders.filter((o) => o.status === k).length})
          </button>
        ))}
      </div>

      {/* Order cards */}
      {filtered.length === 0 ? (
        <Card className="border-dashed border-slate-300 bg-transparent">
          <CardContent className="py-16 text-center">
            <Package className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <div className="text-sm font-medium text-slate-700">No orders match this filter.</div>
            <div className="text-xs text-slate-500 mt-1">Switch to the <strong>Place Order</strong> tab to create one.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => <MyOrderRow key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}

function MyOrderRow({ order }) {
  const meta = MY_ORDER_STATUS_META[order.status] || MY_ORDER_STATUS_META.pending;
  const StatusIcon = meta.Icon;
  const currentStage = order.status === "rejected" || order.status === "back_ordered" ? 0
    : PROGRESS_STAGES.indexOf(order.status === "partially_allocated" ? "allocated" : order.status);
  const totalUnits = (order.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
  const totalValue = (order.items || []).reduce((s, it) => s + (it.quantity || 0) * (it.unit_price || 0), 0);

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden" data-testid={`mo-row-${order.id.slice(0, 8)}`}>
      <div className="px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="font-mono text-xs text-slate-500 font-medium">{order.id.slice(0, 8).toUpperCase()}</div>
            <span className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-md ${meta.tint}`}>
              <StatusIcon className="h-3 w-3" /> {meta.label}
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-700">
            {order.items?.length || 0} SKU lines · {totalUnits.toLocaleString()} units · <span className="font-semibold">{fmtMoney(totalValue)}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Submitted {fmtDate(order.created_at)}</div>
        </div>

        {/* Progress dots */}
        {order.status !== "rejected" && (
          <div className="hidden md:flex items-center gap-1.5">
            {["Submitted", "Allocated", "In Progress", "Delivered"].map((label, i) => {
              const done = currentStage >= i && currentStage >= 0;
              return (
                <span key={label} className="flex items-center gap-1.5">
                  <span className={`h-6 w-6 grid place-items-center rounded-full text-[10px] font-bold ${done ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {i + 1}
                  </span>
                  <span className={`text-xs font-medium ${done ? "text-slate-900" : "text-slate-400"}`}>{label}</span>
                  {i < 3 && <ArrowRight className={`h-3 w-3 ${currentStage > i ? "text-violet-600" : "text-slate-300"}`} />}
                </span>
              );
            })}
          </div>
        )}
        {order.status === "rejected" && order.rejection_reason && (
          <div className="text-xs text-rose-600 max-w-sm">
            <strong>Reason:</strong> {order.rejection_reason}
          </div>
        )}
      </div>

      {/* Line items */}
      <details className="border-t border-slate-100 group">
        <summary className="px-5 py-2.5 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50 select-none">
          View line items <ChevronRight className="inline-block h-3 w-3 ml-1 transition-transform group-open:rotate-90" />
        </summary>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/40">
            <tr>
              <th className="text-left py-2 px-5 font-medium">Product</th>
              <th className="text-left py-2 font-medium">SKU</th>
              <th className="text-right py-2 font-medium">Qty</th>
              <th className="text-right py-2 px-5 font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map((it, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="py-2 px-5 text-slate-800">{it.product_name || "—"}</td>
                <td className="py-2 text-slate-600 font-mono text-xs">{it.sku || "—"}</td>
                <td className="py-2 text-right text-slate-700">{(it.quantity || 0).toLocaleString()}</td>
                <td className="py-2 px-5 text-right font-medium text-slate-900">{fmtMoney((it.quantity || 0) * (it.unit_price || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
