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
  Inbox, ShieldCheck, Send,
} from "lucide-react";
import { toast } from "sonner";
import POStatusBadge from "@/components/procurement/POStatusBadge";
import PODetailDrawer from "@/components/procurement/PODetailDrawer";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

export default function DistributorProcurementInbox() {
  const { session } = useSession();
  const distributorId = session?.entity?.id;
  const [tab, setTab] = useState("orders");

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
              <Inbox className="h-3 w-3" /> Procurement Inbox
            </div>
            <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Incoming orders & quote requests</h1>
            <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
              Approve / process retailer purchase orders and answer RFQs to win business.
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 h-auto gap-1">
            <TabsTrigger value="orders" data-testid="inbox-tab-orders"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <FileText className="h-4 w-4" /> Purchase Orders
            </TabsTrigger>
            <TabsTrigger value="quotes" data-testid="inbox-tab-quotes"
                         className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white gap-2">
              <MessageSquareQuote className="h-4 w-4" /> Quote Requests
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="mt-5">
            <DistributorPOInbox distributorId={distributorId} />
          </TabsContent>
          <TabsContent value="quotes" className="mt-5">
            <DistributorQuoteInbox distributorId={distributorId} />
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
