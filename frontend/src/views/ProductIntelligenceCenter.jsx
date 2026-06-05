/**
 * Product Intelligence Center — Manufacturer's executive product analytics suite.
 *
 * Layered like Stripe Dashboard / Linear / Vercel Analytics: white background,
 * violet accent gradient (#6D28D9 → #8B5CF6), 16px radii, generous whitespace.
 * All data is driven by /api/manufacturer/:id/product-intelligence (single fat
 * endpoint) — see backend/routes/product_intelligence.py.
 *
 * Hierarchy:
 *   1. Page title + date range / filter / export
 *   2. 6 KPI cards
 *   3. AI Product Intelligence Brief (gradient + health score)
 *   4. Two-column body
 *        ├── 70%  Product Portfolio table (tabs + search)
 *        ├──      Batch Health donut · Expiry Risk donut · Category bars
 *        └── 30%  Product Performance Matrix · Geographic Heatmap · Stock Risk
 *   5. Recent Alerts strip
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { STATE_PATHS, VIEWBOX as NG_VIEWBOX } from "@/lib/nigeriaStates";
import {
  Sparkles, Package, Layers, Warehouse, Clock, ShieldAlert, Coins,
  Calendar, Filter, Download, Search, TrendingUp, TrendingDown,
  ChevronRight, ArrowUpRight, ArrowRight, AlertTriangle, RefreshCw,
  Info, Loader2, CheckCircle2, Activity, Boxes,
} from "lucide-react";

// ---------- formatters ----------
const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtMoneyFull = (v) => `₦${Number(v || 0).toLocaleString()}`;
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtPct = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtCompact = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};
const fmtDateRange = () => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 30);
  const opts = { month: "short", day: "numeric" };
  const y = end.getFullYear();
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}, ${y}`;
};

// ============================================================================
// MAIN VIEW
// ============================================================================
export default function ProductIntelligenceCenter() {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = (isRefresh = false) => {
    if (!session?.entity?.id) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    Api.manufacturerProductIntelligence(session.entity.id)
      .then(setData)
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [session?.entity?.id]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="pi-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading product intelligence…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="product-intelligence-center">
      <div className="px-8 py-7 max-w-[1840px] mx-auto space-y-6">
        <TitleBar refreshing={refreshing} onRefresh={() => load(true)} />
        <KPIStrip kpis={data.kpis} />
        <AIBriefHero brief={data.ai_brief} />

        {/* MAIN BODY: 12-col grid */}
        <div className="grid grid-cols-12 gap-6">
          {/* LEFT (70%) */}
          <div className="col-span-12 xl:col-span-8 space-y-6">
            <PortfolioTable rows={data.portfolio} />
            <PerformanceMatrix items={data.performance_matrix} portfolio={data.portfolio} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <BatchHealthDonut data={data.batch_health} />
              <ExpiryRiskDonut data={data.expiry_risk} />
              <CategoryBars data={data.category_performance} />
            </div>
          </div>

          {/* RIGHT (30%) */}
          <div className="col-span-12 xl:col-span-4 space-y-6">
            <GeographicHeatmap rows={data.geographic_heatmap} />
            <StockRiskCenter items={data.stock_risk} />
          </div>
        </div>

        <RecentAlertsStrip alerts={data.recent_alerts} />
      </div>
    </div>
  );
}

// ============================================================================
// HEADER
// ============================================================================
function TitleBar({ refreshing, onRefresh }) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[34px] font-bold tracking-tight text-slate-900 leading-none">
            Product Intelligence Center
          </h1>
          <Sparkles className="h-6 w-6 text-violet-500 animate-pulse" />
        </div>
        <p className="text-[13.5px] text-slate-500 mt-2 max-w-3xl">
          Real-time visibility into product performance, inventory health, batch traceability and expiry risk across your entire network.
        </p>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        <button className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors" data-testid="pi-date-range">
          <Calendar className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-medium">{fmtDateRange()}</span>
        </button>
        <button className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors" data-testid="pi-filter">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-medium">Filter</span>
        </button>
        <button className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm" data-testid="pi-export">
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        <button
          onClick={onRefresh}
          className="absolute right-8 top-[100px] flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
          data-testid="pi-refresh"
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          Last updated: {refreshing ? "refreshing…" : "just now"}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// KPI STRIP — 6 cards
// ============================================================================
function KPIStrip({ kpis }) {
  const cards = [
    { id: "products", label: "Products", value: fmtInt(kpis.products.value),
      sub: kpis.products.sub, Icon: Package, color: "indigo" },
    { id: "active_batches", label: "Active Batches", value: fmtInt(kpis.active_batches.value),
      sub: kpis.active_batches.sub, Icon: Layers, color: "violet" },
    { id: "units_in_network", label: "Units in Network", value: fmtCompact(kpis.units_in_network.value),
      sub: kpis.units_in_network.sub, Icon: Warehouse, color: "emerald",
      growth: kpis.units_in_network.growth_pct },
    { id: "expiring_90d", label: "Expiring Within 90 Days", value: fmtInt(kpis.expiring_90d.value),
      sub: kpis.expiring_90d.sub, Icon: Clock, color: "amber",
      growth: kpis.expiring_90d.growth_pct, growthBad: true },
    { id: "at_risk_value", label: "At-Risk Inventory Value", value: fmtMoney(kpis.at_risk_value.value),
      sub: kpis.at_risk_value.sub, Icon: ShieldAlert, color: "rose" },
    { id: "revenue_90d", label: "Revenue (90D)", value: fmtMoney(kpis.revenue_90d.value),
      sub: kpis.revenue_90d.sub, Icon: Coins, color: "green",
      growth: kpis.revenue_90d.growth_pct },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="pi-kpi-strip">
      {cards.map(c => <KPICard key={c.id} {...c} />)}
    </div>
  );
}

const KPI_PALETTE = {
  indigo:  { bg: "#EEF2FF", fg: "#4338CA" },
  violet:  { bg: "#F5F3FF", fg: "#7C3AED" },
  emerald: { bg: "#ECFDF5", fg: "#047857" },
  amber:   { bg: "#FFFBEB", fg: "#B45309" },
  rose:    { bg: "#FFF1F2", fg: "#BE123C" },
  green:   { bg: "#F0FDF4", fg: "#15803D" },
};

function KPICard({ id, label, value, sub, Icon, color, growth, growthBad }) {
  const c = KPI_PALETTE[color];
  const hasGrowth = growth !== undefined && growth !== null;
  const up = (growth ?? 0) >= 0;
  // For "bad" metrics like expiring units, "up" is actually negative news.
  const goodDirection = growthBad ? !up : up;

  return (
    <div
      className="group bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 transition-all duration-300 border border-slate-100/70"
      data-testid={`pi-kpi-${id}`}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: c.bg, color: c.fg }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold text-slate-500 leading-tight">{label}</div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <div className="text-[26px] font-bold text-slate-900 leading-none tabular-nums tracking-tight">{value}</div>
            {hasGrowth && (
              <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${goodDirection ? "text-emerald-600" : "text-rose-600"}`}>
                {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {fmtPct(growth)}
              </span>
            )}
          </div>
          <div className="text-[10.5px] text-slate-400 mt-1.5">{sub}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AI BRIEF HERO — purple gradient with 4 insights + health score donut
// ============================================================================
function AIBriefHero({ brief }) {
  const ICONS = {
    warning:   AlertTriangle,
    growth:    TrendingUp,
    decline:   TrendingDown,
    rebalance: RefreshCw,
    info:      Info,
  };
  return (
    <div
      className="relative overflow-hidden rounded-2xl shadow-[0_20px_50px_-15px_rgba(109,40,217,0.5)] animate-rise-in"
      data-testid="pi-ai-brief"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#4C1D95] via-[#6D28D9] to-[#7C3AED]" />
      <div className="absolute inset-0 opacity-[0.12] bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.6),transparent_45%)]" />
      <div className="absolute -top-24 -right-24 h-[300px] w-[300px] rounded-full bg-fuchsia-400/20 blur-3xl animate-shimmer-slow" />

      <div className="relative px-6 lg:px-8 py-6 grid grid-cols-12 gap-6 items-center">
        {/* Left: title + 4 insights */}
        <div className="col-span-12 lg:col-span-9 text-white">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-amber-200" />
            <h2 className="text-[15px] font-semibold tracking-tight">AI Product Intelligence Brief</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {brief.insights.map((ins, i) => {
              const Icon = ICONS[ins.kind] || Info;
              return (
                <div
                  key={i}
                  className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 px-3.5 py-3 hover:bg-white/15 transition-colors"
                  data-testid={`pi-insight-${i}`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold text-white leading-tight">{ins.title}</div>
                      <div className="text-[11px] text-white/75 mt-1 leading-snug">{ins.detail}</div>
                      <Link to={ins.product_id ? `/products/${ins.product_id}` : "#"}
                        className="inline-flex items-center gap-1 text-[10.5px] text-white/90 hover:text-white mt-2 font-semibold">
                        View details <ArrowRight className="h-2.5 w-2.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Network Inventory Health Score */}
        <div className="col-span-12 lg:col-span-3 text-white flex items-center justify-end" data-testid="pi-health-score">
          <div className="flex items-center gap-4">
            <HealthScoreRing score={brief.score.value} status={brief.score.status} />
            <div>
              <div className="text-[11px] font-medium text-white/70 leading-tight">Network Inventory</div>
              <div className="text-[11px] font-medium text-white/70 leading-tight mb-1">Health Score</div>
              <ScoreSparkline points={brief.score.trend} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthScoreRing({ score, status }) {
  const r = 32, c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  const color = score >= 85 ? "#34D399" : score >= 70 ? "#FBBF24" : score >= 50 ? "#FB923C" : "#F87171";
  return (
    <div className="relative h-[88px] w-[88px] flex-shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <div className="text-[22px] font-bold leading-none">{score}</div>
        <div className="text-[9px] font-medium text-white/70 mt-0.5">/100</div>
        <div className="text-[9px] font-bold text-emerald-200 mt-0.5">{status}</div>
      </div>
    </div>
  );
}

function ScoreSparkline({ points }) {
  if (!points || points.length < 2) return null;
  const w = 110, h = 30;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[110px] h-[30px]" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="#34D399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(points.length - 1) * step} cy={h - ((points[points.length - 1] - min) / range) * (h - 4) - 2}
        r="2" fill="#34D399" stroke="white" strokeWidth="1.2" />
    </svg>
  );
}

// ============================================================================
// PRODUCT PORTFOLIO TABLE
// ============================================================================
function PortfolioTable({ rows }) {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("revenue_90d");
  const [sortDir, setSortDir] = useState("desc");

  const counts = useMemo(() => ({
    all: rows.length,
    healthy: rows.filter(r => r.inventory_health === "healthy").length,
    watch: rows.filter(r => r.inventory_health === "watch").length,
    risk: rows.filter(r => r.inventory_health === "risk").length,
  }), [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (tab !== "all") r = r.filter(x => x.inventory_health === tab);
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(x => x.name.toLowerCase().includes(q) || (x.category || "").toLowerCase().includes(q));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [rows, tab, query, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sortIndicator = (k) => sortKey === k ? <span className="text-violet-500">{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-portfolio-table">
      <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-[17px] font-semibold text-slate-900">Product Portfolio</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search products..."
            className="h-9 pl-9 pr-3 w-[240px] rounded-xl border border-slate-200 bg-slate-50 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
            data-testid="pi-portfolio-search"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-100 mb-4" data-testid="pi-portfolio-tabs">
        {[
          { id: "all", label: "All Products" },
          { id: "healthy", label: "Healthy" },
          { id: "watch", label: "Watch" },
          { id: "risk", label: "At Risk" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative pb-2.5 px-3 text-[13px] font-semibold transition-colors ${
              tab === t.id ? "text-violet-600" : "text-slate-500 hover:text-slate-800"
            }`}
            data-testid={`pi-tab-${t.id}`}
          >
            {t.label}
            <span className={`ml-1.5 text-[10.5px] font-semibold tabular-nums ${tab === t.id ? "text-violet-500" : "text-slate-400"}`}>
              {counts[t.id]}
            </span>
            {tab === t.id && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-gradient-to-r from-[#6D28D9] to-[#8B5CF6]" />
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="text-left pb-3 pl-2">Product</th>
              <th className="text-left pb-3">Category</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("revenue_90d")}>Revenue (90D) {sortIndicator("revenue_90d")}</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("units_in_network")}>Units in Network {sortIndicator("units_in_network")}</th>
              <th className="text-right pb-3">Active Batches</th>
              <th className="text-right pb-3">Expiring (90D)</th>
              <th className="text-left pb-3">Inventory Health</th>
              <th className="text-left pb-3">Trend (90D)</th>
              <th className="text-right pb-3 pr-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map(r => <PortfolioRow key={r.id} row={r} />)}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-slate-400 text-xs">
                  No products match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100">
        <Link to="/product-intelligence" className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-600 hover:text-violet-700">
          View all products <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

const HEALTH_CHIP = {
  healthy: { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "#10B981", label: "Healthy" },
  watch:   { bg: "bg-amber-50",    text: "text-amber-700",   dot: "#F59E0B", label: "Watch" },
  risk:    { bg: "bg-rose-50",     text: "text-rose-700",    dot: "#EF4444", label: "Risk" },
};

function PortfolioRow({ row }) {
  const h = HEALTH_CHIP[row.inventory_health] || HEALTH_CHIP.healthy;
  return (
    <tr className="group hover:bg-slate-50/60 transition-colors" data-testid={`pi-product-${row.id}`}>
      <td className="py-2.5 pl-2">
        <Link to={`/products/${row.id}`} className="flex items-center gap-2.5">
          <ProductIcon name={row.name} />
          <span className="font-semibold text-slate-900 group-hover:text-violet-700 text-[13px]">{row.name}</span>
        </Link>
      </td>
      <td className="py-2.5 text-slate-600">{row.category}</td>
      <td className="py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmtMoneyFull(row.revenue_90d)}</td>
      <td className="py-2.5 text-right text-slate-700 tabular-nums">{fmtInt(row.units_in_network)}</td>
      <td className="py-2.5 text-right text-slate-700 tabular-nums">{row.active_batches}</td>
      <td className="py-2.5 text-right text-slate-700 tabular-nums">{fmtInt(row.expiring_90d)}</td>
      <td className="py-2.5">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold ${h.bg} ${h.text}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} />
          {h.label}
        </span>
      </td>
      <td className="py-2.5"><MiniSparkArea points={row.sparkline_30d} health={row.inventory_health} /></td>
      <td className="py-2.5 pr-2 text-right">
        <Link to={`/products/${row.id}`}
          className="inline-flex h-7 w-7 rounded-lg bg-slate-50 hover:bg-violet-50 items-center justify-center group-hover:bg-violet-100 transition-colors">
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-600" />
        </Link>
      </td>
    </tr>
  );
}

function ProductIcon({ name }) {
  // Use deterministic emoji-free gradient avatar (subtle different tints per product)
  const seed = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const palettes = [
    ["#A78BFA", "#7C3AED"], ["#FBBF24", "#D97706"], ["#34D399", "#059669"],
    ["#60A5FA", "#2563EB"], ["#F472B6", "#DB2777"], ["#FB7185", "#E11D48"],
  ];
  const [c1, c2] = palettes[seed % palettes.length];
  const initial = (name || "?")[0];
  return (
    <div
      className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 shadow-sm"
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      {initial}
    </div>
  );
}

function MiniSparkArea({ points, health }) {
  if (!points || points.length < 2) return <span className="text-slate-300 text-xs">—</span>;
  const w = 96, h = 26;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, h - ((p - min) / range) * (h - 4) - 2]);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const color = health === "risk" ? "#EF4444" : health === "watch" ? "#F59E0B" : "#10B981";
  const gradId = `sa-${health}-${Math.round(points.reduce((a, b) => a + b, 0))}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-24 h-7" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ============================================================================
// BATCH HEALTH DONUT
// ============================================================================
function BatchHealthDonut({ data }) {
  const COLORS = {
    healthy: "#10B981", near_expiry: "#F59E0B", expired: "#EF4444", recalled: "#8B5CF6",
  };
  const LABELS = {
    healthy: "Healthy", near_expiry: "Near Expiry (≤ 90)", expired: "Expired", recalled: "Recalled",
  };
  const ringSize = 130, R = 55, IR = 38, CX = 65, CY = 65;
  const polar = (a, r = R) => [CX + r * Math.cos((a - 90) * Math.PI / 180), CY + r * Math.sin((a - 90) * Math.PI / 180)];
  let acc = 0;
  const total = data.total || 1;
  const slices = data.breakdown.map(s => {
    const start = (acc / total) * 360;
    acc += s.count;
    const end = (acc / total) * 360;
    return { ...s, start, end, color: COLORS[s.status] };
  });

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-batch-health">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          Batch Health Overview
          <Info className="h-3 w-3 text-slate-300" />
        </h3>
        <Link to="/product-intelligence" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View all batches →</Link>
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="relative flex-shrink-0">
          <svg viewBox={`0 0 ${ringSize} ${ringSize}`} className="w-[130px] h-[130px]">
            {slices.map((s, i) => {
              if (s.count === 0) return null;
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
            <div className="text-[22px] font-bold text-slate-900 tabular-nums leading-none">{data.total}</div>
            <div className="text-[9px] font-medium text-slate-500 mt-0.5">Total Batches</div>
          </div>
        </div>
        <div className="space-y-2 flex-1 min-w-0">
          {data.breakdown.map(s => (
            <div key={s.status} className="flex items-center justify-between text-[11.5px] gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: COLORS[s.status] }} />
                <span className="text-slate-700 truncate">{LABELS[s.status]}</span>
              </div>
              <div className="flex-shrink-0 tabular-nums">
                <span className="font-semibold text-slate-900">{s.count}</span>
                <span className="text-slate-400 ml-1">({s.pct}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EXPIRY RISK DONUT
// ============================================================================
function ExpiryRiskDonut({ data }) {
  const COLORS = ["#EF4444", "#F59E0B", "#FCD34D"]; // 0-30 / 31-60 / 61-90
  const R = 55, IR = 38, CX = 65, CY = 65;
  const polar = (a, r = R) => [CX + r * Math.cos((a - 90) * Math.PI / 180), CY + r * Math.sin((a - 90) * Math.PI / 180)];
  let acc = 0;
  const total = data.total_at_risk || 1;
  const slices = data.buckets.map((b, i) => {
    const start = (acc / total) * 360;
    acc += b.units;
    const end = (acc / total) * 360;
    return { ...b, start, end, color: COLORS[i] };
  });
  const ne = data.nearest_expiry;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-expiry-risk">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          Expiry Risk <span className="text-slate-400 font-normal text-[12px]">(Units)</span>
        </h3>
        <Link to="/product-intelligence" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View full report →</Link>
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="relative flex-shrink-0">
          <svg viewBox="0 0 130 130" className="w-[130px] h-[130px]">
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
            <div className="text-[18px] font-bold text-slate-900 tabular-nums leading-none">{fmtCompact(data.total_at_risk)}</div>
            <div className="text-[9px] font-medium text-slate-500 mt-0.5">Units at risk</div>
          </div>
        </div>
        <div className="space-y-2 flex-1 min-w-0">
          {data.buckets.map((b, i) => (
            <div key={b.label} className="flex items-center justify-between text-[11px] gap-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: COLORS[i] }} />
                <span className="text-slate-700 whitespace-nowrap">{b.label}</span>
              </div>
              <div className="flex-shrink-0 tabular-nums">
                <span className="font-semibold text-slate-900">{fmtInt(b.units)}</span>
                <span className="text-slate-400 ml-1">({b.pct}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {ne && (
        <div className="mt-4 p-2.5 rounded-xl bg-violet-50/70 border border-violet-100 flex items-start gap-2.5" data-testid="pi-nearest-expiry">
          <div className="h-7 w-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0">
            <Calendar className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] font-semibold text-slate-900 leading-tight">Nearest expiry: {ne.product_name} Batch {ne.batch_number}</div>
            <div className="text-[10.5px] text-slate-600 mt-0.5">Expires in {ne.days_remaining} days · {fmtInt(ne.quantity)} units</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// CATEGORY BARS
// ============================================================================
function CategoryBars({ data }) {
  const max = Math.max(...data.map(d => d.revenue_90d), 1);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-category-performance">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          Category Performance <span className="text-slate-400 font-normal text-[12px]">(by Revenue 90D)</span>
        </h3>
        <Link to="/analytics" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View full report →</Link>
      </div>
      <div className="space-y-3 mt-4">
        {data.map(c => {
          const pct = (c.revenue_90d / max) * 100;
          const up = (c.growth_pct ?? 0) >= 0;
          return (
            <div key={c.category} data-testid={`pi-cat-${c.category}`}>
              <div className="flex items-center justify-between text-[11.5px] mb-1">
                <span className="text-slate-700 font-medium">{c.category}</span>
                <div className="flex items-center gap-2 tabular-nums">
                  <span className="font-semibold text-slate-900">{fmtMoney(c.revenue_90d)}</span>
                  <span className={`font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                    {up ? "↑" : "↓"} {fmtPct(c.growth_pct)}
                  </span>
                </div>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: "linear-gradient(90deg, #6D28D9, #8B5CF6)" }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// PERFORMANCE MATRIX — BCG-style strategic plot
// Clean scatter with circle-size encoding revenue, colour encoding inventory
// health, hover-only tooltip, side leaderboard and quadrant counts footer.
// ============================================================================
function PerformanceMatrix({ items, portfolio }) {
  // Merge portfolio fields (health + units) onto each matrix item
  const healthById = useMemo(() => {
    const m = {};
    for (const p of portfolio) m[p.id] = p;
    return m;
  }, [portfolio]);
  const enriched = items.map(p => ({
    ...p,
    inventory_health: healthById[p.id]?.inventory_health || "healthy",
    units_in_network: healthById[p.id]?.units_in_network || 0,
  }));

  // Plot dimensions (SVG viewBox space)
  const W = 360, H = 280, PADX = 14, PADY = 14;
  const xs = enriched.map(i => i.revenue_90d);
  const xMax = Math.max(...xs, 1);
  // sqrt scale so a few large SKUs don't bunch the small ones near zero
  const xScale = (v) => Math.sqrt(Math.max(v, 0) / xMax);
  // Y axis: growth clamped to [-50, +200]
  const yClamp = (g) => Math.max(Math.min(g ?? 0, 200), -50);
  const yNorm = (g) => (yClamp(g) + 50) / 250;

  // When growth values are clustered (very common in demo data where every
  // product trends at +100% because prior-period sales are sparse), spread
  // dots vertically by *revenue rank* inside their growth band so the chart
  // doesn't degenerate into a single horizontal line.
  const growthSpread = (() => {
    const gs = enriched.map(p => yClamp(p.growth_pct));
    const range = Math.max(...gs) - Math.min(...gs);
    return range;
  })();
  const useRankFallback = growthSpread < 10;
  const rankByRevenue = (() => {
    const sorted = [...enriched].sort((a, b) => b.revenue_90d - a.revenue_90d);
    const m = {};
    sorted.forEach((p, i) => { m[p.id] = i; });
    return m;
  })();

  // Circle radius bound to revenue (visual encoding), 5px..14px
  const rxs = enriched.map(i => i.revenue_90d);
  const rxMax = Math.max(...rxs, 1);
  const rxMin = Math.min(...rxs, 0);
  const rScale = (v) => 5 + Math.sqrt((v - rxMin) / (rxMax - rxMin || 1)) * 9;

  // Anti-collision: simple force-style nudge so circles never overlap.
  const raw = enriched.map(p => {
    let cy;
    if (useRankFallback) {
      // Spread vertically based on revenue rank inside the upper-half band
      // (since all dots share roughly the same growth, treat the y-axis as
      // a "relative scale" of revenue concentration).
      const rank = rankByRevenue[p.id];
      const norm = enriched.length > 1 ? rank / (enriched.length - 1) : 0.5;
      // Map rank 0 (highest revenue) to upper region (40-60% of plot height),
      // rank N-1 (lowest revenue) to mid-region — keeps everything in
      // the upper-half (growth >= 0) which the actual data implies.
      cy = PADY + 30 + norm * (H * 0.40);
    } else {
      cy = H - PADY - yNorm(p.growth_pct) * (H - 2 * PADY);
    }
    return {
      ...p,
      cx: PADX + xScale(p.revenue_90d) * (W - 2 * PADX),
      cy,
      r: rScale(p.revenue_90d),
    };
  });
  for (let iter = 0; iter < 60; iter++) {
    let moved = 0;
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const a = raw[i], b = raw[j];
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 0.01;
        const target = a.r + b.r + 2;
        if (dist < target) {
          const push = (target - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          a.cx -= ux * push; a.cy -= uy * push;
          b.cx += ux * push; b.cy += uy * push;
          moved++;
        }
      }
      // Clamp inside plot area
      raw[i].cx = Math.max(PADX + raw[i].r, Math.min(W - PADX - raw[i].r, raw[i].cx));
      raw[i].cy = Math.max(PADY + raw[i].r, Math.min(H - PADY - raw[i].r, raw[i].cy));
    }
    if (moved === 0) break;
  }

  const HEALTH_FILL = {
    healthy: "#10B981",
    watch:   "#F59E0B",
    risk:    "#EF4444",
  };
  const HEALTH_LABEL = {
    healthy: "Healthy",
    watch:   "Watch",
    risk:    "Risk",
  };

  // Quadrant counts
  const quadCounts = {
    stars: enriched.filter(p => p.quadrant === "stars").length,
    emerging: enriched.filter(p => p.quadrant === "emerging").length,
    cash_cows: enriched.filter(p => p.quadrant === "cash_cows").length,
    underperformers: enriched.filter(p => p.quadrant === "underperformers").length,
  };

  // Top 5 performers by revenue
  const topPerformers = [...enriched]
    .sort((a, b) => b.revenue_90d - a.revenue_90d)
    .slice(0, 5);

  const [hover, setHover] = useState(null);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-performance-matrix">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          Product Performance Matrix
          <Info className="h-3 w-3 text-slate-300" />
        </h3>
        <div className="flex items-center gap-2.5">
          <div className="hidden md:flex items-center gap-2.5 text-[10px] text-slate-600">
            {["healthy", "watch", "risk"].map(k => (
              <div key={k} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_FILL[k] }} />
                <span>{HEALTH_LABEL[k]}</span>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-slate-500 font-medium border border-slate-200 rounded-lg px-2 py-1">
            Revenue vs Growth
          </div>
        </div>
      </div>

      {/* CHART + LEADERBOARD */}
      <div className="grid grid-cols-12 gap-4">
        {/* CHART — 8 cols */}
        <div className="col-span-12 lg:col-span-8">
          <div className="relative">
            {/* y axis ticks */}
            <div className="absolute left-0 top-0 h-full w-7 flex flex-col items-end justify-between text-[9px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-1">
              <span>High</span>
              <span className="-rotate-90 whitespace-nowrap py-2">Growth (90D)</span>
              <span>Low</span>
            </div>

            <div className="ml-7">
              <div className="relative rounded-xl overflow-hidden border border-slate-100"
                   style={{ aspectRatio: `${W}/${H}` }}>
                {/* quadrant tints */}
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                  <div className="bg-emerald-50/40 border-r border-b border-slate-100 relative">
                    <div className="absolute top-2 left-2.5">
                      <div className="text-[10.5px] font-bold text-emerald-700">Emerging</div>
                      <div className="text-[8.5px] text-slate-500 leading-tight">Low Rev · High Growth</div>
                    </div>
                  </div>
                  <div className="bg-violet-50/40 border-b border-slate-100 relative">
                    <div className="absolute top-2 right-2.5 text-right">
                      <div className="text-[10.5px] font-bold text-violet-700">Stars</div>
                      <div className="text-[8.5px] text-slate-500 leading-tight">High Rev · High Growth</div>
                    </div>
                  </div>
                  <div className="bg-rose-50/40 border-r border-slate-100 relative">
                    <div className="absolute bottom-2 left-2.5">
                      <div className="text-[10.5px] font-bold text-rose-700">Underperformers</div>
                      <div className="text-[8.5px] text-slate-500 leading-tight">Low Rev · Low Growth</div>
                    </div>
                  </div>
                  <div className="bg-blue-50/40 relative">
                    <div className="absolute bottom-2 right-2.5 text-right">
                      <div className="text-[10.5px] font-bold text-blue-700">Cash Cows</div>
                      <div className="text-[8.5px] text-slate-500 leading-tight">High Rev · Low Growth</div>
                    </div>
                  </div>
                </div>

                {/* dots — SVG sits on top */}
                <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                  {/* axis crosshairs */}
                  <line x1={W / 2} y1={PADY} x2={W / 2} y2={H - PADY}
                        stroke="#CBD5E1" strokeWidth="0.8" strokeDasharray="3 3" />
                  <line x1={PADX} y1={H / 2} x2={W - PADX} y2={H / 2}
                        stroke="#CBD5E1" strokeWidth="0.8" strokeDasharray="3 3" />
                  {raw.map(p => {
                    const isHover = hover?.id === p.id;
                    const fill = HEALTH_FILL[p.inventory_health] || HEALTH_FILL.healthy;
                    return (
                      <g key={p.id} style={{ cursor: "pointer" }}
                         onMouseEnter={() => setHover(p)}
                         onMouseLeave={() => setHover(null)}
                      >
                        {/* outer ring on hover */}
                        {isHover && <circle cx={p.cx} cy={p.cy} r={p.r + 4} fill="none" stroke={fill} strokeWidth="1.3" opacity="0.45" />}
                        <circle cx={p.cx} cy={p.cy} r={p.r}
                          fill={fill} fillOpacity="0.85"
                          stroke="white" strokeWidth="1.6"
                          className="transition-all" />
                      </g>
                    );
                  })}
                </svg>

                {/* TOOLTIP — appears on hover; flips side to avoid overflow */}
                {hover && (
                  <div
                    className="absolute z-30 pointer-events-none animate-fade-rise"
                    style={{
                      left: `${(hover.cx / W) * 100}%`,
                      top: `${(hover.cy / H) * 100}%`,
                      transform: `translate(${hover.cx > W / 2 ? "calc(-100% - 16px)" : "16px"}, -50%)`,
                    }}
                  >
                    <div className="rounded-xl bg-slate-900/95 backdrop-blur text-white px-4 py-3 shadow-2xl text-[11px] tabular-nums w-[210px]">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_FILL[hover.inventory_health] }} />
                        <div className="font-semibold text-[12.5px] leading-tight">{hover.name}</div>
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                        <div className="text-white/60">Revenue</div>
                        <div className="text-right font-semibold">{fmtMoneyFull(hover.revenue_90d)}</div>
                        <div className="text-white/60">Growth</div>
                        <div className={`text-right font-semibold ${(hover.growth_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(hover.growth_pct)}</div>
                        <div className="text-white/60">Units</div>
                        <div className="text-right font-semibold">{fmtInt(hover.units_in_network)}</div>
                        <div className="text-white/60">Inv. Health</div>
                        <div className="text-right font-semibold capitalize">{HEALTH_LABEL[hover.inventory_health]}</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* x axis ticks */}
              <div className="flex items-center justify-between text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-1.5">
                <span>Low</span>
                <span className="text-slate-500">Revenue (90D)</span>
                <span>High</span>
              </div>
            </div>
          </div>
        </div>

        {/* LEADERBOARD — 4 cols */}
        <div className="col-span-12 lg:col-span-4" data-testid="pi-matrix-leaderboard">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Top Performers</div>
          <div className="divide-y divide-slate-100">
            {topPerformers.map((p, i) => {
              const up = (p.growth_pct ?? 0) >= 0;
              const fill = HEALTH_FILL[p.inventory_health];
              return (
                <Link to={`/products/${p.id}`} key={p.id}
                  className="flex items-center gap-2 py-2 -mx-2 px-2 rounded-lg hover:bg-slate-50 transition-colors"
                  onMouseEnter={() => setHover(raw.find(x => x.id === p.id))}
                  onMouseLeave={() => setHover(null)}
                  data-testid={`pi-top-performer-${i}`}
                >
                  <span className="text-[10px] font-bold text-slate-400 w-3 text-center tabular-nums">{i + 1}</span>
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: fill }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11.5px] font-semibold text-slate-900 truncate leading-tight">{p.name}</div>
                    <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
                      <span className="text-slate-600 font-semibold tabular-nums">{fmtMoney(p.revenue_90d)}</span>
                      <span className={`tabular-nums font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{fmtPct(p.growth_pct)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* QUADRANT COUNT SUMMARY */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-100" data-testid="pi-matrix-summary">
        {[
          { key: "stars", label: "Stars", color: "#7C3AED", bg: "bg-violet-50" },
          { key: "emerging", label: "Emerging", color: "#10B981", bg: "bg-emerald-50" },
          { key: "cash_cows", label: "Cash Cows", color: "#3B82F6", bg: "bg-blue-50" },
          { key: "underperformers", label: "Underperformers", color: "#EF4444", bg: "bg-rose-50" },
        ].map(q => (
          <div key={q.key} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${q.bg}`} data-testid={`pi-quad-${q.key}`}>
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: q.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-slate-500 leading-tight">{q.label}</div>
              <div className="text-[12.5px] font-bold text-slate-900 tabular-nums leading-tight">
                {quadCounts[q.key]} <span className="text-slate-500 font-medium text-[10px]">Product{quadCounts[q.key] === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Link to="/analytics" className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-600 hover:text-violet-700 mt-3">
        View full analysis <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ============================================================================
// GEOGRAPHIC HEATMAP — state-level units choropleth
// ============================================================================
const STATE_BAND = {
  excellent: "#15803D",
  good: "#22C55E",
  fair: "#FCD34D",
  poor: "#FB923C",
  critical: "#EF4444",
  no_data: "#E2E8F0",
};

function GeographicHeatmap({ rows }) {
  const [hover, setHover] = useState(null);
  const byState = useMemo(() => {
    const m = {};
    for (const r of rows) m[r.state] = r;
    return m;
  }, [rows]);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-geo-heatmap">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-slate-900 flex items-center gap-1.5">
          Geographic Inventory Heatmap <span className="text-slate-400 font-normal text-[12px]">(Units)</span>
          <Info className="h-3 w-3 text-slate-300" />
        </h3>
        <Link to="/network-map" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View map →</Link>
      </div>

      <div className="grid grid-cols-12 gap-3 mt-3">
        <div className="col-span-8 relative">
          <svg viewBox={`0 0 ${NG_VIEWBOX.w} ${NG_VIEWBOX.h}`} className="w-full" style={{ maxHeight: 220 }} data-testid="pi-nigeria-svg">
            {STATE_PATHS.map(state => {
              const data = byState[state.name];
              const band = data?.health || "no_data";
              const isHover = hover?.state === state.name;
              return (
                <path key={state.name} d={state.d}
                  fill={STATE_BAND[band]}
                  fillOpacity={isHover ? 1 : 0.92}
                  stroke="#FFFFFF" strokeWidth="0.6"
                  className="transition-all cursor-pointer"
                  onMouseEnter={() => setHover(data || { state: state.name, units: 0, revenue_90d: 0, health: "no_data" })}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{state.name} · {data ? `${fmtInt(data.units)} units` : "no data"}</title>
                </path>
              );
            })}
          </svg>
          {hover && (
            <div className="absolute top-1 left-1 px-2.5 py-1.5 rounded-lg bg-slate-900/95 text-white text-[10px] shadow-xl pointer-events-none">
              <div className="font-semibold">{hover.state}</div>
              <div>Units: <span className="tabular-nums font-semibold">{fmtInt(hover.units)}</span></div>
              <div>Health: <span className="font-semibold capitalize">{hover.health.replace("_", " ")}</span></div>
              <div>Revenue: <span className="tabular-nums font-semibold">{fmtMoney(hover.revenue_90d)}</span></div>
            </div>
          )}
        </div>
        <div className="col-span-4 flex flex-col gap-2 text-[10.5px]">
          {[
            { k: "excellent", lbl: "Excellent (80K+)" },
            { k: "good",      lbl: "Good (40K – 80K)" },
            { k: "fair",      lbl: "Fair (20K – 40K)" },
            { k: "poor",      lbl: "Poor (≤ 20K)" },
            { k: "no_data",   lbl: "No Data" },
          ].map(({ k, lbl }) => (
            <div key={k} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: STATE_BAND[k] }} />
              <span className="text-slate-600">{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STOCK RISK CENTER
// ============================================================================
function StockRiskCenter({ items }) {
  const RISK = {
    high:   { chip: "bg-rose-50 text-rose-700",     label: "High Risk" },
    medium: { chip: "bg-amber-50 text-amber-700",  label: "Medium Risk" },
    low:    { chip: "bg-emerald-50 text-emerald-700", label: "Low Risk" },
  };
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-stock-risk">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-slate-900">
          Stock Risk Center <span className="text-slate-400 font-normal text-[12px]">(Top 5)</span>
        </h3>
        <Link to="/product-intelligence" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View all →</Link>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length === 0 && (
          <div className="text-center text-slate-400 text-xs py-6">No products currently at risk.</div>
        )}
        {items.map((it, i) => {
          const r = RISK[it.risk_level] || RISK.low;
          return (
            <Link to={`/products/${it.product_id}`}
              key={it.product_id}
              className="flex items-center gap-3 py-2.5 hover:bg-slate-50/60 -mx-2 px-2 rounded-lg transition-colors"
              data-testid={`pi-risk-${i}`}
            >
              <div className="h-7 w-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold text-slate-900 truncate">{it.product_name}</div>
                <div className="text-[10.5px] text-slate-500 mt-0.5">{fmtInt(it.units_at_risk)} units expiring within 90 days</div>
              </div>
              <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold ${r.chip}`}>
                {r.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// RECENT ALERTS STRIP
// ============================================================================
function RecentAlertsStrip({ alerts }) {
  const ICON_MAP = {
    "alert-triangle": AlertTriangle,
    "trending-down": TrendingDown,
    "trending-up": TrendingUp,
    "check-circle": CheckCircle2,
    "info": Info,
    "activity": Activity,
    "boxes": Boxes,
  };
  const SEVERITY = {
    warning: { bg: "bg-amber-50", fg: "text-amber-600", chip: "bg-amber-100 text-amber-700", label: "Warning" },
    info:    { bg: "bg-blue-50",  fg: "text-blue-600",  chip: "bg-blue-100 text-blue-700",   label: "Info" },
    success: { bg: "bg-emerald-50", fg: "text-emerald-600", chip: "bg-emerald-100 text-emerald-700", label: "Success" },
    critical: { bg: "bg-rose-50",  fg: "text-rose-600", chip: "bg-rose-100 text-rose-700",   label: "Critical" },
  };
  const fmtAgo = (iso) => {
    if (!iso) return "—";
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} mins ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d > 1 ? "s" : ""} ago`;
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pi-recent-alerts">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-slate-900">Recent Alerts</h3>
        <Link to="/intel" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View all alerts →</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {alerts.length === 0 && (
          <div className="col-span-4 text-center text-slate-400 text-xs py-6">No recent alerts.</div>
        )}
        {alerts.map((a, i) => {
          const sev = SEVERITY[a.severity] || SEVERITY.info;
          const Icon = ICON_MAP[a.icon] || Info;
          return (
            <div key={i} className="rounded-xl border border-slate-100 p-4 hover:border-slate-200 hover:shadow-sm transition-all" data-testid={`pi-alert-${i}`}>
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${sev.bg} ${sev.fg}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-slate-900 leading-snug">{a.title}</div>
                  <div className="text-[11px] text-slate-600 mt-1 leading-snug line-clamp-2">{a.subtitle}</div>
                  <div className="text-[10px] text-slate-400 mt-2">{fmtAgo(a.timestamp)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
