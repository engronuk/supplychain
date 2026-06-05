/**
 * Distributor Network Intelligence Center — manufacturer view.
 *
 * Pixel-perfect Fortune-500 layout following the user-uploaded mock:
 *   1. Breadcrumb + title + search/filters/export bar
 *   2. 6 hero KPI cards with sparklines
 *   3. Distributor Performance Matrix (bubble) + Regional Coverage Nigeria map
 *      + AI Network Summary (purple gradient)
 *   4. Top Distributor Overview — 5 horizontal spotlight cards
 *   5. All Distributors master table + Retail Network Reach + Distributors
 *      Requiring Attention (3-column lower row)
 *
 * Backend: GET /api/manufacturer/{id}/distributor-network-intelligence
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { useCachedFetch, setCached as setDataCache } from "@/lib/dataCache";
import { RefreshPill } from "@/components/RefreshPill";
import { toast } from "sonner";
import {
  Search, Filter, Download, ChevronRight, ChevronLeft, ArrowRight,
  Building2, Users, Coins, Package, Gauge, AlertTriangle,
  Sparkles, TrendingUp, TrendingDown, ExternalLink,
  Loader2, Info,
} from "lucide-react";
import { STATE_PATHS } from "@/lib/nigeriaStates";

// ---------- formatters ------------------------------------------------------
const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtUnits = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtPct = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;
const fmtDate = (v) => v
  ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";
const titleCase = (s) => (s || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// ============================================================================
// MAIN VIEW
// ============================================================================
export default function ManufacturerNetworkIntelligence() {
  const { session } = useSession();
  const entityId = session?.entity?.id;
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({ region: "all", health: "all", status: "all" });
  const [refreshing, setRefreshing] = useState(false);

  const cacheKey = entityId ? `dist-net:${entityId}` : null;
  const { data, loading, reload } = useCachedFetch(
    cacheKey,
    () => Api.manufacturerDistributorNetworkIntelligence(entityId),
    [entityId],
  );

  const onRefresh = async () => {
    if (!entityId) return;
    setRefreshing(true);
    try {
      const fresh = await Api.refreshDistributorNetwork(entityId);
      setDataCache(cacheKey, fresh);
      reload();
      toast.success("Refreshed");
    } catch (err) {
      toast.error("Could not refresh");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]" data-testid="distributor-network-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading network intelligence…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="distributor-network-view">
      <div className="px-8 py-7 max-w-[1840px] mx-auto space-y-6">
        <Breadcrumb />
        <PageHeader
          query={q} onQuery={setQ}
          filters={filters} onFilters={setFilters}
          tableRows={data.distributors_table}
          asOf={data?._snapshot?.as_of}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        <KPIStrip kpis={data.kpis} />

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-5">
            <PerformanceMatrix points={data.performance_matrix} />
          </div>
          <div className="col-span-12 xl:col-span-4">
            <RegionalCoverage rows={data.regional_coverage} />
          </div>
          <div className="col-span-12 xl:col-span-3">
            <AINetworkSummary insights={data.ai_brief} />
          </div>
        </div>

        <Spotlight items={data.spotlight} />

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-7">
            <DistributorsTable rows={data.distributors_table} query={q} filters={filters} />
          </div>
          <div className="col-span-12 xl:col-span-3">
            <RetailReach rows={data.retail_reach} />
          </div>
          <div className="col-span-12 xl:col-span-2">
            <AtRiskPanel rows={data.at_risk} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// BREADCRUMB + HEADER
// ============================================================================
function Breadcrumb() {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-slate-500 font-semibold tracking-wider uppercase" data-testid="network-breadcrumb">
      <span>Distributors</span>
      <ChevronRight className="h-3 w-3 text-slate-300" />
      <span className="text-slate-700">Network Intelligence</span>
    </div>
  );
}

function PageHeader({ query, onQuery, filters, onFilters, tableRows, asOf, onRefresh, refreshing }) {
  const [filterOpen, setFilterOpen] = useState(false);

  const exportCsv = () => {
    const header = ["Distributor", "Region", "City", "Revenue (90D)", "Retailers",
                    "Inventory Units", "Orders (90D)", "Sell-through %", "Health Score",
                    "Health Band", "Last Shipment", "Status"];
    const rows = tableRows.map((r) => [
      r.name, r.region, r.city || "", r.revenue_90d, r.retailers_total,
      r.inventory_units, r.orders_90d, r.sell_through_pct, r.health_score,
      r.health_band, r.last_shipment || "", r.status,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `distributor-network-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const setF = (k, v) => onFilters({ ...filters, [k]: v });
  const activeFilterCount = Object.values(filters).filter((v) => v !== "all").length;

  return (
    <div className="flex items-end justify-between gap-4 flex-wrap" data-testid="network-header">
      <div className="min-w-0">
        <h1 className="text-[34px] font-bold tracking-tight text-slate-900 leading-none">
          Distributor Network Intelligence
        </h1>
        <p className="text-[12.5px] text-slate-500 mt-2 max-w-3xl">
          Monitor distributor performance, retailer penetration, inventory coverage
          and regional contribution across your network.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RefreshPill asOf={asOf} onRefresh={onRefresh} busy={refreshing} testId="network-refresh-pill" />
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search distributors…"
            className="h-10 pl-9 pr-3 w-[260px] rounded-xl border border-slate-200 bg-white text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
            data-testid="network-search"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            data-testid="network-filters-btn"
          >
            <Filter className="h-3.5 w-3.5 text-slate-500" /> Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-violet-600 text-white text-[9.5px] font-bold tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>
          {filterOpen && (
            <FilterPopover
              filters={filters}
              setF={setF}
              onReset={() => onFilters({ region: "all", health: "all", status: "all" })}
              onClose={() => setFilterOpen(false)}
            />
          )}
        </div>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          data-testid="network-export-btn"
        >
          <Download className="h-3.5 w-3.5 text-slate-500" /> Export
        </button>
      </div>
    </div>
  );
}

function FilterPopover({ filters, setF, onReset, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="absolute right-0 top-12 z-40 w-[280px] rounded-xl bg-white shadow-[0_18px_50px_-12px_rgba(15,23,42,0.18)] border border-slate-100 p-4"
        data-testid="network-filters-popover"
      >
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
          Refine view
        </div>
        <FilterRow label="Region" value={filters.region} onChange={(v) => setF("region", v)}
          options={[
            { v: "all", l: "All regions" },
            { v: "North West", l: "North West" }, { v: "North East", l: "North East" },
            { v: "North Central", l: "North Central" },
            { v: "South West", l: "South West" }, { v: "South East", l: "South East" },
            { v: "South South", l: "South South" },
          ]}
          testId="filter-region"
        />
        <FilterRow label="Health Score" value={filters.health} onChange={(v) => setF("health", v)}
          options={[
            { v: "all", l: "Any" },
            { v: "excellent", l: "Excellent" }, { v: "good", l: "Good" },
            { v: "fair", l: "Fair" }, { v: "poor", l: "Poor" }, { v: "critical", l: "Critical" },
          ]}
          testId="filter-health"
        />
        <FilterRow label="Status" value={filters.status} onChange={(v) => setF("status", v)}
          options={[
            { v: "all", l: "Any" },
            { v: "active", l: "Active" }, { v: "pending", l: "Pending" }, { v: "inactive", l: "Inactive" },
          ]}
          testId="filter-status"
        />
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
          <button onClick={onReset} className="text-[11.5px] font-semibold text-slate-500 hover:text-slate-700" data-testid="filter-reset">Reset</button>
          <button onClick={onClose} className="px-3 h-8 rounded-lg bg-violet-600 text-white text-[11.5px] font-semibold hover:bg-violet-700" data-testid="filter-apply">Apply</button>
        </div>
      </div>
    </>
  );
}

function FilterRow({ label, value, onChange, options, testId }) {
  return (
    <div className="mb-3">
      <div className="text-[10.5px] font-semibold text-slate-600 mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
        data-testid={testId}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

// ============================================================================
// KPI STRIP — 6 cards
// ============================================================================
const PALETTE = {
  indigo:  { bg: "#EEF2FF", fg: "#4F46E5" },
  cyan:    { bg: "#ECFEFF", fg: "#0E7490" },
  emerald: { bg: "#ECFDF5", fg: "#047857" },
  amber:   { bg: "#FFFBEB", fg: "#B45309" },
  teal:    { bg: "#F0FDFA", fg: "#0F766E" },
  rose:    { bg: "#FFF1F2", fg: "#BE123C" },
};

function KPIStrip({ kpis }) {
  const cards = [
    { id: "active_distributors", label: "Active Distributors",
      value: fmtInt(kpis.active_distributors?.value),
      icon: Building2, color: "indigo", k: "active_distributors" },
    { id: "retailers_served", label: "Retailers Served",
      value: fmtInt(kpis.retailers_served?.value),
      icon: Users, color: "cyan", k: "retailers_served" },
    { id: "network_revenue", label: "Network Revenue",
      value: fmtMoney(kpis.network_revenue_90d?.value),
      icon: Coins, color: "emerald", k: "network_revenue_90d" },
    { id: "inventory", label: "Inventory in Network",
      value: `${fmtUnits(kpis.inventory_units?.value)}`, valueSuffix: "Units",
      icon: Package, color: "amber", k: "inventory_units" },
    { id: "sell_through", label: "Avg. Sell-through Rate",
      value: `${Math.round(kpis.avg_sell_through?.value || 0)}%`,
      icon: Gauge, color: "teal", k: "avg_sell_through" },
    { id: "at_risk", label: "At-Risk Distributors",
      value: fmtInt(kpis.at_risk?.value),
      icon: AlertTriangle, color: "rose", k: "at_risk" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="network-kpis">
      {cards.map((c) => (
        <KPICard key={c.id} {...c} payload={kpis[c.k]} />
      ))}
    </div>
  );
}

function KPICard({ id, label, value, valueSuffix, icon: Icon, color, payload }) {
  const c = PALETTE[color];
  const growth = payload?.growth_pct ?? null;
  const up = growth != null && growth >= 0;
  return (
    <div
      className="group bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 transition-all duration-300 border border-slate-100/70"
      data-testid={`kpi-${id}`}
    >
      <div className="flex items-start justify-between">
        <div
          className="h-9 w-9 rounded-xl flex items-center justify-center"
          style={{ background: c.bg, color: c.fg }}
        >
          <Icon className="h-4 w-4" />
        </div>
        {growth != null && (
          <span className={`text-[10.5px] font-bold tabular-nums inline-flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
            {fmtPct(growth)} vs last month
          </span>
        )}
      </div>
      <div className="text-[11px] font-semibold text-slate-500 mt-4 leading-tight">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-1">
        <div className="text-[28px] font-bold text-slate-900 tabular-nums leading-none">
          {value}
        </div>
        {valueSuffix && <div className="text-[12px] font-semibold text-slate-500">{valueSuffix}</div>}
      </div>
      {payload?.spark && payload.spark.length > 1 && (
        <SparkLine points={payload.spark} color={c.fg} />
      )}
    </div>
  );
}

function SparkLine({ points, color }) {
  const w = 220, h = 28;
  const max = Math.max(...points, 1), min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const id = color.replace("#", "");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 mt-3" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ============================================================================
// PERFORMANCE MATRIX (bubble scatter)
// ============================================================================
const HEALTH_FILL = {
  excellent: "#10B981",
  good: "#3B82F6",
  fair: "#F59E0B",
  poor: "#EF4444",
  critical: "#DC2626",
};

// ============================================================================
// DISTRIBUTOR PORTFOLIO MATRIX — executive 2x2 strategic dashboard
// ============================================================================
const QUADRANT_META = {
  stars: {
    title: "Stars",
    bg: "#F5F3FF",
    border: "#DDD6FE",
    text: "#6D28D9",
    description: "High penetration · High revenue",
  },
  growth_opps: {
    title: "Growth Candidates",
    bg: "#F0FDF4",
    border: "#BBF7D0",
    text: "#15803D",
    description: "High penetration · Low revenue",
  },
  cash_cows: {
    title: "Cash Cows",
    bg: "#FFFBEB",
    border: "#FEF3C7",
    text: "#B45309",
    description: "Low penetration · High revenue",
  },
  at_risk: {
    title: "Underperformers",
    bg: "#FEF2F2",
    border: "#FECACA",
    text: "#B91C1C",
    description: "Low penetration · Low revenue",
  },
};

const HEALTH_DOT = {
  excellent: "#5B21B6",
  good:      "#2563EB",
  fair:      "#F59E0B",
  poor:      "#F97316",
  critical:  "#DC2626",
};
const HEALTH_LABEL = {
  excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor", critical: "Critical",
};

function _fmtMoney(v) {
  if (!v) return "₦0";
  if (v >= 1_000_000_000) return `₦${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₦${(v / 1_000).toFixed(1)}K`;
  return `₦${Math.round(v)}`;
}

function PerformanceMatrix({ points }) {
  const W = 540, H = 420, PAD_L = 44, PAD_R = 18, PAD_T = 18, PAD_B = 38;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;
  const [hovered, setHovered] = useState(null);

  // Sort by revenue desc for stable z-order + lists
  const list = [...(points || [])].sort((a, b) => b.revenue_90d - a.revenue_90d);

  const xMax = Math.max(...list.map((p) => p.revenue_90d), 1);
  const yMax = Math.max(...list.map((p) => p.penetration_pct), 1);
  const revMin = Math.min(...list.map((p) => p.revenue_90d), 0);
  const revMax = Math.max(...list.map((p) => p.revenue_90d), 1);

  // Sqrt scaling tames revenue outliers without compressing small bubbles too far.
  const xScale = (v) => Math.sqrt(Math.max(v, 0) / xMax);
  const yScale = (v) => Math.max(v, 0) / Math.max(yMax, 1);
  const rScale = (v) => 16 + Math.sqrt((v - revMin) / Math.max(revMax - revMin, 1)) * 22;

  const positioned = list.map((p) => ({
    ...p,
    cx: PAD_L + xScale(p.revenue_90d) * PLOT_W,
    cy: PAD_T + (1 - yScale(p.penetration_pct)) * PLOT_H,
    r: rScale(p.revenue_90d),
  }));

  // Anti-overlap nudging.
  for (let it = 0; it < 120; it++) {
    let moved = 0;
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i], b = positioned[j];
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 0.01;
        const target = a.r + b.r + 4;
        if (dist < target) {
          const push = (target - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          a.cx -= ux * push; a.cy -= uy * push;
          b.cx += ux * push; b.cy += uy * push;
          moved++;
        }
      }
      positioned[i].cx = Math.max(PAD_L + positioned[i].r, Math.min(W - PAD_R - positioned[i].r, positioned[i].cx));
      positioned[i].cy = Math.max(PAD_T + positioned[i].r, Math.min(H - PAD_B - positioned[i].r, positioned[i].cy));
    }
    if (moved === 0) break;
  }

  // ---- Leader callouts ------------------------------------------------------
  const stars = list.filter((p) => p.quadrant === "stars").slice(0, 3);
  const growth = list.filter((p) => p.quadrant === "growth_opps").slice(0, 3);
  const attention = list.filter(
    (p) => p.quadrant === "at_risk" || ["poor", "critical"].includes(p.health_band),
  ).slice(0, 3);

  // ---- Executive insights ---------------------------------------------------
  const totalRev = list.reduce((s, p) => s + p.revenue_90d, 0) || 1;
  const insights = [];
  if (list.length) {
    const top = list[0];
    insights.push(
      `${top.name} contributes ${Math.round((top.revenue_90d / totalRev) * 100)}% of total distributor revenue.`,
    );
  }
  // Region with highest penetration mean
  const regionPen = new Map();
  list.forEach((p) => {
    if (!regionPen.has(p.region)) regionPen.set(p.region, []);
    regionPen.get(p.region).push(p.penetration_pct);
  });
  const regionLeader = [...regionPen.entries()]
    .map(([r, arr]) => [r, arr.reduce((a, b) => a + b, 0) / arr.length])
    .sort((a, b) => b[1] - a[1])[0];
  if (regionLeader) {
    insights.push(`${regionLeader[0]} distributors show the highest penetration (${Math.round(regionLeader[1])}% avg).`);
  }
  const underRev = list.filter((p) => p.quadrant === "growth_opps").length;
  if (underRev > 0) {
    insights.push(`${underRev} high-penetration distributor${underRev > 1 ? "s are" : " is"} underperforming in revenue.`);
  }
  const allocBoost = list.filter((p) => p.quadrant === "cash_cows" || p.quadrant === "stars").length;
  if (allocBoost > 0) {
    insights.push(`${allocBoost} distributor${allocBoost > 1 ? "s" : ""} should receive increased inventory allocation.`);
  }

  return (
    <div
      className="bg-white rounded-2xl p-6 shadow-[0_2px_12px_rgba(15,23,42,0.05)] border border-slate-100/70 h-full"
      data-testid="distributor-performance-matrix"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-[16px] font-bold text-slate-900 leading-tight">Distributor Portfolio Matrix</h3>
          <p className="text-[12px] text-slate-500 mt-1">Revenue Contribution vs Market Penetration</p>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-slate-500">
          <span className="font-semibold text-slate-400 uppercase tracking-wider">Health</span>
          {Object.entries(HEALTH_LABEL).map(([k, l]) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: HEALTH_DOT[k] }} />
              {l}
            </span>
          ))}
        </div>
      </div>

      {/* Chart + side panel */}
      <div className="grid grid-cols-12 gap-5">
        {/* Chart area */}
        <div className="col-span-12 lg:col-span-9 relative">
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" data-testid="matrix-canvas">
              <defs>
                <filter id="bubble-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity="0.18" />
                </filter>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#F1F5F9" strokeWidth="0.6" />
                </pattern>
              </defs>

              {/* Quadrant tints */}
              <rect x={PAD_L} y={PAD_T} width={PLOT_W / 2} height={PLOT_H / 2} fill={QUADRANT_META.growth_opps.bg} />
              <rect x={PAD_L + PLOT_W / 2} y={PAD_T} width={PLOT_W / 2} height={PLOT_H / 2} fill={QUADRANT_META.stars.bg} />
              <rect x={PAD_L} y={PAD_T + PLOT_H / 2} width={PLOT_W / 2} height={PLOT_H / 2} fill={QUADRANT_META.at_risk.bg} />
              <rect x={PAD_L + PLOT_W / 2} y={PAD_T + PLOT_H / 2} width={PLOT_W / 2} height={PLOT_H / 2} fill={QUADRANT_META.cash_cows.bg} />

              {/* Grid */}
              <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} fill="url(#grid)" />

              {/* Midlines */}
              <line x1={PAD_L + PLOT_W / 2} y1={PAD_T} x2={PAD_L + PLOT_W / 2} y2={PAD_T + PLOT_H}
                stroke="#CBD5E1" strokeDasharray="4 4" strokeWidth="0.9" />
              <line x1={PAD_L} y1={PAD_T + PLOT_H / 2} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H / 2}
                stroke="#CBD5E1" strokeDasharray="4 4" strokeWidth="0.9" />

              {/* Outer frame */}
              <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} fill="none" stroke="#E2E8F0" strokeWidth="1" />

              {/* Quadrant labels (corners) */}
              <text x={PAD_L + 10} y={PAD_T + 18} fontSize="10.5" fontWeight="700" fill={QUADRANT_META.growth_opps.text}>
                GROWTH CANDIDATES
              </text>
              <text x={PAD_L + PLOT_W - 10} y={PAD_T + 18} fontSize="10.5" fontWeight="700"
                fill={QUADRANT_META.stars.text} textAnchor="end">
                STARS
              </text>
              <text x={PAD_L + 10} y={PAD_T + PLOT_H - 10} fontSize="10.5" fontWeight="700"
                fill={QUADRANT_META.at_risk.text}>
                UNDERPERFORMERS
              </text>
              <text x={PAD_L + PLOT_W - 10} y={PAD_T + PLOT_H - 10} fontSize="10.5" fontWeight="700"
                fill={QUADRANT_META.cash_cows.text} textAnchor="end">
                CASH COWS
              </text>

              {/* Axis labels */}
              <text x={PAD_L + PLOT_W / 2} y={H - 8} textAnchor="middle"
                fontSize="11" fontWeight="600" fill="#475569" letterSpacing="0.5">
                Revenue Generated (90 Days) →
              </text>
              <g transform={`translate(14 ${PAD_T + PLOT_H / 2}) rotate(-90)`}>
                <text textAnchor="middle" fontSize="11" fontWeight="600" fill="#475569" letterSpacing="0.5">
                  Retail Penetration →
                </text>
              </g>
              <text x={PAD_L} y={H - 22} fontSize="9.5" fill="#94A3B8">Low</text>
              <text x={PAD_L + PLOT_W} y={H - 22} fontSize="9.5" fill="#94A3B8" textAnchor="end">High</text>

              {/* Bubbles */}
              {positioned.map((p) => {
                const isHover = hovered === p.id;
                return (
                  <g
                    key={p.id}
                    onMouseEnter={() => setHovered(p.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer" }}
                    data-testid={`matrix-bubble-${p.id}`}
                  >
                    <circle cx={p.cx} cy={p.cy} r={p.r}
                      fill={HEALTH_DOT[p.health_band] || HEALTH_DOT.fair}
                      fillOpacity={isHover ? 0.95 : 0.82}
                      stroke="white" strokeWidth="2.5"
                      filter="url(#bubble-shadow)"
                      style={{
                        transition: "r 200ms ease, fill-opacity 200ms ease",
                        transform: isHover ? "scale(1.06)" : "scale(1)",
                        transformOrigin: `${p.cx}px ${p.cy}px`,
                      }}
                    />
                    <text x={p.cx} y={p.cy} textAnchor="middle" dominantBaseline="middle"
                      fontSize={Math.max(10, p.r * 0.42)} fontWeight="800"
                      fill="white" style={{ pointerEvents: "none", letterSpacing: 0.5 }}>
                      {p.initials || p.name.slice(0, 2).toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Tooltip */}
            {hovered && (() => {
              const p = positioned.find((q) => q.id === hovered);
              if (!p) return null;
              const pxX = (p.cx / W) * 100;
              const pxY = (p.cy / H) * 100;
              const above = pxY > 55;
              return (
                <div
                  className="absolute z-10 pointer-events-none -translate-x-1/2"
                  style={{
                    left: `${pxX}%`,
                    top: `calc(${pxY}% + ${above ? "-" : ""}${p.r * (H / 100) * (W / H) / 4 + 14}px)`,
                  }}
                  data-testid="matrix-tooltip"
                >
                  <div className="rounded-xl bg-slate-900 text-white text-[11px] shadow-xl px-3 py-2 min-w-[200px]">
                    <div className="font-bold text-[12px] mb-1 truncate">{p.name}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-300">
                      <span>Revenue</span><span className="text-right font-semibold text-white">{_fmtMoney(p.revenue_90d)}</span>
                      <span>Retailers</span><span className="text-right font-semibold text-white">{p.retailers_served} / {p.retailers_total}</span>
                      <span>Penetration</span><span className="text-right font-semibold text-white">{p.penetration_pct}%</span>
                      <span>Fill Rate</span><span className="text-right font-semibold text-white">{p.fill_rate_pct}%</span>
                      <span>Avg Order</span><span className="text-right font-semibold text-white">{_fmtMoney(p.avg_order_value)}</span>
                      <span>Growth</span><span className="text-right font-semibold text-white">{p.growth_pct == null ? "—" : `${p.growth_pct > 0 ? "+" : ""}${p.growth_pct.toFixed(1)}%`}</span>
                      <span>Grade</span><span className="text-right font-bold" style={{ color: HEALTH_DOT[p.health_band] }}>{p.grade}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {positioned.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">
                No distributor sales data yet.
              </div>
            )}
          </div>
        </div>

        {/* Side leader callouts */}
        <div className="col-span-12 lg:col-span-3 space-y-3">
          <LeaderList title="Top Stars" tone="star" items={stars} />
          <LeaderList title="Growth Opportunities" tone="growth" items={growth} />
          <LeaderList title="Needs Attention" tone="attention" items={attention} />
        </div>
      </div>

      {/* Executive Insights */}
      {insights.length > 0 && (
        <div className="mt-6 pt-5 border-t border-slate-100" data-testid="matrix-insights">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            <span className="text-[10.5px] font-bold text-violet-600 uppercase tracking-wider">Executive Insights</span>
          </div>
          <ul className="space-y-1.5">
            {insights.map((ins, i) => (
              <li key={i} className="text-[12.5px] text-slate-700 flex items-start gap-2">
                <span className="text-violet-400 mt-0.5">•</span>
                <span>{ins}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LeaderList({ title, tone, items }) {
  const accent = {
    star: { dot: "#7C3AED", bg: "bg-violet-50", border: "border-violet-100", text: "text-violet-700" },
    growth: { dot: "#10B981", bg: "bg-emerald-50", border: "border-emerald-100", text: "text-emerald-700" },
    attention: { dot: "#DC2626", bg: "bg-rose-50", border: "border-rose-100", text: "text-rose-700" },
  }[tone];

  return (
    <div className={`rounded-xl border ${accent.border} ${accent.bg} px-3 py-3`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent.dot }} />
        <span className={`text-[10.5px] font-bold uppercase tracking-wider ${accent.text}`}>{title}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[11px] text-slate-400 italic">No distributors in this segment.</div>
      ) : (
        <ol className="space-y-1.5">
          {items.map((p, idx) => (
            <li key={p.id} className="flex items-center gap-2 text-[11.5px] text-slate-700">
              <span className={`inline-flex h-4 w-4 rounded-full items-center justify-center text-[9px] font-bold ${accent.text}`}
                style={{ background: "white", border: `1px solid ${accent.dot}33` }}>
                {idx + 1}
              </span>
              <span className="truncate font-medium" title={p.name}>{p.name}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ============================================================================
// REGIONAL COVERAGE — Nigeria choropleth
// ============================================================================
const REGION_OF_STATE = {
  Lagos: "South West", Ogun: "South West", Oyo: "South West", Osun: "South West",
  Ondo: "South West", Ekiti: "South West",
  Enugu: "South East", Anambra: "South East", Imo: "South East", Abia: "South East", Ebonyi: "South East",
  Rivers: "South South", Delta: "South South", Edo: "South South", Bayelsa: "South South",
  "Cross River": "South South", "Akwa Ibom": "South South",
  Kano: "North West", Kaduna: "North West", Katsina: "North West", Kebbi: "North West",
  Sokoto: "North West", Zamfara: "North West", Jigawa: "North West",
  Borno: "North East", Yobe: "North East", Adamawa: "North East", Bauchi: "North East",
  Gombe: "North East", Taraba: "North East",
  Abuja: "North Central", FCT: "North Central", Niger: "North Central", Kwara: "North Central",
  Kogi: "North Central", Benue: "North Central", Nasarawa: "North Central", Plateau: "North Central",
};
const REGION_TINT = {
  "North West":   "#C7D2FE",
  "North East":   "#C4B5FD",
  "North Central":"#A7F3D0",
  "South West":   "#FBD5BC",
  "South East":   "#FCD3C2",
  "South South":  "#FBE0B7",
};
// Pre-computed centroid for each region (approximate, on the 0..650 × 0..650 viewBox of STATE_PATHS).
// These come from visual inspection of the rendered Nigeria SVG.
const REGION_CENTROIDS = {
  "North West":    { x: 200, y: 180 },
  "North East":    { x: 480, y: 200 },
  "North Central": { x: 340, y: 320 },
  "South West":    { x: 180, y: 450 },
  "South East":    { x: 380, y: 470 },
  "South South":   { x: 290, y: 540 },
};

function RegionalCoverage({ rows }) {
  const [sortBy, setSortBy] = useState("revenue");
  const byRegion = useMemo(() => {
    const m = {};
    rows.forEach((r) => { m[r.region] = r; });
    return m;
  }, [rows]);

  const maxRev = Math.max(...rows.map((r) => r.revenue_90d), 1);

  // Compute heatmap opacity per region from revenue
  const regionOpacity = (region) => {
    const r = byRegion[region];
    if (!r) return 0.45;
    return 0.45 + (r.revenue_90d / maxRev) * 0.55;
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="regional-coverage">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[15px] font-semibold text-slate-900">Regional Distributor Coverage</h3>
          <Info className="h-3.5 w-3.5 text-slate-300" />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
          data-testid="regional-sort"
        >
          <option value="revenue">Revenue</option>
          <option value="distributors">Distributors</option>
          <option value="retailers">Retailers</option>
        </select>
      </div>

      <div className="relative" style={{ aspectRatio: "1/1" }}>
        <svg viewBox="0 0 650 650" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          {STATE_PATHS.map((s) => {
            const region = REGION_OF_STATE[s.name] || "South West";
            const tint = REGION_TINT[region];
            return (
              <path
                key={s.name}
                d={s.d}
                fill={tint}
                fillOpacity={regionOpacity(region)}
                stroke="#FFFFFF"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>
        {/* Region tooltip cards */}
        {rows.map((r) => {
          const c = REGION_CENTROIDS[r.region];
          if (!c) return null;
          return (
            <div
              key={r.region}
              className="absolute pointer-events-none"
              style={{
                left: `${(c.x / 650) * 100}%`,
                top: `${(c.y / 650) * 100}%`,
                transform: "translate(-50%, -50%)",
              }}
              data-testid={`region-card-${r.region.toLowerCase().replace(/ /g, "-")}`}
            >
              <div className="bg-white rounded-md shadow-[0_2px_8px_rgba(15,23,42,0.12)] border border-slate-100 px-2 py-1.5 text-center whitespace-nowrap">
                <div className="text-[9.5px] font-bold text-slate-900 leading-none">{r.region}</div>
                <div className="text-[8px] text-slate-500 tabular-nums leading-tight mt-1">
                  {r.distributors} Distributors
                </div>
                <div className="text-[8px] text-amber-700 tabular-nums leading-tight font-semibold">
                  {fmtMoney(r.revenue_90d)} Revenue
                </div>
                <div className="text-[8px] text-slate-500 tabular-nums leading-tight">
                  {r.retailers} Retailers
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-3 flex-wrap text-[9.5px] text-slate-600">
        <span className="font-semibold text-slate-500">Health Score:</span>
        {[
          { k: "excellent", l: "Excellent" }, { k: "good", l: "Good" },
          { k: "fair", l: "Fair" }, { k: "poor", l: "Poor" }, { k: "critical", l: "Critical" },
        ].map((it) => (
          <span key={it.k} className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH_FILL[it.k] }} />
            <span className="font-medium">{it.l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// AI NETWORK SUMMARY (purple gradient)
// ============================================================================
function AINetworkSummary({ insights }) {
  const navigate = useNavigate();
  return (
    <div className="relative overflow-hidden rounded-2xl h-full shadow-[0_20px_50px_-15px_rgba(109,40,217,0.5)]" data-testid="ai-network-summary">
      <div className="absolute inset-0 bg-gradient-to-br from-[#4C1D95] via-[#6D28D9] to-[#7C3AED]" />
      <div className="absolute inset-0 opacity-[0.12] bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.6),transparent_45%)]" />
      <div className="absolute -top-24 -right-24 h-[260px] w-[260px] rounded-full bg-fuchsia-400/20 blur-3xl" />

      <div className="relative px-5 py-5 flex flex-col h-full">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-amber-200" />
          <h2 className="text-[14px] font-semibold tracking-tight text-white">AI Network Summary</h2>
        </div>
        <ul className="space-y-2.5 flex-1">
          {insights.map((ins, i) => (
            <li key={i} className="flex items-start gap-2.5 text-white/95" data-testid={`ai-insight-${i}`}>
              <span className="h-5 w-5 rounded-md bg-white/15 backdrop-blur flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold text-white/90">
                {i + 1}
              </span>
              <span className="text-[11.5px] leading-snug">{ins}</span>
            </li>
          ))}
          {insights.length === 0 && (
            <li className="text-white/70 text-[12px]">No insights generated yet.</li>
          )}
        </ul>
        <button
          onClick={() => navigate("/intel")}
          className="mt-4 inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl bg-white/15 hover:bg-white/25 backdrop-blur transition-colors text-white text-[12px] font-semibold"
          data-testid="view-intel-cta"
        >
          View Network Intelligence <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SPOTLIGHT — top 5 distributor cards
// ============================================================================
function Spotlight({ items }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const perPage = 5;
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const slice = items.slice(page * perPage, (page + 1) * perPage);

  return (
    <div data-testid="spotlight-row">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Top Distributor Overview</h3>
        {items.length > perPage && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 inline-flex items-center justify-center"
              data-testid="spotlight-prev"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 inline-flex items-center justify-center"
              data-testid="spotlight-next"
            >
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            </button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {slice.map((d) => (
          <SpotlightCard key={d.id} d={d} onOpen={() => navigate(`/distributors/${d.id}`)} />
        ))}
        {slice.length === 0 && (
          <div className="col-span-full bg-white rounded-2xl p-8 text-center text-slate-400 border border-slate-100">
            No distributors yet.
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_CHIP = {
  active: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  inactive: "bg-slate-100 text-slate-600",
};

function SpotlightCard({ d, onOpen }) {
  return (
    <div
      className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_20px_45px_-12px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 border border-slate-100/70 transition-all duration-300 cursor-pointer group"
      data-testid={`spotlight-${d.id}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-slate-900 leading-tight truncate group-hover:text-violet-700 transition-colors">
            {titleCase(d.name)}
          </div>
          <div className="text-[10.5px] text-slate-500 mt-0.5">{d.region} · {d.city}</div>
        </div>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-bold flex-shrink-0 ${STATUS_CHIP[d.status] || STATUS_CHIP.active}`}>
          {titleCase(d.status)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-4">
        <SpotMetric label="Revenue (90D)" value={fmtMoney(d.revenue_90d)} />
        <SpotMetric label="Retailers" value={fmtInt(d.retailers_total)} />
        <SpotMetric label="Inventory" value={`${fmtUnits(d.inventory_units)} Units`} />
        <SpotMetric label="Sell-through" value={`${Math.round(d.sell_through_pct)}%`} />
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-semibold">Health Score</span>
          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold" style={{ color: HEALTH_DOT[d.health_band] }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH_DOT[d.health_band] }} />
            {HEALTH_LABEL[d.health_band] || "—"}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 group-hover:text-violet-700">
          View Dashboard <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

function SpotMetric({ label, value }) {
  return (
    <div>
      <div className="text-[9.5px] text-slate-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className="text-[13px] font-bold text-slate-900 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

// ============================================================================
// DISTRIBUTORS TABLE — full master list with sort/filter/click-through
// ============================================================================
function DistributorsTable({ rows, query, filters }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const pageSize = 8;
  const [sortKey, setSortKey] = useState("revenue_90d");
  const [sortDir, setSortDir] = useState("desc");

  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    let r = rows;
    if (q) {
      r = r.filter((x) =>
        x.name.toLowerCase().includes(q) ||
        (x.city || "").toLowerCase().includes(q) ||
        (x.region || "").toLowerCase().includes(q)
      );
    }
    if (filters?.region && filters.region !== "all") {
      r = r.filter((x) => x.region === filters.region);
    }
    if (filters?.health && filters.health !== "all") {
      r = r.filter((x) => x.health_band === filters.health);
    }
    if (filters?.status && filters.status !== "all") {
      r = r.filter((x) => x.status === filters.status);
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...r].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [rows, query, filters, sortKey, sortDir]);

  // Reset page when filters/query change so we never land on an empty page.
  useEffect(() => { setPage(0); }, [query, filters?.region, filters?.health, filters?.status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = showAll
    ? filtered
    : filtered.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sortInd = (k) => sortKey === k ? <span className="text-violet-500">{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="distributors-master-table">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-slate-900">All Distributors</h3>
          <span className="inline-flex items-center justify-center h-5 px-2 rounded-full bg-violet-50 text-violet-700 text-[10.5px] font-bold tabular-nums">
            {filtered.length}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="text-left pb-3 pl-2 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("name")}>Distributor {sortInd("name")}</th>
              <th className="text-left pb-3">Region</th>
              <th className="text-left pb-3">City</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("revenue_90d")}>Revenue (90D) {sortInd("revenue_90d")}</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("retailers_total")}>Retailers {sortInd("retailers_total")}</th>
              <th className="text-right pb-3">Inventory</th>
              <th className="text-right pb-3">Orders</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("sell_through_pct")}>Sell-through % {sortInd("sell_through_pct")}</th>
              <th className="text-left pb-3">Health Score</th>
              <th className="text-left pb-3">Last Shipment</th>
              <th className="text-left pb-3">Status</th>
              <th className="text-right pb-3 pr-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pageRows.map((r) => (
              <tr
                key={r.id}
                onClick={() => navigate(`/distributors/${r.id}`)}
                className="group cursor-pointer hover:bg-slate-50/60 transition-colors"
                data-testid={`dist-row-${r.id}`}
              >
                <td className="py-2.5 pl-2">
                  <span className="font-semibold text-slate-900 group-hover:text-violet-700 text-[12px]">
                    {titleCase(r.name)}
                  </span>
                </td>
                <td className="py-2.5 text-slate-600">{r.region}</td>
                <td className="py-2.5 text-slate-600">{r.city || "—"}</td>
                <td className="py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmtMoney(r.revenue_90d)}</td>
                <td className="py-2.5 text-right text-slate-700 tabular-nums">{r.retailers_total}</td>
                <td className="py-2.5 text-right text-slate-700 tabular-nums">{fmtUnits(r.inventory_units)} <span className="text-[10px] text-slate-500">Units</span></td>
                <td className="py-2.5 text-right text-slate-700 tabular-nums">{r.orders_90d}</td>
                <td className="py-2.5 text-right text-slate-700 tabular-nums">{Math.round(r.sell_through_pct)}%</td>
                <td className="py-2.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: HEALTH_DOT[r.health_band] }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: HEALTH_DOT[r.health_band] }} />
                    {HEALTH_LABEL[r.health_band] || "—"}
                  </span>
                </td>
                <td className="py-2.5 text-slate-600 tabular-nums">{fmtDate(r.last_shipment)}</td>
                <td className="py-2.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_CHIP[r.status] || STATUS_CHIP.active}`}>
                    {titleCase(r.status)}
                  </span>
                </td>
                <td className="py-2.5 pr-2 text-right">
                  <ExternalLink className="inline-block h-3.5 w-3.5 text-slate-300 group-hover:text-violet-500" />
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center py-10 text-slate-400 text-[12px]">
                  No distributors match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(totalPages > 1 || showAll) && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[11.5px] font-semibold text-violet-600 hover:text-violet-700 inline-flex items-center gap-1"
            data-testid="view-all-distributors"
          >
            {showAll
              ? `Collapse to ${pageSize} per page ←`
              : `View all ${filtered.length} distributors →`}
          </button>
          {!showAll && (
            <Pagination total={totalPages} page={page} onPage={setPage} />
          )}
        </div>
      )}
    </div>
  );
}

function Pagination({ total, page, onPage }) {
  const pages = [];
  // Always show first, last, current ± 1, then ellipsis
  for (let i = 0; i < total; i++) {
    if (i === 0 || i === total - 1 || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }
  return (
    <div className="flex items-center gap-1" data-testid="dist-table-pagination">
      <button
        onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page === 0}
        className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 inline-flex items-center justify-center"
      >
        <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
      </button>
      {pages.map((p, i) => (
        p === "…" ? (
          <span key={`e-${i}`} className="px-1 text-[11px] text-slate-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`h-7 min-w-[28px] px-2 rounded-lg text-[11.5px] font-semibold transition-colors ${
              p === page
                ? "bg-violet-600 text-white"
                : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {p + 1}
          </button>
        )
      ))}
      <button
        onClick={() => onPage(Math.min(total - 1, page + 1))}
        disabled={page === total - 1}
        className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 inline-flex items-center justify-center"
      >
        <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
      </button>
    </div>
  );
}

// ============================================================================
// RETAIL NETWORK REACH
// ============================================================================
function RetailReach({ rows }) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 6);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="retail-reach-panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-slate-900">Retail Network Reach</h3>
        {rows.length > 6 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] font-semibold text-violet-600 hover:text-violet-700"
            data-testid="retail-reach-view-all"
          >
            {showAll ? "Show less" : "View all"}
          </button>
        )}
      </div>
      <div className="overflow-hidden">
        <div className="grid grid-cols-[1fr_50px_60px_70px_50px] gap-2 text-[10px] uppercase tracking-wider text-slate-400 font-semibold pb-2 border-b border-slate-100">
          <div>Distributor</div>
          <div className="text-right">Retailers</div>
          <div className="text-right">Coverage</div>
          <div className="text-right">Revenue</div>
          <div className="text-right">Growth</div>
        </div>
        <div className="divide-y divide-slate-50">
          {visible.map((r, i) => {
            const up = (r.growth_pct ?? 0) >= 0;
            return (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_50px_60px_70px_50px] gap-2 items-center py-2 cursor-pointer hover:bg-slate-50/70 transition-colors text-[11px]"
                onClick={() => navigate(`/distributors/${r.id}`)}
                data-testid={`reach-row-${i}`}
              >
                <div className="font-semibold text-slate-900 truncate text-[11.5px]">
                  {titleCase(r.name)}
                </div>
                <div className="text-right text-slate-700 tabular-nums font-semibold">{r.retailers_served}</div>
                <div className="text-right text-slate-700 tabular-nums">{Math.round(r.coverage_pct)}%</div>
                <div className="text-right text-slate-900 tabular-nums font-semibold">{fmtMoney(r.revenue_90d)}</div>
                <div className={`text-right tabular-nums font-bold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                  {fmtPct(r.growth_pct)}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div className="py-6 text-center text-[11px] text-slate-400">No reach data yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// AT-RISK PANEL
// ============================================================================
const SEVERITY_CHIP = {
  high:   { bg: "bg-rose-50",   text: "text-rose-700",   label: "High" },
  medium: { bg: "bg-amber-50",  text: "text-amber-700",  label: "Medium" },
  low:    { bg: "bg-slate-100", text: "text-slate-700",  label: "Low" },
};

function AtRiskPanel({ rows }) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 5);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="at-risk-panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-slate-900">Distributors Requiring Attention</h3>
        {rows.length > 5 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] font-semibold text-violet-600 hover:text-violet-700"
            data-testid="at-risk-view-all"
          >
            {showAll ? "Show less" : "View all"}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((r, i) => {
          const sev = SEVERITY_CHIP[r.severity] || SEVERITY_CHIP.low;
          return (
            <div
              key={r.id}
              onClick={() => navigate(`/distributors/${r.id}`)}
              className="flex items-start justify-between gap-2 p-2 -mx-2 rounded-lg hover:bg-slate-50/70 cursor-pointer transition-colors"
              data-testid={`at-risk-${i}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-semibold text-slate-900 truncate leading-tight">
                  {titleCase(r.name)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">{r.issue}</div>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-bold ${sev.bg} ${sev.text} flex-shrink-0`}>
                {sev.label}
              </span>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="py-8 text-center text-[11px] text-slate-400">
            All clear — no distributors need attention.
          </div>
        )}
      </div>
    </div>
  );
}
