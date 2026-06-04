/**
 * Distributor Intelligence Center — executive drill-down for a single distributor.
 *
 * Sections (top → bottom):
 *   1. Breadcrumb · title · status/region/city/onboarded meta · action buttons
 *   2. Header strip: identity panel · 6 KPI cards · AI executive summary
 *      (purple gradient with health gauge)
 *   3. Retail Performance Matrix (2x2 scatter)
 *   4. Retail Coverage Map (city bubbles) | Top Performers | Needs Attention
 *   5. Product Penetration bars
 *   6. Retailer Intelligence Table (search + filter + export)
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import {
  ChevronRight, Sparkles, Edit2, MapPin, Users,
  TrendingUp, TrendingDown, Loader2, ArrowLeft,
  Store, BarChart3, Search, Download, Filter,
  ArrowRight, Calendar, Target,
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
const fmtDate = (v) => v
  ? new Date(v).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

const HEALTH_PALETTE = {
  healthy:    { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "#10B981", label: "Healthy" },
  watch:      { bg: "bg-amber-50",    text: "text-amber-700",   dot: "#F59E0B", label: "Watch" },
  risk:       { bg: "bg-rose-50",     text: "text-rose-700",    dot: "#EF4444", label: "At Risk" },
  excellent:  { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "#15803D", label: "Excellent" },
  good:       { bg: "bg-emerald-50",  text: "text-emerald-700", dot: "#22C55E", label: "Good" },
  fair:       { bg: "bg-amber-50",    text: "text-amber-700",   dot: "#FCD34D", label: "Fair" },
  poor:       { bg: "bg-orange-50",   text: "text-orange-700",  dot: "#FB923C", label: "Poor" },
  critical:   { bg: "bg-rose-50",     text: "text-rose-700",    dot: "#EF4444", label: "Critical" },
};

// ============================================================================
// MAIN
// ============================================================================
export default function DistributorIntelligenceCenter() {
  const { distributorId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerDistributorIntelligence(session.entity.id, distributorId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [distributorId, session?.entity?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="dic-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading distributor intelligence…
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen p-8 max-w-7xl mx-auto">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-slate-700 mb-4">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="bg-white rounded-2xl p-12 border border-slate-100 text-center text-slate-600">
          Distributor not found in your network.
        </div>
      </div>
    );
  }

  const d = data.distributor;
  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="distributor-intelligence-center">
      <div className="px-8 py-7 max-w-[1840px] mx-auto space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <Link to="/network" className="hover:text-violet-600">Distributors</Link>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <span className="text-slate-900 font-semibold">Distributor Intelligence Center</span>
        </nav>

        {/* Header */}
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight text-slate-900 leading-none uppercase">
              {d.name}
            </h1>
            <div className="text-[13px] text-slate-500 mt-3 flex items-center gap-4 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-semibold text-emerald-700 capitalize">{d.status}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-slate-400" />
                {d.region}{d.city ? ` · ${d.city}` : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3 text-slate-400" />
                Onboarded {fmtDate(d.created_at)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/network/${d.id}`}
              className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              data-testid="dic-view-retailers"
            >
              <Users className="h-3.5 w-3.5" /> View Retailers
            </Link>
            <Link to="/network-map"
              className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              data-testid="dic-retail-heatmap"
            >
              <MapPin className="h-3.5 w-3.5" /> Retail Heatmap
            </Link>
            <button className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#8B5CF6] text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm" data-testid="dic-edit-distributor">
              <Edit2 className="h-3.5 w-3.5" /> Edit Distributor
            </button>
          </div>
        </header>

        {/* KPI strip + AI hero */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-8">
            <KPIRow kpis={data.kpis} />
          </div>
          <div className="col-span-12 xl:col-span-4">
            <AIExecSummary brief={data.ai_brief} />
          </div>
        </div>

        {/* Performance matrix + coverage map */}
        <div className="grid grid-cols-12 gap-6">
          <RetailPerformanceMatrix items={data.retail_performance_matrix} />
          <RetailCoverageMap rows={data.retail_coverage} />
        </div>

        {/* Top performers · Needs attention */}
        <div className="grid grid-cols-12 gap-6">
          <TopPerformers rows={data.top_retailers} />
          <NeedsAttention rows={data.attention_retailers} />
        </div>

        {/* Product penetration */}
        <ProductPenetration rows={data.product_penetration} />

        {/* Retailer intelligence table */}
        <RetailerIntelligenceTable rows={data.retailer_table} />
      </div>
    </div>
  );
}

// ============================================================================
// KPI Row — 6 cards with mini sparkline
// ============================================================================
function KPIRow({ kpis }) {
  const cards = [
    { id: "retail_revenue_90d", label: "Retail Revenue (90D)",
      value: fmtMoney(kpis.retail_revenue_90d.value),
      growth: kpis.retail_revenue_90d.growth_pct,
      sub: kpis.retail_revenue_90d.sub,
      spark: kpis.retail_revenue_90d.spark, color: "violet" },
    { id: "active_retailers", label: "Active Retailers",
      value: `${kpis.active_retailers.value} / ${kpis.active_retailers.total}`,
      growth: kpis.active_retailers.pct,
      growthLabel: `${kpis.active_retailers.pct}%`,
      sub: kpis.active_retailers.sub,
      spark: kpis.active_retailers.spark, color: "indigo" },
    { id: "network_health_score", label: "Network Health Score",
      value: `${kpis.network_health_score.value} / 100`,
      sub: kpis.network_health_score.status,
      spark: kpis.network_health_score.spark,
      isProgress: true, progress: kpis.network_health_score.value, color: "emerald" },
    { id: "stockout_risk_retailers", label: "Stockout Risk Retailers",
      value: kpis.stockout_risk_retailers.value,
      sub: kpis.stockout_risk_retailers.sub,
      spark: kpis.stockout_risk_retailers.spark, color: "rose" },
    { id: "avg_sell_through", label: "Avg Sell Through",
      value: `${kpis.avg_sell_through.value}%`,
      sub: kpis.avg_sell_through.sub,
      spark: kpis.avg_sell_through.spark, color: "amber" },
    { id: "retail_order_frequency", label: "Retail Order Frequency",
      value: `${kpis.retail_order_frequency.value}`,
      sub: kpis.retail_order_frequency.sub,
      spark: kpis.retail_order_frequency.spark, color: "teal" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3" data-testid="dic-kpi-row">
      {cards.map(c => <KPICard key={c.id} {...c} />)}
    </div>
  );
}

const KPI_PALETTE = {
  violet:  { bg: "#F5F3FF", fg: "#7C3AED" },
  indigo:  { bg: "#EEF2FF", fg: "#4338CA" },
  emerald: { bg: "#ECFDF5", fg: "#047857" },
  rose:    { bg: "#FFF1F2", fg: "#BE123C" },
  amber:   { bg: "#FFFBEB", fg: "#B45309" },
  teal:    { bg: "#F0FDFA", fg: "#0D9488" },
};

const KPI_ICONS = {
  retail_revenue_90d: BarChart3,
  active_retailers: Users,
  network_health_score: Target,
  stockout_risk_retailers: Store,
  avg_sell_through: TrendingUp,
  retail_order_frequency: Calendar,
};

function KPICard({ id, label, value, growth, growthLabel, sub, spark, color, isProgress, progress }) {
  const c = KPI_PALETTE[color];
  const Icon = KPI_ICONS[id] || BarChart3;
  const hasGrowth = growth != null && !isProgress;
  const up = (growth ?? 0) >= 0;
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-100 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] hover:-translate-y-0.5 transition-all" data-testid={`dic-kpi-${id}`}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0"
             style={{ background: c.bg, color: c.fg }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-[10.5px] font-semibold text-slate-500 leading-tight">{label}</div>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[20px] font-bold text-slate-900 tabular-nums tracking-tight">{value}</div>
        {hasGrowth && (
          <span className={`text-[10.5px] font-bold tabular-nums inline-flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {growthLabel || fmtPct(growth)}
          </span>
        )}
      </div>
      {isProgress && (
        <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: c.fg }} />
        </div>
      )}
      {!isProgress && spark && (
        <Sparkline points={spark} color={c.fg} />
      )}
      <div className="text-[10px] text-slate-400 mt-1.5">{sub}</div>
    </div>
  );
}

function Sparkline({ points, color }) {
  if (!points || points.length < 2) return <div className="h-6" />;
  const w = 200, h = 24;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const gradId = `dic-spark-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 mt-1.5" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ============================================================================
// AI Executive Summary — purple gradient with circular gauge
// ============================================================================
function AIExecSummary({ brief }) {
  const score = brief.score.value;
  const status = brief.score.status;
  const r = 38, c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  const ringColor = score >= 80 ? "#34D399" : score >= 60 ? "#FBBF24" : "#F87171";
  return (
    <div
      className="relative overflow-hidden rounded-2xl text-white shadow-[0_20px_50px_-15px_rgba(109,40,217,0.5)]"
      data-testid="dic-ai-summary"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#4C1D95] via-[#6D28D9] to-[#7C3AED]" />
      <div className="absolute -top-24 -right-24 h-[260px] w-[260px] rounded-full bg-fuchsia-400/20 blur-3xl" />
      <div className="relative p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-amber-200" />
          <h2 className="text-[14.5px] font-semibold">AI Executive Summary</h2>
        </div>
        <ul className="space-y-2 text-[12px] text-white/90 mb-4">
          {brief.insights.slice(0, 5).map((insight, i) => (
            <li key={i} className="flex items-start gap-2" data-testid={`dic-insight-${i}`}>
              <span className="text-amber-200 mt-1 flex-shrink-0">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
        <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/60 mb-1">Network Health</div>
            <div className="text-[10px] text-white/70 mb-2">Gauge</div>
          </div>
          <div className="relative h-[90px] w-[90px] flex-shrink-0">
            <svg viewBox="0 0 96 96" className="w-full h-full -rotate-90">
              <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="6" />
              <circle cx="48" cy="48" r={r} fill="none" stroke={ringColor} strokeWidth="6"
                strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[22px] font-bold leading-none">{score}</div>
              <div className="text-[9px] text-white/70 mt-0.5">/ 100</div>
              <div className="text-[9px] font-bold text-emerald-200 mt-1">{status}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Retail Performance Matrix — 2x2 with quadrant tints + scatter bubbles
// ============================================================================
function RetailPerformanceMatrix({ items }) {
  const W = 460, H = 320, PADX = 18, PADY = 18;
  const xs = items.map(i => i.revenue_90d);
  const xMax = Math.max(...xs, 1);
  const xScale = (v) => Math.sqrt(Math.max(v, 0) / xMax);
  const yClamp = (g) => Math.max(Math.min(g ?? 0, 200), -50);
  const yNorm = (g) => (yClamp(g) + 50) / 250;

  const growthSpread = (() => {
    const gs = items.map(p => yClamp(p.growth_pct));
    return Math.max(...gs) - Math.min(...gs);
  })();
  const useRankFallback = growthSpread < 10;
  const revRank = (() => {
    const sorted = [...items].sort((a, b) => b.revenue_90d - a.revenue_90d);
    const m = {};
    sorted.forEach((p, i) => { m[p.id] = i; });
    return m;
  })();

  const HEALTH_FILL = { healthy: "#10B981", watch: "#F59E0B", risk: "#EF4444" };

  // Bubble size by revenue
  const rMin = 5, rMax = 14;
  const rScale = (v) => rMin + Math.sqrt(Math.max(v, 0) / xMax) * (rMax - rMin);

  const points = items.map(p => {
    let cy;
    if (useRankFallback) {
      const r = revRank[p.id];
      const norm = items.length > 1 ? r / (items.length - 1) : 0.5;
      cy = PADY + 30 + norm * (H * 0.45);
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
  // Force-directed non-overlap
  for (let it = 0; it < 50; it++) {
    let moved = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i], b = points[j];
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
      points[i].cx = Math.max(PADX + points[i].r, Math.min(W - PADX - points[i].r, points[i].cx));
      points[i].cy = Math.max(PADY + points[i].r, Math.min(H - PADY - points[i].r, points[i].cy));
    }
    if (moved === 0) break;
  }

  const [hover, setHover] = useState(null);

  // Quadrant counts
  const counts = {
    stars: points.filter(p => p.quadrant === "stars").length,
    growth_opps: points.filter(p => p.quadrant === "growth_opps").length,
    cash_cows: points.filter(p => p.quadrant === "cash_cows").length,
    at_risk: points.filter(p => p.quadrant === "at_risk").length,
  };

  return (
    <div className="col-span-12 lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-performance-matrix">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h3 className="text-[15px] font-semibold text-slate-900">Retail Performance Matrix</h3>
        <div className="flex items-center gap-2.5">
          <div className="hidden md:flex items-center gap-3 text-[10px] text-slate-600">
            {["healthy", "watch", "risk"].map(k => (
              <div key={k} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_FILL[k] }} />
                <span>{HEALTH_PALETTE[k].label}</span>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-slate-500 font-medium border border-slate-200 rounded-lg px-2 py-1">
            Revenue vs Growth
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="absolute left-0 top-0 h-full w-7 flex flex-col items-end justify-between text-[9px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-1">
          <span>High</span>
          <span className="-rotate-90 whitespace-nowrap py-2">Growth</span>
          <span>Low</span>
        </div>
        <div className="ml-7">
          <div className="relative rounded-xl overflow-hidden border border-slate-100" style={{ aspectRatio: `${W}/${H}` }}>
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
              <QuadrantTint name="Growth Opportunities" sub1="High Growth · Low Revenue" color="emerald" count={counts.growth_opps} pos="top-left" />
              <QuadrantTint name="Stars" sub1="High Growth · High Revenue" color="violet" count={counts.stars} pos="top-right" />
              <QuadrantTint name="At Risk" sub1="Low Growth · Low Revenue" color="rose" count={counts.at_risk} pos="bottom-left" />
              <QuadrantTint name="Cash Cows" sub1="Low Growth · High Revenue" color="blue" count={counts.cash_cows} pos="bottom-right" />
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
              <line x1={W / 2} y1={PADY} x2={W / 2} y2={H - PADY} stroke="#CBD5E1" strokeWidth="0.8" strokeDasharray="3 3" />
              <line x1={PADX} y1={H / 2} x2={W - PADX} y2={H / 2} stroke="#CBD5E1" strokeWidth="0.8" strokeDasharray="3 3" />
              {points.map(p => {
                const fill = HEALTH_FILL[p.health] || HEALTH_FILL.healthy;
                const isH = hover?.id === p.id;
                return (
                  <g key={p.id} style={{ cursor: "pointer" }}
                     onMouseEnter={() => setHover(p)}
                     onMouseLeave={() => setHover(null)}
                  >
                    {isH && <circle cx={p.cx} cy={p.cy} r={p.r + 4} fill="none" stroke={fill} strokeWidth="1.3" opacity="0.45" />}
                    <circle cx={p.cx} cy={p.cy} r={p.r}
                      fill={fill} fillOpacity="0.85"
                      stroke="white" strokeWidth="1.5"
                      className="transition-all" />
                  </g>
                );
              })}
            </svg>
            {hover && (
              <div className="absolute z-10 pointer-events-none animate-fade-rise"
                style={{
                  left: `${(hover.cx / W) * 100}%`,
                  top: `${(hover.cy / H) * 100}%`,
                  transform: `translate(${hover.cx > W / 2 ? "calc(-100% - 14px)" : "14px"}, -50%)`,
                }}
              >
                <div className="rounded-xl bg-slate-900/95 text-white px-3.5 py-2.5 shadow-2xl text-[11px] tabular-nums w-[200px]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_FILL[hover.health] }} />
                    <div className="font-semibold text-[12.5px] leading-tight">{hover.name}</div>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    <div className="text-white/60">Revenue</div>
                    <div className="text-right font-semibold">{fmtMoneyFull(hover.revenue_90d)}</div>
                    <div className="text-white/60">Growth</div>
                    <div className={`text-right font-semibold ${(hover.growth_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(hover.growth_pct)}</div>
                    <div className="text-white/60">Units</div>
                    <div className="text-right font-semibold">{fmtInt(hover.units_90d)}</div>
                    <div className="text-white/60">Health</div>
                    <div className="text-right font-semibold capitalize">{HEALTH_PALETTE[hover.health]?.label || hover.health}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-1.5">
            <span>Low</span>
            <span className="text-slate-500">Revenue (90D)</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuadrantTint({ name, sub1, color, count, pos }) {
  const colorMap = {
    violet: "bg-violet-50/40 text-violet-700",
    emerald: "bg-emerald-50/40 text-emerald-700",
    blue: "bg-blue-50/40 text-blue-700",
    rose: "bg-rose-50/40 text-rose-700",
  };
  const align = {
    "top-left":     "items-start text-left p-3",
    "top-right":    "items-end   text-right p-3",
    "bottom-left":  "items-start text-left p-3 self-end",
    "bottom-right": "items-end   text-right p-3 self-end",
  };
  const [bg, text] = colorMap[color].split(" ");
  return (
    <div className={`relative ${bg} border-r border-b border-slate-100 last:border-r-0 [&:nth-child(odd)]:border-r [&:nth-last-child(-n+2)]:border-b-0`}>
      <div className={`absolute inset-0 flex flex-col ${align[pos]}`}>
        <div className={`text-[11px] font-bold ${text}`}>{name}</div>
        <div className="text-[9px] text-slate-500 leading-tight mt-0.5">{sub1}</div>
        <div className={`text-[10.5px] font-semibold ${text} mt-1`}>{count} retailers</div>
      </div>
    </div>
  );
}

// ============================================================================
// Retail Coverage Map — bubbles per city
// ============================================================================
function RetailCoverageMap({ rows }) {
  // Layout cities in a grid for simple readability (top → bottom by revenue)
  if (rows.length === 0) {
    return (
      <div className="col-span-12 lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-coverage-map">
        <h3 className="text-[15px] font-semibold text-slate-900 mb-3">Retail Coverage Map</h3>
        <div className="text-center text-slate-400 py-12 text-[12px]">No retailer cities recorded.</div>
      </div>
    );
  }

  const maxRev = Math.max(...rows.map(r => r.revenue_90d), 1);
  // Position bubbles in a 3-col grid
  const W = 460, H = 320;
  const positions = rows.map((r, i) => {
    const cols = 3;
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...r,
      cx: 80 + col * 130 + (row % 2 ? 30 : 0),
      cy: 70 + row * 100,
      r: 18 + (r.revenue_90d / maxRev) * 36,
    };
  });
  const [hover, setHover] = useState(null);

  return (
    <div className="col-span-12 lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-coverage-map">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Retail Coverage Map</h3>
        <div className="flex items-center gap-2 text-[10px] text-slate-600">
          {["excellent", "good", "fair", "poor", "critical"].map(k => (
            <div key={k} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_PALETTE[k].dot }} />
              <span>{HEALTH_PALETTE[k].label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="xMidYMid meet">
          <rect x="0" y="0" width={W} height={H} fill="#F8FAFC" rx="12" />
          {positions.map(p => {
            const fill = HEALTH_PALETTE[p.band]?.dot || "#94A3B8";
            const isH = hover?.city === p.city;
            return (
              <g key={p.city} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
                 style={{ cursor: "pointer" }}>
                <circle cx={p.cx} cy={p.cy} r={p.r} fill={fill} fillOpacity={isH ? 0.85 : 0.65}
                  stroke={fill} strokeWidth="1.5" className="transition-all" />
                <text x={p.cx} y={p.cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
                  {p.city.length > 8 ? p.city.slice(0, 7) + "…" : p.city}
                </text>
                <text x={p.cx} y={p.cy + p.r + 14} textAnchor="middle" fontSize="9.5" fill="#475569">
                  {p.retailer_count} retailer{p.retailer_count === 1 ? "" : "s"}
                </text>
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="absolute top-2 left-2 px-3 py-2 rounded-lg bg-slate-900/95 text-white text-[11px] shadow-2xl pointer-events-none">
            <div className="font-semibold text-[12.5px]">{hover.city}</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 mt-1">
              <div className="text-white/60">Revenue</div><div className="text-right tabular-nums font-semibold">{fmtMoneyFull(hover.revenue_90d)}</div>
              <div className="text-white/60">Retailers</div><div className="text-right tabular-nums font-semibold">{hover.retailer_count}</div>
              <div className="text-white/60">Units (90D)</div><div className="text-right tabular-nums font-semibold">{fmtInt(hover.units_90d)}</div>
              <div className="text-white/60">Stockout risk</div><div className="text-right tabular-nums font-semibold">{hover.stockout_risk}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Top Performers + Needs Attention
// ============================================================================
function TopPerformers({ rows }) {
  return (
    <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-top-performers">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Top Performing Retailers</h3>
        <Link to="#" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View All →</Link>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
            <th className="text-left pb-2">Retailer</th>
            <th className="text-right pb-2">Revenue</th>
            <th className="text-right pb-2">Growth</th>
            <th className="text-right pb-2 pl-3">Health</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <tr><td colSpan={4} className="text-center text-slate-400 py-6 text-[11px]">No retailers with revenue yet.</td></tr>
          )}
          {rows.map(r => {
            const h = HEALTH_PALETTE[r.health] || HEALTH_PALETTE.healthy;
            const up = (r.growth_pct ?? 0) >= 0;
            return (
              <tr key={r.id} className="hover:bg-slate-50/60" data-testid={`dic-top-${r.id}`}>
                <td className="py-2.5 font-medium text-slate-900 truncate max-w-[200px]">{r.name}</td>
                <td className="py-2.5 text-right tabular-nums">{fmtMoney(r.revenue_90d)}</td>
                <td className={`py-2.5 text-right tabular-nums font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                  {fmtPct(r.growth_pct)}
                </td>
                <td className="py-2.5 pl-3 text-right">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${h.bg} ${h.text}`}>
                    {h.label === "Healthy" ? "Excellent" : h.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NeedsAttention({ rows }) {
  return (
    <div className="col-span-12 lg:col-span-6 bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-needs-attention">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Retailers Requiring Attention</h3>
        <Link to="#" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">Review All →</Link>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
            <th className="text-left pb-2">Retailer</th>
            <th className="text-left pb-2">Issue</th>
            <th className="text-right pb-2 pl-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <tr><td colSpan={3} className="text-center text-slate-400 py-6 text-[11px]">No retailers need attention.</td></tr>
          )}
          {rows.map(r => {
            const isRisk = r.status === "At Risk";
            return (
              <tr key={r.id} className="hover:bg-slate-50/60" data-testid={`dic-attn-${r.id}`}>
                <td className="py-2.5 font-medium text-slate-900 truncate max-w-[180px]">{r.name}</td>
                <td className="py-2.5 text-slate-600">{r.issue}</td>
                <td className="py-2.5 pl-3 text-right">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isRisk ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Product Penetration Analytics
// ============================================================================
function ProductPenetration({ rows }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-product-penetration">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Product Penetration Analytics</h3>
        <Link to="/product-intelligence" className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">Full catalog →</Link>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
            <th className="text-left pb-2">Product</th>
            <th className="text-right pb-2">Retailers Carrying</th>
            <th className="text-left pb-2 pl-6 w-[40%]">Coverage</th>
            <th className="text-right pb-2 pl-3">Performance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <tr><td colSpan={4} className="text-center text-slate-400 py-6 text-[11px]">No product penetration data yet.</td></tr>
          )}
          {rows.map(r => {
            const perfChip = r.performance === "Excellent" ? "bg-emerald-50 text-emerald-700"
                          : r.performance === "Good" ? "bg-emerald-50 text-emerald-700"
                          : r.performance === "Fair" ? "bg-amber-50 text-amber-700"
                          : "bg-rose-50 text-rose-700";
            return (
              <tr key={r.product_id} className="hover:bg-slate-50/60" data-testid={`dic-product-${r.product_id}`}>
                <td className="py-2.5 font-medium text-slate-900 truncate">{r.product_name}</td>
                <td className="py-2.5 text-right tabular-nums">{r.retailers_carrying}</td>
                <td className="py-2.5 pl-6">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#6D28D9] to-[#8B5CF6]"
                        style={{ width: `${r.coverage_pct}%` }} />
                    </div>
                    <span className="text-[11px] tabular-nums font-semibold text-slate-700 w-9 text-right">{r.coverage_pct}%</span>
                  </div>
                </td>
                <td className="py-2.5 pl-3 text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${perfChip}`}>
                    {r.performance}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Retailer Intelligence Table — search/filter/export
// ============================================================================
function RetailerIntelligenceTable({ rows }) {
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [sortKey, setSortKey] = useState("revenue_90d");
  const [sortDir, setSortDir] = useState("desc");

  const filtered = useMemo(() => {
    let r = rows;
    if (healthFilter !== "all") r = r.filter(x => x.health === healthFilter);
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(x => x.name.toLowerCase().includes(q) || (x.city || "").toLowerCase().includes(q));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [rows, query, healthFilter, sortKey, sortDir]);

  const toggleSort = (k) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const sortInd = (k) => sortKey === k ? <span className="text-violet-500">{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  const exportCsv = () => {
    const header = ["Retailer", "City", "Type", "Revenue90D", "Growth%", "StockValue", "SellThrough%", "LastOrder", "HealthScore", "Health"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push([
        `"${r.name.replace(/"/g, '""')}"`, r.city, r.retail_type, r.revenue_90d,
        r.growth_pct ?? "", r.stock_value, r.sell_through_pct,
        r.last_order_date || "", r.health_score, r.health,
      ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `retailer-intelligence-${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100" data-testid="dic-retailer-table">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Retailer Intelligence Table</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search retailers..."
              className="h-9 pl-9 pr-3 w-[240px] rounded-xl border border-slate-200 bg-slate-50 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200"
              data-testid="dic-search"
            />
          </div>
          <select value={healthFilter} onChange={e => setHealthFilter(e.target.value)}
            className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700"
            data-testid="dic-filter"
          >
            <option value="all">All Health</option>
            <option value="healthy">Healthy</option>
            <option value="watch">Watch</option>
            <option value="risk">At Risk</option>
          </select>
          <button onClick={exportCsv}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50"
            data-testid="dic-export"
          >
            <Download className="h-3 w-3" /> Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="text-left pb-2">Retailer</th>
              <th className="text-left pb-2">Location</th>
              <th className="text-left pb-2">Type</th>
              <th className="text-right pb-2 cursor-pointer" onClick={() => toggleSort("revenue_90d")}>Revenue (90D) {sortInd("revenue_90d")}</th>
              <th className="text-right pb-2 cursor-pointer" onClick={() => toggleSort("growth_pct")}>Growth {sortInd("growth_pct")}</th>
              <th className="text-right pb-2">Sell Through</th>
              <th className="text-right pb-2">Last Order</th>
              <th className="text-right pb-2 cursor-pointer" onClick={() => toggleSort("health_score")}>Health {sortInd("health_score")}</th>
              <th className="text-right pb-2 pl-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center text-slate-400 py-12 text-[11px]">No retailers match your filter.</td></tr>
            )}
            {filtered.map(r => {
              const h = HEALTH_PALETTE[r.health] || HEALTH_PALETTE.healthy;
              const up = (r.growth_pct ?? 0) >= 0;
              return (
                <tr key={r.id} className="hover:bg-slate-50/60 group" data-testid={`dic-retailer-${r.id}`}>
                  <td className="py-2.5 font-semibold text-slate-900 truncate max-w-[200px]">{r.name}</td>
                  <td className="py-2.5 text-slate-600">{r.city}</td>
                  <td className="py-2.5 text-slate-600">{r.retail_type}</td>
                  <td className="py-2.5 text-right tabular-nums">{fmtMoney(r.revenue_90d)}</td>
                  <td className={`py-2.5 text-right tabular-nums font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>{fmtPct(r.growth_pct)}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.sell_through_pct}%</td>
                  <td className="py-2.5 text-right text-slate-500">{r.last_order_date ? fmtDate(r.last_order_date) : "—"}</td>
                  <td className="py-2.5 text-right">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${h.bg} ${h.text}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} />
                      {r.health_score}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    <button className="inline-flex h-7 w-7 rounded-lg bg-slate-50 hover:bg-violet-50 items-center justify-center group-hover:bg-violet-100 transition-colors">
                      <ArrowRight className="h-3 w-3 text-slate-400 group-hover:text-violet-600" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
