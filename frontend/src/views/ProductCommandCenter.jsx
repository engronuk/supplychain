/**
 * Product Command Center — full-bleed product intelligence dashboard.
 *
 * Layout sequence (matches reference image pixel-by-pixel):
 *   1. Breadcrumb + page title + health badge + meta + action buttons
 *   2. Two-column ID strip: Product image (gallery) | Product Identification |
 *      AI Product Summary card with confidence bar
 *   3. 6 executive KPI cards (Revenue · Units · AvgDaily · Turnover · DoC · STR)
 *   4. Tab nav (Overview / Batches / Expiry / Distribution / Demand / Performance / Activity)
 *   5. Overview tab:
 *        - Inventory Health (8 mini cards 4x2) | Sales & Revenue Trend (90d) | Geographic Performance
 *        - Batch Intelligence | Expiry Risk donut | Top Distributors
 *        - AI Recommendations + Projected Growth gradient card
 *   6. Other tabs are populated from the same payload.
 *
 * Single API call: /api/manufacturer/:id/product-detail/:product_id
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { STATE_PATHS, VIEWBOX as NG_VIEWBOX } from "@/lib/nigeriaStates";
import EditProductDialog from "@/components/EditProductDialog";
import AdjustInventoryDialog from "@/components/AdjustInventoryDialog";
import DraftPromotionDialog from "@/components/DraftPromotionDialog";
import {
  ArrowLeft, ChevronRight, Sparkles, Boxes, Edit2, MoreHorizontal,
  Tag, Copy, Download, QrCode, Package, TrendingUp, TrendingDown,
  Activity, Calendar, Truck, ChevronDown, Loader2, AlertTriangle,
  Megaphone, ArrowUp, Bell, CheckCircle2, ArrowUpRight,
  Layers, Mountain,
} from "lucide-react";

// ============================================================================
// Formatters
// ============================================================================
const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtMoneyFull = (v) => `₦${Number(v || 0).toLocaleString()}`;
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};
const fmtPct = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const HEALTH_CHIP = {
  healthy: { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "#10B981", label: "Healthy" },
  watch:   { bg: "bg-amber-50",    text: "text-amber-700",   dot: "#F59E0B", label: "Watch" },
  risk:    { bg: "bg-rose-50",     text: "text-rose-700",    dot: "#EF4444", label: "At Risk" },
  near_expiry: { bg: "bg-amber-50", text: "text-amber-700",   dot: "#F59E0B", label: "Near Expiry" },
  expired: { bg: "bg-rose-50", text: "text-rose-700", dot: "#EF4444", label: "Expired" },
  recalled: { bg: "bg-violet-50", text: "text-violet-700", dot: "#8B5CF6", label: "Recalled" },
};

// ============================================================================
// MAIN
// ============================================================================
export default function ProductCommandCenter() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [activeRecAction, setActiveRecAction] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  const handleRecAction = (rec) => {
    const a = rec.action || {};
    setActiveRecAction(a);
    if (a.type === "adjust_inventory") {
      setAdjustOpen(true);
    } else if (a.type === "navigate_distribution") {
      setActiveTab("distribution");
      // Scroll to the heatmap so the user can see the focused zone
      setTimeout(() => {
        const el = document.querySelector('[data-testid="pcc-tab-distribution"]');
        el && el.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } else if (a.type === "draft_promotion") {
      setPromoOpen(true);
    } else {
      // acknowledge — no-op, surface a toast handled in the child
    }
  };

  const load = () => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerProductDetailV2(session.entity.id, productId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId, session?.entity?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="product-detail-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading product command center…
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen p-8 max-w-7xl mx-auto" data-testid="product-detail-empty">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-slate-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="bg-white rounded-2xl p-12 border border-slate-100 text-center text-slate-600">
          Product not found in your catalog.
        </div>
      </div>
    );
  }

  const health = HEALTH_CHIP[data.health] || HEALTH_CHIP.healthy;
  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="product-command-center">
      <div className="px-8 py-7 max-w-[1840px] mx-auto space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[12px] text-slate-500" data-testid="pcc-breadcrumb">
          <Link to="/product-intelligence" className="hover:text-violet-600">Product Intelligence</Link>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <span className="text-slate-900 font-semibold">{data.product.name}</span>
        </nav>

        {/* Header — title + health + meta + action buttons */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[34px] font-bold tracking-tight text-slate-900 leading-none">
                {data.product.name}
              </h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${health.bg} ${health.text}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: health.dot }} />
                {health.label}
              </span>
            </div>
            <div className="text-[13px] text-slate-500 mt-2.5 flex items-center gap-1.5 flex-wrap">
              <span>SKU: <span className="font-mono text-slate-700">{data.product.sku}</span></span>
              <span className="text-slate-300">•</span>
              <span>Category: <span className="text-slate-700">{data.product.category}</span></span>
              <span className="text-slate-300">•</span>
              <span>Brand: <span className="text-slate-700">{data.product.brand !== "—" ? data.product.brand : data.product.name.split(" ")[0]}</span></span>
              <span className="text-slate-300">•</span>
              <span>Manufacturer: <span className="text-slate-700">{data.product.manufacturer_name}</span></span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAdjustOpen(true)} className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors" data-testid="pcc-adjust-inventory-btn">
              <Boxes className="h-3.5 w-3.5" /> Adjust Inventory
            </button>
            <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm" data-testid="pcc-edit-product-btn">
              <Edit2 className="h-3.5 w-3.5" /> Edit Product
            </button>
            <button className="h-10 w-10 rounded-xl border border-slate-200 bg-white flex items-center justify-center hover:bg-slate-50 transition-colors" data-testid="pcc-more">
              <MoreHorizontal className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </header>

        {/* Identification + AI Summary strip (3 cards: image · id · ai-summary) */}
        <div className="grid grid-cols-12 gap-4" data-testid="pcc-id-strip">
          <ProductImageCard product={data.product} />
          <ProductIdentificationCard product={data.product} />
          <AISummaryCard ai={data.ai_summary} />
        </div>

        {/* 6 KPI cards */}
        <KPIRow kpis={data.kpis} />

        {/* Tabs */}
        <TabsBar activeTab={activeTab} onChange={setActiveTab} />

        {/* Tab panels */}
        {activeTab === "overview" && <OverviewTab data={data} onRecClick={handleRecAction} />}
        {activeTab === "batches" && <BatchesTab batches={data.batches} />}
        {activeTab === "expiry" && <ExpiryTab data={data} />}
        {activeTab === "distribution" && <DistributionTab data={data} />}
        {activeTab === "forecast" && <ForecastTab forecast={data.demand_forecast} />}
        {activeTab === "performance" && <PerformanceTab data={data} />}
        {activeTab === "activity" && <ActivityTab activity={data.activity_log} />}
      </div>

      <EditProductDialog
        open={editOpen} onOpenChange={setEditOpen} product={data.product}
        onSaved={() => { setEditOpen(false); load(); }}
      />
      <AdjustInventoryDialog
        open={adjustOpen} onOpenChange={(o) => { setAdjustOpen(o); if (!o) setActiveRecAction(null); }}
        ownerType="manufacturer" ownerId={session.entity.id}
        product={data.product}
        currentQty={data.inventory.distributor_stock}
        initialDelta={activeRecAction?.type === "adjust_inventory" ? activeRecAction.units_delta : 0}
        initialReason={activeRecAction?.type === "adjust_inventory" ? activeRecAction.reason : ""}
        onSaved={() => { setAdjustOpen(false); setActiveRecAction(null); load(); }}
      />
      <DraftPromotionDialog
        open={promoOpen}
        onOpenChange={(o) => { setPromoOpen(o); if (!o) setActiveRecAction(null); }}
        manufacturerId={session.entity.id}
        product={data.product}
        batchAction={activeRecAction?.type === "draft_promotion" ? activeRecAction : null}
        onSaved={() => { setPromoOpen(false); setActiveRecAction(null); }}
      />
    </div>
  );
}

// ============================================================================
// HEADER CARDS — image · identification · ai-summary
// ============================================================================
function ProductImageCard({ product }) {
  // Use a deterministic gradient mock for the product silhouette
  const seed = product.name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const palettes = [
    ["#1E1B4B", "#312E81"], ["#0F172A", "#1E293B"], ["#42210B", "#7C2D12"],
    ["#064E3B", "#065F46"], ["#7C2D12", "#9F1239"], ["#1E293B", "#334155"],
  ];
  const [c1, c2] = palettes[seed % palettes.length];
  return (
    <div
      className="col-span-12 lg:col-span-2 bg-white rounded-2xl p-4 border border-slate-100 flex flex-col items-center justify-center hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] transition-shadow"
      data-testid="pcc-product-image"
    >
      <div
        className="w-full aspect-square rounded-xl flex items-center justify-center mb-3 overflow-hidden relative"
        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      >
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="object-contain w-full h-full" />
        ) : (
          <>
            <Package className="h-12 w-12 text-white/30" strokeWidth={1.5} />
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white text-[10px] font-bold tracking-widest opacity-80">
              {product.name.split(" ")[0].toUpperCase()}
            </span>
          </>
        )}
      </div>
      <button className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 inline-flex items-center gap-1">
        View gallery ({product.gallery_count})
      </button>
    </div>
  );
}

function ProductIdentificationCard({ product }) {
  const onCopy = (v) => navigator.clipboard?.writeText(v);
  return (
    <div className="col-span-12 lg:col-span-4 bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] transition-shadow" data-testid="pcc-identification">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <Tag className="h-4 w-4" />
        </div>
        <h3 className="text-[15px] font-semibold text-slate-900">Product Identification</h3>
      </div>
      <div className="space-y-3.5">
        <IdRow label="Barcode (GTIN)" right={(
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[12.5px] text-slate-900">{product.barcode}</span>
            <button onClick={() => onCopy(product.barcode)} className="h-6 w-6 rounded-md hover:bg-slate-100 flex items-center justify-center" title="Copy">
              <Copy className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        )} />
        <IdRow label="SKU" right={(
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[12.5px] text-slate-900">{product.sku}</span>
            <button onClick={() => onCopy(product.sku)} className="h-6 w-6 rounded-md hover:bg-slate-100 flex items-center justify-center" title="Copy">
              <Copy className="h-3 w-3 text-slate-400" />
            </button>
          </div>
        )} />
        <div className="flex items-start justify-between gap-2">
          <div className="text-[12px] text-slate-500">QR Code</div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="h-[64px] w-[64px] rounded-lg bg-white border border-slate-200 flex items-center justify-center">
              <QrCodeSvg payload={`${product.sku}|${product.id}`} />
            </div>
            <button className="text-[10px] font-semibold text-violet-600 hover:text-violet-700 inline-flex items-center gap-0.5">
              <Download className="h-2.5 w-2.5" /> Download
            </button>
          </div>
        </div>
        <IdRow label="Batch Tracking" right={(
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="h-3 w-3" /> Enabled
          </span>
        )} />
        <IdRow label="Unit Price" right={
          <span className="font-semibold text-slate-900 tabular-nums">{fmtMoneyFull(product.unit_price)}</span>
        } />
      </div>
    </div>
  );
}

function IdRow({ label, right }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-[12px] text-slate-500">{label}</div>
      {right}
    </div>
  );
}

// Tiny deterministic "QR-like" pattern (not a scannable QR but visually matches)
function QrCodeSvg({ payload }) {
  const N = 9;
  let h = 0;
  for (let i = 0; i < payload.length; i++) h = ((h << 5) - h) + payload.charCodeAt(i);
  const cells = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const bit = ((h >> ((r * N + c) % 31)) ^ (r * 13 + c * 7)) & 1;
      cells.push({ r, c, on: bit === 1 });
    }
  }
  // 3 finder squares
  const finder = [[0,0],[0,N-3],[N-3,0]];
  return (
    <svg viewBox={`0 0 ${N} ${N}`} className="w-[56px] h-[56px]">
      {cells.map((cell, i) => cell.on && (
        <rect key={i} x={cell.c} y={cell.r} width="1" height="1" fill="#0F172A" />
      ))}
      {finder.map(([r, c], i) => (
        <g key={i}>
          <rect x={c} y={r} width="3" height="3" fill="#0F172A" />
          <rect x={c + 0.5} y={r + 0.5} width="2" height="2" fill="#FFFFFF" />
          <rect x={c + 1} y={r + 1} width="1" height="1" fill="#0F172A" />
        </g>
      ))}
    </svg>
  );
}

function AISummaryCard({ ai }) {
  return (
    <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] transition-shadow" data-testid="pcc-ai-summary">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <h3 className="text-[15px] font-semibold text-slate-900">AI Product Summary</h3>
      </div>
      <ul className="space-y-2.5 mb-5">
        {ai.bullets.map((b, i) => (
          <li key={i} className="text-[12.5px] text-slate-700 leading-relaxed flex items-start gap-2" data-testid={`pcc-ai-bullet-${i}`}>
            <span className="text-violet-400 mt-1.5 flex-shrink-0">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-slate-500 font-medium">Confidence Score</span>
          <span className="text-[12px] font-bold text-violet-600 tabular-nums">{ai.confidence_pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#6D28D9] to-[#8B5CF6] transition-all duration-700"
            style={{ width: `${ai.confidence_pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// KPI ROW — 6 cards
// ============================================================================
function KPIRow({ kpis }) {
  const cards = [
    { id: "revenue_90d", label: "Revenue (90D)", value: fmtMoneyFull(kpis.revenue_90d.value),
      growth: kpis.revenue_90d.growth_pct, sub: kpis.revenue_90d.sub,
      Icon: CoinsIcon, color: "emerald" },
    { id: "units_sold", label: "Units Sold (90D)", value: fmtInt(kpis.units_sold_90d.value),
      growth: kpis.units_sold_90d.growth_pct, sub: kpis.units_sold_90d.sub,
      Icon: Package, color: "indigo" },
    { id: "avg_daily", label: "Avg Daily Sales", value: fmtInt(kpis.avg_daily_sales.value),
      growth: kpis.avg_daily_sales.growth_pct, sub: kpis.avg_daily_sales.sub,
      Icon: TrendingUp, color: "violet" },
    { id: "turnover", label: "Inventory Turnover", value: `${kpis.inventory_turnover.value}x`,
      growth: kpis.inventory_turnover.growth_pct, sub: kpis.inventory_turnover.sub,
      Icon: RefreshIcon, color: "orange" },
    { id: "days_cover", label: "Days of Cover", value: `${kpis.days_of_cover.value > 999 ? "999+" : kpis.days_of_cover.value} Days`,
      growth: null, sub: kpis.days_of_cover.sub,
      Icon: Calendar, color: "teal" },
    { id: "sell_through", label: "Sell-through Rate", value: `${kpis.sell_through_rate.value}%`,
      growth: kpis.sell_through_rate.growth_pct, sub: kpis.sell_through_rate.sub,
      Icon: TargetIcon, color: "rose" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="pcc-kpi-row">
      {cards.map(c => <KPICard key={c.id} {...c} />)}
    </div>
  );
}

const KPI_PALETTE = {
  emerald: { bg: "#ECFDF5", fg: "#047857" },
  indigo:  { bg: "#EEF2FF", fg: "#4338CA" },
  violet:  { bg: "#F5F3FF", fg: "#7C3AED" },
  orange:  { bg: "#FFF7ED", fg: "#C2410C" },
  teal:    { bg: "#F0FDFA", fg: "#0D9488" },
  rose:    { bg: "#FFF1F2", fg: "#BE123C" },
};

function KPICard({ id, label, value, growth, sub, Icon, color }) {
  const c = KPI_PALETTE[color];
  const hasGrowth = growth !== undefined && growth !== null;
  const up = (growth ?? 0) >= 0;
  return (
    <div
      className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] hover:-translate-y-0.5 transition-all duration-300"
      data-testid={`pcc-kpi-${id}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: c.bg, color: c.fg }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-[11px] font-semibold text-slate-500 leading-tight">{label}</div>
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-[22px] font-bold text-slate-900 tabular-nums tracking-tight">{value}</div>
        {hasGrowth && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? "↑" : "↓"} {fmtPct(growth)}
          </span>
        )}
      </div>
      <div className="text-[10.5px] text-slate-400 mt-1.5">{sub}</div>
    </div>
  );
}

// Inline SVG icons for KPIs that don't exist in lucide
function CoinsIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="M16.71 13.88L17.42 14.59l-4.95 4.95" /></svg>; }
function RefreshIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></svg>; }
function TargetIcon(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>; }

// ============================================================================
// TABS
// ============================================================================
function TabsBar({ activeTab, onChange }) {
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "batches", label: "Batches" },
    { id: "expiry", label: "Expiry Risk" },
    { id: "distribution", label: "Distribution" },
    { id: "forecast", label: "Demand & Forecast" },
    { id: "performance", label: "Performance" },
    { id: "activity", label: "Activity Log" },
  ];
  return (
    <nav className="flex items-center gap-1 border-b border-slate-200" data-testid="pcc-tabs">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`relative pb-3 px-4 text-[13px] font-semibold transition-colors ${
            activeTab === t.id ? "text-violet-600" : "text-slate-500 hover:text-slate-800"
          }`}
          data-testid={`pcc-tab-${t.id}`}
        >
          {t.label}
          {activeTab === t.id && (
            <span className="absolute bottom-[-1px] left-0 right-0 h-[2px] rounded-full bg-gradient-to-r from-[#6D28D9] to-[#8B5CF6]" />
          )}
        </button>
      ))}
    </nav>
  );
}

// ============================================================================
// OVERVIEW TAB
// ============================================================================
function OverviewTab({ data, onRecClick }) {
  return (
    <div className="space-y-6" data-testid="pcc-tab-overview">
      <div className="grid grid-cols-12 gap-6">
        <InventoryHealthCard inv={data.inventory} />
        <SalesRevenueTrend series={data.sales_trend} />
        <GeographicPerformance rows={data.geographic} />
      </div>
      <div className="grid grid-cols-12 gap-6">
        <BatchIntelligenceTable batches={data.batches} />
        <ExpiryRiskCard data={data.expiry_risk} unitPrice={data.product.unit_price} />
        <TopDistributorsTable rows={data.top_distributors} />
      </div>
      <AIRecsBar recs={data.ai_recommendations} forecast={data.demand_forecast} onRecClick={onRecClick} />
    </div>
  );
}

// --- Inventory Health (8 mini cards) ---
function InventoryHealthCard({ inv }) {
  const cells = [
    { id: "distributor_stock", label: "Distributor Stock", value: fmtInt(inv.distributor_stock), unit: "Units" },
    { id: "retailer_stock", label: "Retailer Stock", value: fmtInt(inv.retailer_stock), unit: "Units" },
    { id: "available_stock", label: "Available Stock", value: fmtInt(inv.available_stock), unit: "Units", emphasis: "emerald" },
    { id: "reserved_stock", label: "Reserved Stock", value: fmtInt(inv.reserved_stock), unit: "Units" },
    { id: "in_transit", label: "In Transit", value: fmtInt(inv.in_transit), unit: "Units" },
    { id: "total_stock", label: "Total Stock", value: fmtInt(inv.total_stock), unit: "Units" },
    { id: "inventory_value", label: "Inventory Value", value: fmtMoney(inv.inventory_value) },
    { id: "stockout_risk", label: "Stockout Risk", value: inv.stockout_risk,
      emphasis: inv.stockout_risk === "Low" ? "emerald" : inv.stockout_risk === "Medium" ? "amber" : "rose" },
  ];
  return (
    <div className="col-span-12 xl:col-span-4 bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-inventory-health">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-slate-900">Inventory Health</h3>
        <Link to="/product-intelligence" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View full details</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {cells.map(c => (
          <div key={c.id} className="rounded-xl bg-slate-50/60 px-3 py-2.5 border border-slate-100" data-testid={`pcc-inv-${c.id}`}>
            <div className="text-[10.5px] font-semibold text-slate-500 leading-tight">{c.label}</div>
            <div className={`text-[20px] font-bold tabular-nums mt-0.5 leading-none ${
              c.emphasis === "emerald" ? "text-emerald-600" :
              c.emphasis === "amber" ? "text-amber-600" :
              c.emphasis === "rose" ? "text-rose-600" : "text-slate-900"
            }`}>{c.value}</div>
            {c.unit && <div className="text-[10px] text-slate-400 mt-1.5">{c.unit}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Sales & Revenue Trend (bars + line) ---
function SalesRevenueTrend({ series }) {
  const [windowDays, setWindowDays] = useState(90);
  const visible = series.slice(-windowDays);
  const W = 720, H = 240, PAD_L = 44, PAD_R = 32, PAD_T = 16, PAD_B = 28;
  const CW = W - PAD_L - PAD_R, CH = H - PAD_T - PAD_B;
  const [hoverIdx, setHoverIdx] = useState(null);

  const maxRev = Math.max(...visible.map(d => d.revenue), 1);
  const maxUnits = Math.max(...visible.map(d => d.units), 1);
  const step = visible.length > 1 ? CW / (visible.length - 1) : CW;
  const barW = Math.max(2, step * 0.7);

  const linePath = visible
    .map((d, i) => `${i === 0 ? "M" : "L"} ${(PAD_L + i * step).toFixed(1)} ${(PAD_T + CH - (d.revenue / maxRev) * CH).toFixed(1)}`)
    .join(" ");
  const yTicksRev = [0, 0.25, 0.5, 0.75, 1].map(p => ({
    y: PAD_T + CH - p * CH, label: `₦${fmtCompact(maxRev * p).replace("₦", "")}M`,
  }));
  const yTicksUnits = [0, 0.25, 0.5, 0.75, 1].map(p => ({
    y: PAD_T + CH - p * CH, label: fmtCompact(maxUnits * p),
  }));

  // X axis labels — sparse
  const labelEveryN = Math.max(1, Math.floor(visible.length / 6));
  const xLabels = visible
    .map((d, i) => ({ x: PAD_L + i * step, idx: i, date: d.date }))
    .filter(p => p.idx % labelEveryN === 0);

  return (
    <div className="col-span-12 xl:col-span-4 bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-sales-trend">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[15px] font-semibold text-slate-900">Sales & Revenue Trend
          <span className="text-slate-400 font-normal ml-1">({windowDays} Days)</span>
        </h3>
        <select
          className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 cursor-pointer hover:bg-slate-50"
          value={windowDays}
          onChange={e => setWindowDays(parseInt(e.target.value))}
          data-testid="pcc-trend-range"
        >
          <option value={30}>30 Days</option>
          <option value={60}>60 Days</option>
          <option value={90}>90 Days</option>
        </select>
      </div>
      <div className="flex items-center gap-4 mb-2 text-[11px]">
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-violet-600" /><span className="text-slate-700">Revenue (₦)</span></div>
        <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /><span className="text-slate-700">Units Sold</span></div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none"
             onMouseLeave={() => setHoverIdx(null)}>
          {/* y gridlines */}
          {yTicksRev.map((t, i) => (
            <line key={i} x1={PAD_L} x2={W - PAD_R} y1={t.y} y2={t.y}
              stroke="#F1F5F9" strokeWidth="1" />
          ))}
          {/* y axis labels (left = revenue, right = units) */}
          {yTicksRev.map((t, i) => (
            <text key={i} x={PAD_L - 6} y={t.y + 3} fontSize="9" fill="#94A3B8" textAnchor="end">{t.label}</text>
          ))}
          {yTicksUnits.map((t, i) => (
            <text key={i} x={W - PAD_R + 6} y={t.y + 3} fontSize="9" fill="#94A3B8" textAnchor="start">{t.label}</text>
          ))}
          {/* unit bars */}
          {visible.map((d, i) => {
            const h = (d.units / maxUnits) * CH;
            const x = PAD_L + i * step - barW / 2;
            const y = PAD_T + CH - h;
            const isHover = hoverIdx === i;
            return (
              <g key={i}>
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)}
                  fill={isHover ? "#34D399" : "#10B981"} fillOpacity="0.9" rx="1" />
                <rect x={PAD_L + i * step - step / 2} y={PAD_T} width={step} height={CH}
                  fill="transparent" style={{ pointerEvents: "all" }}
                  onMouseEnter={() => setHoverIdx(i)} />
              </g>
            );
          })}
          {/* revenue line */}
          <path d={linePath} fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {/* hover marker */}
          {hoverIdx != null && (() => {
            const d = visible[hoverIdx];
            const cx = PAD_L + hoverIdx * step;
            const cy = PAD_T + CH - (d.revenue / maxRev) * CH;
            return (
              <g>
                <line x1={cx} x2={cx} y1={PAD_T} y2={PAD_T + CH} stroke="#7C3AED" strokeDasharray="2 3" strokeWidth="1" opacity="0.5" />
                <circle cx={cx} cy={cy} r="4" fill="#7C3AED" stroke="white" strokeWidth="1.5" />
              </g>
            );
          })()}
          {/* x labels */}
          {xLabels.map((p, i) => (
            <text key={i} x={p.x} y={H - 8} fontSize="9" fill="#94A3B8" textAnchor="middle">
              {fmtTrendLabel(p.date)}
            </text>
          ))}
        </svg>
        {hoverIdx != null && (
          <div
            className="absolute z-10 pointer-events-none px-2.5 py-1.5 rounded-lg bg-slate-900/95 text-white text-[10px] shadow-2xl"
            style={{
              left: `${(PAD_L + hoverIdx * step) / W * 100}%`,
              top: 8, transform: "translateX(-50%)",
            }}
          >
            <div className="font-semibold">{fmtDate(visible[hoverIdx].date)}</div>
            <div className="text-violet-300 tabular-nums">Rev: {fmtMoneyFull(visible[hoverIdx].revenue)}</div>
            <div className="text-emerald-300 tabular-nums">Units: {visible[hoverIdx].units}</div>
          </div>
        )}
      </div>
    </div>
  );
}
function fmtTrendLabel(date) {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// --- Geographic Performance ---
const HEAT_BAND = {
  excellent: "#15803D",
  good: "#22C55E",
  fair: "#FCD34D",
  poor: "#FB923C",
  critical: "#EF4444",
  no_data: "#E2E8F0",
};
function GeographicPerformance({ rows }) {
  const [hover, setHover] = useState(null);
  const byState = useMemo(() => {
    const m = {};
    for (const r of rows) m[r.state] = r;
    return m;
  }, [rows]);

  return (
    <div className="col-span-12 xl:col-span-4 bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-geographic">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[15px] font-semibold text-slate-900">Geographic Performance
          <span className="text-slate-400 font-normal ml-1">(Units in Network)</span>
        </h3>
        <Link to="/network-map" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View map</Link>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-8 relative">
          <svg viewBox={`0 0 ${NG_VIEWBOX.w} ${NG_VIEWBOX.h}`} className="w-full" style={{ maxHeight: 240 }} data-testid="pcc-nigeria-svg">
            {STATE_PATHS.map(state => {
              const data = byState[state.name];
              const band = data?.band || "no_data";
              return (
                <path key={state.name} d={state.d}
                  fill={HEAT_BAND[band]}
                  fillOpacity={hover?.state === state.name ? 1 : 0.92}
                  stroke="#FFFFFF" strokeWidth="0.6"
                  className="cursor-pointer transition-all"
                  onMouseEnter={() => setHover(data || { state: state.name, units: 0, revenue_90d: 0, distributors: 0, retailers: 0 })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{state.name} · {data ? fmtInt(data.units) + " units" : "no data"}</title>
                </path>
              );
            })}
          </svg>
          {hover && (
            <div className="absolute top-1 left-1 px-2.5 py-1.5 rounded-lg bg-slate-900/95 text-white text-[10px] shadow-xl pointer-events-none">
              <div className="font-semibold">{hover.state}</div>
              <div>Units: <span className="tabular-nums font-semibold">{fmtInt(hover.units)}</span></div>
              <div>Revenue: <span className="tabular-nums font-semibold">{fmtMoney(hover.revenue_90d)}</span></div>
              <div>Distributors: <span className="tabular-nums font-semibold">{hover.distributors}</span></div>
              <div>Retailers: <span className="tabular-nums font-semibold">{hover.retailers}</span></div>
            </div>
          )}
        </div>
        <div className="col-span-4 flex flex-col gap-2 text-[10.5px]">
          {[
            { k: "excellent", lbl: "Excellent (80K+)" },
            { k: "good",      lbl: "Good (40K – 80K)" },
            { k: "fair",      lbl: "Fair (20K – 40K)" },
            { k: "poor",      lbl: "Poor (< 20K)" },
            { k: "no_data",   lbl: "No Data" },
          ].map(({ k, lbl }) => (
            <div key={k} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: HEAT_BAND[k] }} />
              <span className="text-slate-600">{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Batch Intelligence Table ---
function BatchIntelligenceTable({ batches }) {
  const totalProduced = batches.reduce((s, b) => s + b.units_produced, 0);
  const totalAvailable = batches.reduce((s, b) => s + b.units_available, 0);
  return (
    <div className="col-span-12 xl:col-span-5 bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-batches">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Batch Intelligence</h3>
        <Link to="/product-intelligence" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View all batches</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="text-left pb-2">Batch Number</th>
              <th className="text-left pb-2">MFG Date</th>
              <th className="text-left pb-2">Expiry Date</th>
              <th className="text-right pb-2">Units Produced</th>
              <th className="text-right pb-2">Units Available</th>
              <th className="text-left pb-2 pl-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {batches.map(b => {
              const s = HEALTH_CHIP[b.status] || HEALTH_CHIP.healthy;
              return (
                <tr key={b.id} className="hover:bg-slate-50/60" data-testid={`pcc-batch-${b.batch_number}`}>
                  <td className="py-2 font-mono text-[12.5px] font-semibold text-slate-900">{b.batch_number}</td>
                  <td className="py-2 text-slate-600">{fmtDate(b.manufactured_at)}</td>
                  <td className="py-2 text-slate-600">{fmtDate(b.expiry_date)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-700">{fmtInt(b.units_produced)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-slate-900">{fmtInt(b.units_available)}</td>
                  <td className="py-2 pl-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
                      {s.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold text-slate-800 border-t-2 border-slate-200">
              <td className="py-2.5">Total</td>
              <td /><td />
              <td className="py-2.5 text-right tabular-nums">{fmtInt(totalProduced)}</td>
              <td className="py-2.5 text-right tabular-nums">{fmtInt(totalAvailable)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Expiry Risk donut + nearest expiry ---
function ExpiryRiskCard({ data, unitPrice }) {
  const colors = ["#EF4444", "#F59E0B", "#FCD34D", "#10B981"];
  const labels = ["0 – 30 days", "31 – 60 days", "61 – 90 days", "90+ days"];
  const R = 60, IR = 42, CX = 75, CY = 75;
  const polar = (a, r = R) => [CX + r * Math.cos((a - 90) * Math.PI / 180), CY + r * Math.sin((a - 90) * Math.PI / 180)];
  let acc = 0;
  const total = data.total_donut_units || 1;
  const slices = data.buckets.map((b, i) => {
    const start = (acc / total) * 360;
    acc += b.units;
    const end = (acc / total) * 360;
    return { ...b, start, end, color: colors[i] };
  });
  const ne = data.nearest_expiry;
  const exposure = ne ? ne.units_available * unitPrice : 0;
  return (
    <div className="col-span-12 xl:col-span-4 bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-expiry-risk-overview">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Expiry Risk
          <span className="text-slate-400 font-normal ml-1">(Units)</span>
        </h3>
        <Link to="#" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View full analysis</Link>
      </div>
      <div className="flex items-center gap-4 mt-1">
        <div className="relative flex-shrink-0">
          <svg viewBox="0 0 150 150" className="w-[150px] h-[150px]">
            {slices.map((s, i) => {
              if (s.units === 0) return null;
              const [x1, y1] = polar(s.start);
              const [x2, y2] = polar(s.end);
              const [x3, y3] = polar(s.end, IR);
              const [x4, y4] = polar(s.start, IR);
              const large = (s.end - s.start) > 180 ? 1 : 0;
              const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${IR} ${IR} 0 ${large} 0 ${x4} ${y4} Z`;
              return <path key={i} d={d} fill={s.color} className="hover:opacity-85 transition-opacity" />;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-[20px] font-bold text-slate-900 tabular-nums leading-none">{fmtInt(total)}</div>
            <div className="text-[9px] font-medium text-slate-500 mt-1">Total Units</div>
          </div>
        </div>
        <div className="space-y-2 flex-1 min-w-0">
          {data.buckets.map((b, i) => (
            <div key={b.label} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: colors[i] }} />
                <div>
                  <div className="text-slate-700 font-medium">{labels[i]}</div>
                  <div className="text-slate-400 text-[10px]">{fmtInt(b.units)} ({b.pct}%)</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {ne && (
        <div className="mt-4 p-3 rounded-xl bg-violet-50/70 border border-violet-100 flex items-start gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0">
            <Calendar className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-slate-900 leading-tight">
              Nearest expiry: <span className="font-mono">{ne.batch_number}</span>
            </div>
            <div className="text-[11px] text-slate-600 mt-0.5">
              Expires in {ne.days_remaining} days · {fmtInt(ne.units_available)} units available
            </div>
            <div className="text-[11px] text-rose-600 font-semibold mt-1">
              Potential loss: {fmtMoney(exposure)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Top Distributors Table ---
function TopDistributorsTable({ rows }) {
  return (
    <div className="col-span-12 xl:col-span-3 bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-top-distributors">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Top Distributors
          <span className="text-slate-400 font-normal ml-1 text-[12px]">(By Revenue – 90D)</span>
        </h3>
        <Link to="/network" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View all</Link>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
            <th className="text-left pb-2">Distributor</th>
            <th className="text-right pb-2">Revenue</th>
            <th className="text-right pb-2">Units</th>
            <th className="text-right pb-2">ST</th>
            <th className="text-right pb-2 pl-3">Health</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <tr><td colSpan={5} className="text-center text-slate-400 py-6 text-[11px]">No distributor sales yet.</td></tr>
          )}
          {rows.map((d, i) => {
            const healthBg = d.health === "Excellent" ? "bg-emerald-50 text-emerald-700"
                          : d.health === "Good" ? "bg-emerald-50 text-emerald-700"
                          : d.health === "Fair" ? "bg-amber-50 text-amber-700"
                          : "bg-rose-50 text-rose-700";
            return (
              <tr key={d.distributor_id} className="hover:bg-slate-50/60" data-testid={`pcc-top-dist-${i}`}>
                <td className="py-2 font-medium text-slate-900 truncate max-w-[160px]">{d.distributor_name}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{fmtMoney(d.revenue_90d)}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{fmtInt(d.units_sold_90d)}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{d.sell_through_pct}%</td>
                <td className="py-2 pl-3 text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${healthBg}`}>{d.health}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Link to="/network" className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-600 hover:text-violet-700 mt-3">
        View all distributors <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

// --- AI Recommendations + Projected Growth gradient card ---
function AIRecsBar({ recs, forecast, onRecClick }) {
  const REC_ICONS = {
    increase: { Icon: ArrowUp,         bg: "bg-emerald-50",  fg: "text-emerald-600", cta: "Adjust inventory" },
    monitor:  { Icon: AlertTriangle,   bg: "bg-amber-50",    fg: "text-amber-600",   cta: "Review distribution" },
    promote:  { Icon: Megaphone,       bg: "bg-blue-50",     fg: "text-blue-600",    cta: "Draft promotion" },
    maintain: { Icon: CheckCircle2,    bg: "bg-emerald-50",  fg: "text-emerald-600", cta: "Acknowledge" },
  };
  return (
    <div className="grid grid-cols-12 gap-6" data-testid="pcc-ai-recs">
      <div className="col-span-12 xl:col-span-8 bg-white rounded-2xl p-5 border border-slate-100">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h3 className="text-[15px] font-semibold text-slate-900">AI Recommendations</h3>
        </div>
        <p className="text-[11.5px] text-slate-500 mb-4">Based on current inventory, sales velocity and regional demand</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {recs.map((r, i) => {
            const cfg = REC_ICONS[r.kind] || REC_ICONS.maintain;
            const Icon = cfg.Icon;
            return (
              <div key={i} className="rounded-xl border border-slate-100 p-3.5 hover:shadow-sm hover:border-slate-200 transition-all flex flex-col" data-testid={`pcc-rec-${i}`}>
                <div className={`h-8 w-8 rounded-lg ${cfg.bg} ${cfg.fg} flex items-center justify-center mb-2.5`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="text-[12.5px] font-semibold text-slate-900 leading-tight">{r.title}</div>
                <div className="text-[10.5px] text-slate-500 leading-snug mt-1">{r.subtitle}</div>
                <div className="text-[10.5px] text-slate-700 font-medium mt-1.5">{r.detail}</div>
                <button
                  type="button"
                  onClick={() => onRecClick && onRecClick(r)}
                  className="mt-3 inline-flex items-center justify-center gap-1 text-[10.5px] font-semibold text-violet-600 hover:text-violet-700 hover:bg-violet-50 px-2 py-1.5 rounded-md transition-colors w-full"
                  data-testid={`pcc-rec-${i}-cta`}
                >
                  {cfg.cta} <ChevronRight className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <ProjectedGrowthCard forecast={forecast} />
    </div>
  );
}

function ProjectedGrowthCard({ forecast }) {
  // Generate a deterministic upward sparkline
  const pts = [10, 25, 22, 38, 30, 50, 48, 58, 70, 80, 88, 95];
  const w = 200, h = 50;
  const max = Math.max(...pts), min = Math.min(...pts);
  const step = w / (pts.length - 1);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / (max - min || 1)) * (h - 6) - 3).toFixed(1)}`).join(" ");
  return (
    <div className="col-span-12 xl:col-span-4 relative overflow-hidden rounded-2xl text-white p-5" data-testid="pcc-projected-growth">
      <div className="absolute inset-0 bg-gradient-to-br from-[#4C1D95] via-[#6D28D9] to-[#7C3AED]" />
      <div className="absolute -top-10 -right-10 h-[180px] w-[180px] rounded-full bg-fuchsia-400/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-1.5 text-[11px] text-white/70 mb-1">
          <Mountain className="h-3 w-3" /> Projected Growth
        </div>
        <div className="text-[11px] text-white/60 mb-3">Next 30 Days</div>
        <div className="flex items-baseline gap-2 mb-3">
          <ArrowUp className="h-5 w-5 text-emerald-300" />
          <span className="text-[34px] font-bold tracking-tight leading-none">{forecast.projected_growth_pct}%</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 50 }} preserveAspectRatio="none">
          <path d={path} fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

// ============================================================================
// OTHER TABS
// ============================================================================
function BatchesTab({ batches }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-tab-batches">
      <h3 className="text-[15px] font-semibold text-slate-900 mb-3">All Batches</h3>
      <BatchIntelligenceTableInline batches={batches} />
    </div>
  );
}
function BatchIntelligenceTableInline({ batches }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
          <th className="text-left pb-2">Batch Number</th>
          <th className="text-left pb-2">MFG Date</th>
          <th className="text-left pb-2">Expiry Date</th>
          <th className="text-right pb-2">Days Remaining</th>
          <th className="text-right pb-2">Units Produced</th>
          <th className="text-right pb-2">Units Available</th>
          <th className="text-left pb-2 pl-3">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {batches.map(b => {
          const s = HEALTH_CHIP[b.status] || HEALTH_CHIP.healthy;
          return (
            <tr key={b.id} className="hover:bg-slate-50/60">
              <td className="py-2 font-mono text-[12.5px] font-semibold text-slate-900">{b.batch_number}</td>
              <td className="py-2 text-slate-600">{fmtDate(b.manufactured_at)}</td>
              <td className="py-2 text-slate-600">{fmtDate(b.expiry_date)}</td>
              <td className="py-2 text-right tabular-nums text-slate-700">{b.days_remaining}</td>
              <td className="py-2 text-right tabular-nums text-slate-700">{fmtInt(b.units_produced)}</td>
              <td className="py-2 text-right tabular-nums font-semibold text-slate-900">{fmtInt(b.units_available)}</td>
              <td className="py-2 pl-3">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${s.bg} ${s.text}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
                  {s.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ExpiryTab({ data }) {
  return (
    <div className="grid grid-cols-12 gap-6" data-testid="pcc-tab-expiry">
      <ExpiryRiskCard data={data.expiry_risk} unitPrice={data.product.unit_price} />
      <BatchIntelligenceTable batches={data.batches} />
    </div>
  );
}

function DistributionTab({ data }) {
  return (
    <div className="grid grid-cols-12 gap-6" data-testid="pcc-tab-distribution">
      <div className="col-span-12 lg:col-span-4 bg-white rounded-2xl p-5 border border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Distribution Coverage</h3>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Distributors carrying" value={`${data.distribution.distributors_carrying} / ${data.distribution.distributors_total}`} />
          <Stat label="Retailers stocking" value={`${fmtInt(data.distribution.retailers_stocking)} / ${fmtInt(data.distribution.retailers_total)}`} />
          <Stat label="Market penetration" value={`${data.distribution.market_penetration_pct}%`} emphasis="emerald" />
          <Stat label="Active zones" value={data.distribution.coverage_by_zone.length} />
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Coverage by Zone</div>
          <div className="space-y-2">
            {data.distribution.coverage_by_zone.map(z => (
              <div key={z.zone} className="flex items-center justify-between text-[12px]">
                <span className="text-slate-700">{z.zone}</span>
                <span className="font-semibold text-slate-900 tabular-nums">{fmtInt(z.units)} units</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <GeographicPerformance rows={data.geographic} />
      <TopDistributorsTable rows={data.top_distributors} />
    </div>
  );
}

function ForecastTab({ forecast }) {
  return (
    <div className="grid grid-cols-12 gap-6" data-testid="pcc-tab-forecast">
      <div className="col-span-12 lg:col-span-8 bg-white rounded-2xl p-6 border border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-900 mb-1">Demand Forecast</h3>
        <p className="text-[12px] text-slate-500 mb-5">Projected units over the next 30 / 60 / 90 days</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Next 30 Days", value: forecast.next_30d },
            { label: "Next 60 Days", value: forecast.next_60d },
            { label: "Next 90 Days", value: forecast.next_90d },
          ].map((p, i) => (
            <div key={i} className="rounded-xl bg-slate-50/60 p-5 border border-slate-100">
              <div className="text-[11px] font-semibold text-slate-500">{p.label}</div>
              <div className="text-[28px] font-bold text-slate-900 tabular-nums mt-1.5 leading-none">{fmtInt(p.value)}</div>
              <div className="text-[10px] text-slate-400 mt-1.5">units projected</div>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] text-slate-500 font-semibold">AI Confidence</div>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#6D28D9] to-[#8B5CF6]"
                     style={{ width: `${forecast.confidence_pct}%` }} />
              </div>
              <span className="text-[12px] font-bold text-violet-600 tabular-nums">{forecast.confidence_pct}%</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-semibold">Projected Growth</div>
            <div className="text-[20px] font-bold text-emerald-600 tabular-nums mt-1">↑ {forecast.projected_growth_pct}%</div>
          </div>
        </div>
      </div>
      <ProjectedGrowthCard forecast={forecast} />
    </div>
  );
}

function PerformanceTab({ data }) {
  return (
    <div className="grid grid-cols-12 gap-6" data-testid="pcc-tab-performance">
      <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl p-5 border border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Revenue Contribution</h3>
        <div className="text-[42px] font-bold text-slate-900 tabular-nums leading-none">{data.performance.contribution_pct}%</div>
        <div className="text-[12px] text-slate-500 mt-1.5">of total manufacturer revenue (last 90 days)</div>
        <div className="mt-4 h-3 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[#6D28D9] to-[#8B5CF6]"
               style={{ width: `${Math.min(data.performance.contribution_pct, 100)}%` }} />
        </div>
      </div>
      <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl p-5 border border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Rankings</h3>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Growth Rank" value={`#${data.performance.growth_rank ?? "—"} / ${data.performance.growth_rank_total}`} />
          <Stat label="Category Rank" value={`#${data.performance.category_rank ?? "—"} / ${data.performance.category_rank_total}`} emphasis="emerald" />
        </div>
      </div>
      <div className="col-span-12 bg-white rounded-2xl p-5 border border-slate-100">
        <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Sales Trend (90 Days)</h3>
        <SalesRevenueTrendInline series={data.sales_trend} />
      </div>
    </div>
  );
}
function SalesRevenueTrendInline({ series }) { return <SalesRevenueTrend series={series} />; }

function ActivityTab({ activity }) {
  const ICONS = { package: Layers, truck: Truck, default: Activity };
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100" data-testid="pcc-tab-activity">
      <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Activity Log</h3>
      <div className="space-y-3">
        {activity.length === 0 && (
          <div className="text-center text-slate-400 py-8 text-[12px]">No activity recorded yet.</div>
        )}
        {activity.map((a, i) => {
          const Icon = ICONS[a.icon] || ICONS.default;
          return (
            <div key={i} className="flex items-start gap-3 py-2.5 border-b border-slate-50 last:border-0">
              <div className="h-8 w-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900">{a.action}</div>
                <div className="text-[11.5px] text-slate-600 mt-0.5">{a.subject}</div>
                <div className="text-[10.5px] text-slate-400 mt-1 flex items-center gap-2">
                  <span>{a.actor}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>{a.location}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>{fmtDate(a.ts)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, emphasis }) {
  return (
    <div className="rounded-xl bg-slate-50/60 p-3 border border-slate-100">
      <div className="text-[10.5px] font-semibold text-slate-500">{label}</div>
      <div className={`text-[18px] font-bold tabular-nums mt-0.5 leading-tight ${
        emphasis === "emerald" ? "text-emerald-600" : "text-slate-900"
      }`}>{value}</div>
    </div>
  );
}
