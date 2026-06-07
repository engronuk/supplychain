/**
 * Supplier Quotes — request quotes from multiple distributors and view
 * side-by-side comparison of responses.
 */
import { useEffect, useMemo, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, MessageSquareQuote, ChevronRight, Award, Clock, Box, Calendar,
  Loader2, FilePlus, ShoppingCart, X,
} from "lucide-react";
import { toast } from "sonner";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_PILL = {
  open:      { label: "Awaiting",  bg: "bg-amber-100",  fg: "text-amber-800" },
  responded: { label: "Quoted",    bg: "bg-violet-100", fg: "text-violet-800" },
  closed:    { label: "Closed",    bg: "bg-slate-200",  fg: "text-slate-700" },
  expired:   { label: "Expired",   bg: "bg-rose-100",   fg: "text-rose-800" },
};

export default function SupplierQuotesTab({ retailerId, onMutated }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [drawer, setDrawer] = useState({ open: false, quote: null });

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.quotes({ retailer_id: retailerId })
      .then((r) => { if (!cancelled) { setQuotes(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId, reloadKey]);

  const filtered = useMemo(() => {
    if (filter === "all") return quotes;
    return quotes.filter((q) => q.status === filter);
  }, [quotes, filter]);

  const stats = useMemo(() => ({
    total: quotes.length,
    open: quotes.filter((q) => q.status === "open").length,
    responded: quotes.filter((q) => q.status === "responded").length,
    avg_responses: quotes.length
      ? (quotes.reduce((a, b) => a + (b.responses?.length || 0), 0) / quotes.length).toFixed(1)
      : "0",
  }), [quotes]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4" data-testid="supplier-quotes-tab">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          {["all", "open", "responded", "closed"].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              data-testid={`quote-filter-${s}`}
              className={`inline-flex items-center gap-2 h-8 rounded-full px-3 text-[12px] font-semibold transition-colors ${
                filter === s ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <NewQuoteDialog retailerId={retailerId} onCreated={() => { reload(); onMutated?.(); }} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total quotes" value={stats.total} accent="text-slate-900" testId="kpi-total-quotes" />
        <Kpi label="Awaiting" value={stats.open} accent="text-amber-700" testId="kpi-awaiting" />
        <Kpi label="With responses" value={stats.responded} accent="text-violet-700" testId="kpi-quoted" />
        <Kpi label="Avg responses" value={stats.avg_responses} accent="text-slate-900" testId="kpi-avg-resp" />
      </div>

      <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <CardContent className="p-12 text-center text-slate-400">
            <MessageSquareQuote className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            No quotes yet — request your first one to compare prices.
          </CardContent>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((q) => (
              <button
                key={q.id}
                onClick={() => setDrawer({ open: true, quote: q })}
                className="w-full text-left px-5 py-4 hover:bg-violet-50/40 transition-colors"
                data-testid={`quote-row-${q.quote_number}`}
              >
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                    <MessageSquareQuote className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm font-semibold text-slate-900">{q.quote_number}</span>
                      <span className={`inline-flex items-center h-5 rounded-full px-2 text-[10px] font-bold ${STATUS_PILL[q.status]?.bg} ${STATUS_PILL[q.status]?.fg}`}>
                        {STATUS_PILL[q.status]?.label || q.status}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-slate-900">{q.product?.name || "—"}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5">
                      {q.quantity} units · {q.distributor_ids?.length || 0} supplier{q.distributor_ids?.length === 1 ? "" : "s"} invited · {fmtDate(q.created_at)}
                    </div>
                    {q.best_offer && (
                      <div className="mt-2 inline-flex items-center gap-2 text-[12px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 h-6">
                        <Award className="h-3 w-3" /> Best: {fmtMoney(q.best_offer.unit_price)}/unit
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 mt-2" />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <QuoteComparisonDrawer
        quote={drawer.quote}
        open={drawer.open}
        onOpenChange={(o) => setDrawer({ ...drawer, open: o })}
        retailerId={retailerId}
        onMutated={() => { reload(); onMutated?.(); }}
      />
    </div>
  );
}

function Kpi({ label, value, accent, testId }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200" data-testid={testId}>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className={`text-2xl font-semibold tabular-nums mt-1 ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function NewQuoteDialog({ retailerId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(100);
  const [selectedDists, setSelectedDists] = useState([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Api.products().then((ps) => setProducts(ps || [])).catch(() => {});
    Api.distributors().then((ds) => setDistributors(ds || [])).catch(() => {});
  }, [open]);

  const toggleDist = (id) => setSelectedDists((arr) =>
    arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
  );

  const submit = async () => {
    if (!productId || quantity < 1 || selectedDists.length === 0) {
      toast.error("Pick a product, quantity and at least one supplier");
      return;
    }
    setSaving(true);
    try {
      await Api.createQuote({
        retailer_id: retailerId,
        product_id: productId,
        quantity: Number(quantity),
        distributor_ids: selectedDists,
        note: note || null,
      });
      toast.success("Quote request sent");
      setOpen(false);
      setProductId(""); setQuantity(100); setSelectedDists([]); setNote("");
      onCreated?.();
    } catch { toast.error("Could not send quote request"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-violet-700 hover:bg-violet-800 text-white" data-testid="open-new-quote">
          <Plus className="h-4 w-4 mr-1.5" /> Request quote
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request supplier quotes</DialogTitle>
          <DialogDescription>Send a Request-for-Quote to multiple distributors and compare their offers.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-1" data-testid="new-quote-product"><SelectValue placeholder="Select a product" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Quantity needed</Label>
            <Input
              type="number" min="1" value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="mt-1 tabular-nums"
              data-testid="new-quote-qty"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Invite suppliers ({selectedDists.length} selected)</Label>
            <div className="mt-1 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100" data-testid="new-quote-supplier-list">
              {distributors.map((d) => (
                <label key={d.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                  <Checkbox
                    checked={selectedDists.includes(d.id)}
                    onCheckedChange={() => toggleDist(d.id)}
                    data-testid={`new-quote-dist-${d.id}`}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-slate-900">{d.name}</div>
                    <div className="text-[11px] text-slate-500">{d.city || ""} · {d.region || ""}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add any context for the suppliers…"
              className="mt-1"
              data-testid="new-quote-note"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}
                  className="bg-violet-700 hover:bg-violet-800 text-white"
                  data-testid="confirm-new-quote">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuoteComparisonDrawer({ quote, open, onOpenChange, retailerId, onMutated }) {
  const [busy, setBusy] = useState(false);
  if (!quote) return null;
  const bestPrice = quote.responses?.length
    ? Math.min(...quote.responses.map((r) => r.unit_price)) : null;

  const addToCart = async (resp) => {
    setBusy(true);
    try {
      await Api.cartAddItem(retailerId, {
        product_id: quote.product_id,
        distributor_id: resp.distributor_id,
        quantity: quote.quantity,
        unit_cost: resp.unit_price,
      });
      toast.success("Added to cart");
      onMutated?.();
    } catch { toast.error("Could not add to cart"); }
    finally { setBusy(false); }
  };

  const createPO = async (resp) => {
    setBusy(true);
    try {
      await Api.createPurchaseOrder({
        retailer_id: retailerId,
        distributor_id: resp.distributor_id,
        items: [{
          product_id: quote.product_id,
          distributor_id: resp.distributor_id,
          quantity: quote.quantity,
          unit_cost: resp.unit_price,
        }],
        note: `From quote ${quote.quote_number}`,
      }, true);
      toast.success("PO submitted");
      onMutated?.();
      onOpenChange(false);
    } catch { toast.error("Could not create PO"); }
    finally { setBusy(false); }
  };

  const closeQuote = async () => {
    setBusy(true);
    try {
      await Api.closeQuote(quote.id);
      toast.success("Quote closed");
      onMutated?.();
      onOpenChange(false);
    } catch { toast.error("Could not close quote"); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto p-0" data-testid="quote-comparison-drawer">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-200">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Quote request</div>
          <SheetTitle className="text-2xl font-semibold tracking-tight tabular-nums">{quote.quote_number}</SheetTitle>
          <SheetDescription className="mt-1">
            {quote.product?.name || "—"} · <span className="font-semibold">{quote.quantity}</span> units
          </SheetDescription>
        </SheetHeader>

        <div className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Suppliers invited" value={quote.distributor_ids?.length || 0} />
            <Stat label="Responses" value={quote.responses?.length || 0} accent="text-violet-700" />
            <Stat label="Best price" value={bestPrice != null ? fmtMoney(bestPrice) : "—"} accent="text-emerald-700" />
          </div>

          {quote.responses?.length === 0 ? (
            <Card className="rounded-xl border-slate-200">
              <CardContent className="p-8 text-center text-slate-400">
                <Clock className="h-7 w-7 mx-auto text-slate-300 mb-2" />
                Waiting for supplier responses…
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold">Supplier</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Unit Price</th>
                    <th className="text-right px-3 py-2.5 font-semibold">Lead Time</th>
                    <th className="text-right px-3 py-2.5 font-semibold">MOQ</th>
                    <th className="text-left px-3 py-2.5 font-semibold">Valid Until</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...quote.responses].sort((a, b) => a.unit_price - b.unit_price).map((r, i) => {
                    const best = r.unit_price === bestPrice;
                    return (
                      <tr key={r.distributor_id} className={best ? "bg-emerald-50/40" : ""}
                          data-testid={`quote-response-${r.distributor_id}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{r.distributor?.name || "—"}</span>
                            {best && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-full px-2 h-5">
                                <Award className="h-3 w-3" /> BEST
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">{r.distributor?.city || ""} · {r.distributor?.region || ""}</div>
                          {r.notes && <div className="text-[11px] text-slate-500 italic mt-1">&ldquo;{r.notes}&rdquo;</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{fmtMoney(r.unit_price)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.lead_time_days}d</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.moq}</td>
                        <td className="px-3 py-2.5 text-slate-500">{fmtDate(r.valid_until)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy}
                                    onClick={() => addToCart(r)} data-testid={`quote-add-cart-${r.distributor_id}`}>
                              <ShoppingCart className="h-3 w-3 mr-1" />Cart
                            </Button>
                            <Button size="sm" className="h-7 px-2 bg-violet-700 hover:bg-violet-800 text-white" disabled={busy}
                                    onClick={() => createPO(r)} data-testid={`quote-create-po-${r.distributor_id}`}>
                              <FilePlus className="h-3 w-3 mr-1" />PO
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 sticky bottom-0">
          {quote.status !== "closed" && (
            <Button variant="outline" disabled={busy} onClick={closeQuote}
                    className="border-slate-300 text-slate-700" data-testid="close-quote">
              <X className="h-4 w-4 mr-1.5" /> Close quote
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${accent || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function Loading() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-10 flex items-center justify-center text-slate-400 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading quotes…
    </div>
  );
}
