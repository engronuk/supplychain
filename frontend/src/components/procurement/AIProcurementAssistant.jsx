/**
 * AI Procurement Assistant — sticky right-rail panel showing reorder
 * recommendations with actionable buttons (Create PO, Add to Cart,
 * Request Quote).
 */
import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  BrainCircuit, AlertOctagon, AlertTriangle, TrendingDown, Activity,
  Loader2, Sparkles, ShoppingCart, FilePlus, MessageSquareQuote,
} from "lucide-react";
import { toast } from "sonner";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString()}`;

const SEVERITY = {
  critical: { bar: "bg-rose-500", chip: "bg-rose-100 text-rose-700", icon: AlertOctagon, label: "Critical" },
  high:     { bar: "bg-orange-500", chip: "bg-orange-100 text-orange-700", icon: AlertTriangle, label: "High" },
  medium:   { bar: "bg-amber-400", chip: "bg-amber-100 text-amber-700", icon: TrendingDown, label: "Medium" },
  low:      { bar: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700", icon: Activity, label: "Low" },
};

export default function AIProcurementAssistant({ retailerId, onMutated, onSwitchTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    if (!retailerId) return;
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.aiRecommendations(retailerId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId, reloadKey]);

  const addToCart = async (rec) => {
    setBusy(true);
    try {
      await Api.cartAddItem(retailerId, {
        product_id: rec.product_id,
        distributor_id: rec.suggested_supplier.id,
        quantity: rec.recommended_qty,
        unit_cost: rec.suggested_supplier.last_unit_cost || 0,
      });
      toast.success(`Added ${rec.recommended_qty} × ${rec.product?.name || "item"} to cart`);
      onMutated?.();
    } catch {
      toast.error("Could not add to cart");
    } finally { setBusy(false); }
  };

  const createPO = async (rec) => {
    setBusy(true);
    try {
      await Api.createPurchaseOrder({
        retailer_id: retailerId,
        distributor_id: rec.suggested_supplier.id,
        items: [{
          product_id: rec.product_id,
          distributor_id: rec.suggested_supplier.id,
          quantity: rec.recommended_qty,
          unit_cost: rec.suggested_supplier.last_unit_cost || 0,
        }],
        note: "Created via AI Procurement Assistant",
      }, true);
      toast.success("PO submitted to distributor");
      onMutated?.();
      onSwitchTab?.("orders");
    } catch {
      toast.error("Could not create PO");
    } finally { setBusy(false); }
  };

  const requestQuote = async (rec) => {
    setBusy(true);
    try {
      const supplierId = rec.suggested_supplier.id;
      if (!supplierId) {
        toast.error("No supplier suggested");
        return;
      }
      await Api.createQuote({
        retailer_id: retailerId,
        product_id: rec.product_id,
        quantity: rec.recommended_qty,
        distributor_ids: [supplierId],
        note: "Initiated from AI recommendation",
      });
      toast.success("Quote request sent");
      onMutated?.();
      onSwitchTab?.("quotes");
    } catch {
      toast.error("Could not request quote");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="rounded-2xl bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#5b21b6] text-white shadow-xl overflow-hidden"
      data-testid="ai-procurement-assistant"
    >
      <div className="px-5 pt-5 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center">
            <BrainCircuit className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.18em] uppercase text-white/60">AI Assistant</div>
            <div className="text-sm font-semibold">Procurement Co-Pilot</div>
          </div>
        </div>
        <p className="text-[12px] text-white/70 mt-3 leading-snug">
          Reorder suggestions based on your real sales velocity and current stock cover.
        </p>
      </div>

      <div className="px-3 py-3 max-h-[640px] overflow-y-auto space-y-3" data-testid="ai-rec-list">
        {loading && (
          <div className="flex items-center justify-center py-12 text-white/60 gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Analyzing inventory…
          </div>
        )}
        {!loading && (data?.recommendations || []).length === 0 && (
          <div className="text-center py-10 text-white/70 text-sm">
            <Sparkles className="h-5 w-5 mx-auto mb-2 text-white/40" />
            All stock levels look healthy. Check back later.
          </div>
        )}
        {!loading && (data?.recommendations || []).map((rec) => (
          <RecCard
            key={rec.product_id}
            rec={rec}
            busy={busy}
            onAddToCart={() => addToCart(rec)}
            onCreatePO={() => createPO(rec)}
            onRequestQuote={() => requestQuote(rec)}
          />
        ))}
      </div>
    </div>
  );
}

function RecCard({ rec, busy, onAddToCart, onCreatePO, onRequestQuote }) {
  const sev = SEVERITY[rec.severity] || SEVERITY.medium;
  const Icon = sev.icon;
  return (
    <div className="rounded-xl bg-white/10 backdrop-blur border border-white/15 p-3.5"
         data-testid={`ai-rec-${rec.product_id}`}>
      <div className="flex items-start gap-2.5">
        <div className={`h-8 w-8 rounded-lg ${sev.chip} flex items-center justify-center shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center h-5 rounded-full px-2 text-[10px] font-bold ${sev.chip}`}>
              {sev.label}
            </span>
            <span className="text-[10px] text-white/50 tabular-nums">{rec.days_to_stockout}d cover</span>
          </div>
          <div className="text-sm font-semibold leading-tight">
            {rec.product?.name || "Unknown SKU"}
          </div>
          <div className="text-[11px] text-white/70 mt-1.5 leading-snug">
            {rec.headline}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
            <Stat label="Stock" value={`${rec.current_stock}`} />
            <Stat label="Velocity" value={`${rec.daily_velocity}/d`} />
            <Stat label="Reorder" value={`${rec.recommended_qty}`} />
            <Stat label="Lost rev" value={fmtMoney(rec.expected_lost_revenue)} />
          </div>
          <div className="mt-3 flex flex-col gap-1.5">
            <Button
              size="sm"
              disabled={busy}
              onClick={onCreatePO}
              className="h-8 bg-white text-slate-900 hover:bg-white/95 text-[11px] font-semibold"
              data-testid={`ai-rec-create-po-${rec.product_id}`}
            >
              <FilePlus className="h-3 w-3 mr-1" /> Create PO
            </Button>
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onAddToCart}
                className="h-7 bg-white/10 border-white/20 hover:bg-white/15 text-white text-[10px] font-semibold"
                data-testid={`ai-rec-add-cart-${rec.product_id}`}
              >
                <ShoppingCart className="h-3 w-3 mr-1" /> Cart
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onRequestQuote}
                className="h-7 bg-white/10 border-white/20 hover:bg-white/15 text-white text-[10px] font-semibold"
                data-testid={`ai-rec-quote-${rec.product_id}`}
              >
                <MessageSquareQuote className="h-3 w-3 mr-1" /> Quote
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md bg-white/5 border border-white/10 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-white/50">{label}</div>
      <div className="text-[11px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
