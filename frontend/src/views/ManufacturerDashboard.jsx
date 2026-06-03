/**
 * Manufacturer Executive Command Center
 * Pixel-faithful to the design reference: large white cards, soft shadows,
 * 20px radii, dense KPI grid, AI summary, dual-axis trend chart, 6-zone
 * Nigeria map, distributor table, supply chain pipeline, alerts feed.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, Sparkles, Bell, Calendar, ChevronDown,
  Boxes, Store, Warehouse, Activity, Truck, Package, AlertTriangle,
  ArrowUpRight, ArrowRight, Loader2, CheckCircle2, Clock, XCircle,
  ChevronRight, Search, MoreHorizontal, PackageCheck,
} from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtPct = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtInt = (v) => Number(v || 0).toLocaleString();

export default function ManufacturerDashboard() {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trendWindow, setTrendWindow] = useState(12);

  useEffect(() => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerOverview(session.entity.id)
      .then(setData)
      .finally(() => setLoading(false));
  }, [session?.entity?.id]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center" data-testid="mfg-dashboard-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading executive overview…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50" data-testid="mfg-executive-dashboard">
      <DashboardHeader manufacturer={data.manufacturer} />

      <div className="px-8 py-6 max-w-[1760px] mx-auto space-y-5">
        <TitleBar />

        {/* Row 1: KPI strip + AI card */}
        <div className="grid grid-cols-12 gap-4">
          <KPIStrip kpis={data.kpis} />
          <AIExecutiveSummary bullets={data.ai_summary} />
        </div>

        {/* Row 2: trend + regional map */}
        <div className="grid grid-cols-12 gap-4">
          <RevenueTrendCard
            data={data.revenue_trend}
            trendWindow={trendWindow}
            setTrendWindow={setTrendWindow}
          />
          <RegionalPerformanceCard regional={data.regional} />
        </div>

        {/* Row 3: 4 coverage KPIs */}
        <CoverageKPIs data={data.coverage_kpis} />

        {/* Row 4: top products, categories, demand forecast, stockout risk */}
        <div className="grid grid-cols-12 gap-4">
          <TopProductsCard products={data.top_products} />
          <CategoriesCard categories={data.categories} />
          <DemandForecastCard forecast={data.demand_forecast} />
          <StockoutRiskCard items={data.stockout_risk} />
        </div>

        {/* Row 5: distributor table + pipeline + alerts */}
        <div className="grid grid-cols-12 gap-4">
          <DistributorTableCard rows={data.distributor_table} />
          <PipelineCard pipeline={data.pipeline} />
          <AlertsCard alerts={data.alerts} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Header strip — workspace label + date picker + notifications + avatar
// ============================================================================
function DashboardHeader({ manufacturer }) {
  return (
    <header className="bg-white border-b border-slate-200 px-8 py-4" data-testid="mfg-header">
      <div className="max-w-[1760px] mx-auto flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-semibold">
            Manufacturer Workspace
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <h1 className="text-lg font-semibold text-slate-900">{manufacturer.name}</h1>
            <span className="text-emerald-500"><CheckCircle2 className="h-4 w-4" /></span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">
            <Calendar className="h-3.5 w-3.5" /> Last 30 days
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button className="relative h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-50">
            <Bell className="h-4 w-4 text-slate-600" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
          </button>
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-sm font-semibold flex items-center justify-center">
            U
          </div>
        </div>
      </div>
    </header>
  );
}

function TitleBar() {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="text-[28px] font-bold tracking-tight text-slate-900">
          Executive Command Center
        </h2>
        <Sparkles className="h-5 w-5 text-violet-500" />
      </div>
      <div className="text-xs text-slate-500">Updated {new Date().toLocaleTimeString("en-US", {hour: "2-digit", minute: "2-digit"})}</div>
    </div>
  );
}

// ============================================================================
// KPI Strip — 4 sparkline cards spanning 8 cols
// ============================================================================
function KPIStrip({ kpis }) {
  return (
    <div className="col-span-12 lg:col-span-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KPICard label="Network Revenue" value={fmtMoney(kpis.network_revenue.value)}
        delta={kpis.network_revenue.growth_pct} spark={kpis.network_revenue.spark}
        Icon={TrendingUp} color="blue" testId="kpi-network-revenue" />
      <KPICard label="Active Retailers" value={fmtInt(kpis.active_retailers.value)}
        delta={kpis.active_retailers.growth_pct} spark={kpis.active_retailers.spark}
        Icon={Store} color="green" testId="kpi-active-retailers" />
      <KPICard label="Active Distributors" value={fmtInt(kpis.active_distributors.value)}
        delta={kpis.active_distributors.growth_pct} spark={kpis.active_distributors.spark}
        Icon={Warehouse} color="violet" testId="kpi-active-distributors" />
      <KPICard label="Network Health Score" value={`${kpis.network_health.value}/100`}
        delta={kpis.network_health.growth_pct} progress={kpis.network_health.value}
        Icon={Activity} color="emerald" testId="kpi-network-health" />
    </div>
  );
}

function KPICard({ label, value, delta, spark, progress, Icon, color, testId }) {
  const COLORS = {
    blue: { bg: "bg-blue-50", text: "text-blue-600", stroke: "#2563eb", fill: "rgba(37,99,235,0.15)" },
    green: { bg: "bg-emerald-50", text: "text-emerald-600", stroke: "#10b981", fill: "rgba(16,185,129,0.15)" },
    violet: { bg: "bg-violet-50", text: "text-violet-600", stroke: "#8b5cf6", fill: "rgba(139,92,246,0.15)" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", stroke: "#10b981", fill: "rgba(16,185,129,0.15)" },
  }[color];
  const up = (delta ?? 0) >= 0;
  return (
    <div className="bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow" data-testid={testId}>
      <div className="flex items-start justify-between mb-3">
        <div className={`h-9 w-9 rounded-lg ${COLORS.bg} ${COLORS.text} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-600" : "text-rose-600"}`}>
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {fmtPct(delta)}
        </span>
      </div>
      <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-[26px] font-bold text-slate-900 mt-0.5 leading-none">{value}</div>
      <div className="mt-3 h-8">
        {progress != null ? (
          <ProgressBar pct={progress} color={COLORS.stroke} />
        ) : (
          <Sparkline points={spark} stroke={COLORS.stroke} fill={COLORS.fill} />
        )}
      </div>
      <div className="text-[10px] text-slate-400 mt-1">vs previous period</div>
    </div>
  );
}

function Sparkline({ points, stroke, fill }) {
  if (!points || points.length < 2) return <div className="h-8" />;
  const w = 200, h = 32;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * (h - 3) - 1).toFixed(1)}`
  ).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <path d={area} fill={fill} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProgressBar({ pct, color }) {
  return (
    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden mt-3">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ============================================================================
// AI Executive Summary — large purple gradient card
// ============================================================================
function AIExecutiveSummary({ bullets }) {
  return (
    <div className="col-span-12 lg:col-span-4 rounded-[20px] p-6 text-white relative overflow-hidden bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 shadow-lg" data-testid="ai-exec-summary">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.2),transparent_50%)]" />
      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-9 w-9 rounded-lg bg-white/20 backdrop-blur flex items-center justify-center">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">AI Executive Summary</div>
            <div className="text-[11px] text-white/70">Powered by Sabi</div>
          </div>
        </div>
        <ul className="space-y-2 mb-4">
          {bullets.slice(0, 4).map((b, i) => (
            <li key={i} className="text-sm leading-snug flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-white/80 flex-shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <Link to="/intel" data-testid="ai-summary-cta">
          <button className="inline-flex items-center gap-1.5 text-sm font-medium bg-white/15 hover:bg-white/25 backdrop-blur px-3 py-1.5 rounded-lg transition-colors">
            View detailed insights <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </Link>
      </div>
    </div>
  );
}

// ============================================================================
// Revenue Trend dual-axis line chart
// ============================================================================
function RevenueTrendCard({ data, trendWindow, setTrendWindow }) {
  const sliced = data.slice(-trendWindow);
  const maxRev = Math.max(...sliced.map(d => d.revenue), 1);
  const maxShip = Math.max(...sliced.map(d => d.shipments), 1);
  const w = 700, h = 220;
  const padL = 50, padR = 50, padT = 20, padB = 30;
  const cw = w - padL - padR, ch = h - padT - padB;
  const step = sliced.length > 1 ? cw / (sliced.length - 1) : cw;

  const revPath = sliced.map((d, i) =>
    `${i === 0 ? "M" : "L"} ${(padL + i * step).toFixed(1)} ${(padT + ch - (d.revenue / maxRev) * ch).toFixed(1)}`
  ).join(" ");
  const shipPath = sliced.map((d, i) =>
    `${i === 0 ? "M" : "L"} ${(padL + i * step).toFixed(1)} ${(padT + ch - (d.shipments / maxShip) * ch).toFixed(1)}`
  ).join(" ");
  const revArea = sliced.length > 0 ? `${revPath} L ${padL + (sliced.length - 1) * step} ${padT + ch} L ${padL} ${padT + ch} Z` : "";

  return (
    <div className="col-span-12 lg:col-span-8 bg-white rounded-[20px] p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="revenue-trend-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Revenue & Shipment Trend</h3>
          <p className="text-xs text-slate-500">Network performance across regions</p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {[3, 6, 12].map(m => (
            <button key={m} onClick={() => setTrendWindow(m)} data-testid={`trend-window-${m}m`}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                trendWindow === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}>
              {m}M
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{height: `${h}px`}} preserveAspectRatio="none">
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map(p => (
          <line key={p} x1={padL} x2={padL + cw} y1={padT + ch * p} y2={padT + ch * p}
            stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {/* revenue area + line */}
        <defs>
          <linearGradient id="revgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={revArea} fill="url(#revgrad)" />
        <path d={revPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* shipments dashed line */}
        <path d={shipPath} fill="none" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4 4" />
        {/* dots on revenue */}
        {sliced.map((d, i) => (
          <circle key={i} cx={padL + i * step} cy={padT + ch - (d.revenue / maxRev) * ch} r="3"
            fill="#2563eb" stroke="white" strokeWidth="1.5" />
        ))}
        {/* x-axis labels */}
        {sliced.map((d, i) => i % Math.max(1, Math.floor(sliced.length / 8)) === 0 && (
          <text key={i} x={padL + i * step} y={h - 8} fontSize="10" textAnchor="middle" fill="#94a3b8">
            {d.month.slice(5)}
          </text>
        ))}
      </svg>
      <div className="flex items-center gap-5 text-xs mt-2 px-2">
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-3 bg-blue-600 rounded-sm" /> Revenue
        </div>
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="h-0.5 w-3 bg-violet-500 border-t border-dashed border-violet-500" /> Shipments
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Regional Performance — stylised Nigeria 6-zone SVG + table
// ============================================================================
const ZONE_PATHS = {
  // Approximate / stylised SVG paths for the 6 Nigerian geopolitical zones.
  // Not GIS accurate — intended as a glanceable command-center visualization.
  "North West":    "M 30 38 L 110 28 L 145 60 L 130 95 L 65 95 L 30 70 Z",
  "North East":    "M 145 60 L 210 50 L 230 95 L 175 110 L 145 95 Z",
  "North Central": "M 130 95 L 175 110 L 175 145 L 110 150 L 90 130 Z",
  "South West":    "M 65 95 L 110 150 L 105 195 L 50 195 L 35 155 Z",
  "South East":    "M 110 150 L 165 145 L 160 195 L 120 200 L 105 195 Z",
  "South South":   "M 50 195 L 160 195 L 175 220 L 80 230 L 40 215 Z",
};
const HEALTH_FILL = {
  healthy: "#10b981", watch: "#f59e0b", at_risk: "#ef4444", no_data: "#cbd5e1",
};

function RegionalPerformanceCard({ regional }) {
  return (
    <div className="col-span-12 lg:col-span-4 bg-white rounded-[20px] p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="regional-performance-card">
      <h3 className="text-base font-semibold text-slate-900 mb-1">Regional Performance</h3>
      <p className="text-xs text-slate-500 mb-3">Sales by geopolitical zone</p>
      <div className="grid grid-cols-2 gap-3 items-center">
        <svg viewBox="0 0 270 250" className="w-full h-[200px]" data-testid="nigeria-svg">
          {regional.map(r => (
            <path key={r.zone}
              d={ZONE_PATHS[r.zone]}
              fill={HEALTH_FILL[r.health]}
              stroke="white" strokeWidth="1.5"
              className="hover:opacity-80 transition-opacity cursor-pointer"
            >
              <title>{r.zone}: {fmtMoney(r.revenue)} ({fmtPct(r.growth_pct)})</title>
            </path>
          ))}
        </svg>
        <div className="space-y-1.5">
          {regional.map(r => (
            <div key={r.zone} className="flex items-center justify-between text-xs" data-testid={`region-${r.zone.replace(/\s+/g,'-')}`}>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: HEALTH_FILL[r.health] }} />
                <span className="text-slate-700 truncate">{r.zone}</span>
              </div>
              <span className="text-slate-500 font-medium">{r.growth_pct != null ? fmtPct(r.growth_pct) : "—"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Coverage KPIs row
// ============================================================================
function CoverageKPIs({ data }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="coverage-kpis">
      <CovCard Icon={Store} bg="bg-blue-50" iconColor="text-blue-600"
        value={fmtInt(data.retail_coverage)} label="Retail Coverage"
        sub="Active Retailers"
        testId="cov-retail" />
      <CovCard Icon={Warehouse} bg="bg-violet-50" iconColor="text-violet-600"
        value={fmtInt(data.distributor_performance.total)} label="Distributor Performance"
        sub={`${data.distributor_performance.healthy} Healthy, ${data.distributor_performance.at_risk} At Risk`}
        testId="cov-distributors" />
      <CovCard Icon={Package} bg="bg-amber-50" iconColor="text-amber-600"
        value={fmtInt(data.inventory_coverage_units)} label="Inventory Coverage"
        sub="Units in Network"
        testId="cov-inventory" />
      <CovCard Icon={PackageCheck} bg="bg-emerald-50" iconColor="text-emerald-600"
        value={`${data.fulfillment_rate}%`} label="Fulfillment Rate"
        sub="On-time & In-full"
        testId="cov-fulfillment" />
    </div>
  );
}

function CovCard({ Icon, bg, iconColor, value, label, sub, testId }) {
  return (
    <div className="bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex items-center gap-4" data-testid={testId}>
      <div className={`h-12 w-12 rounded-xl ${bg} ${iconColor} flex items-center justify-center flex-shrink-0`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</div>
        <div className="text-2xl font-bold text-slate-900 mt-0.5 leading-none">{value}</div>
        <div className="text-[11px] text-slate-400 mt-1 truncate">{sub}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Top Performing Products
// ============================================================================
function TopProductsCard({ products }) {
  return (
    <div className="col-span-12 lg:col-span-3 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="top-products-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Top Performing Products</h3>
      <p className="text-xs text-slate-500 mb-3">Last 30 days</p>
      <div className="space-y-2">
        {products.length === 0 && <div className="text-xs text-slate-400 py-3">No sales data yet.</div>}
        {products.map((p, i) => (
          <Link to={`/products/${p.id}`} key={p.id}
            className="flex items-center gap-3 group hover:bg-slate-50 -mx-2 px-2 py-2 rounded-lg transition-colors"
            data-testid={`top-product-${i}`}>
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0">
              <Package className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate group-hover:text-violet-600">{p.name}</div>
              <div className="text-[11px] text-slate-400">{fmtMoney(p.revenue)}</div>
            </div>
            <span className={`text-xs font-medium ${(p.growth_pct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {fmtPct(p.growth_pct)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Fastest Growing Categories — donut + bullet list
// ============================================================================
function CategoriesCard({ categories }) {
  const total = categories.reduce((s, c) => s + c.revenue, 0) || 1;
  let cumulative = 0;
  const slices = categories.map((c, i) => {
    const start = (cumulative / total) * 360;
    cumulative += c.revenue;
    const end = (cumulative / total) * 360;
    return { ...c, start, end, color: ["#2563eb", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899", "#06b6d4"][i % 6] };
  });
  const cx = 50, cy = 50, r = 38, ir = 26;
  const polar = (a) => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)];
  const polarI = (a) => [cx + ir * Math.cos((a - 90) * Math.PI / 180), cy + ir * Math.sin((a - 90) * Math.PI / 180)];

  return (
    <div className="col-span-12 lg:col-span-3 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="categories-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Fastest Growing Categories</h3>
      <p className="text-xs text-slate-500 mb-3">vs previous period</p>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 100 100" className="w-[100px] h-[100px] flex-shrink-0">
          {slices.map((s, i) => {
            const [x1, y1] = polar(s.start);
            const [x2, y2] = polar(s.end);
            const [x3, y3] = polarI(s.end);
            const [x4, y4] = polarI(s.start);
            const large = (s.end - s.start) > 180 ? 1 : 0;
            const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${large} 0 ${x4} ${y4} Z`;
            return <path key={i} d={d} fill={s.color} />;
          })}
        </svg>
        <div className="flex-1 min-w-0 space-y-1">
          {slices.slice(0, 5).map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-[11px]" data-testid={`cat-row-${i}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <span className="text-slate-700 truncate">{c.name}</span>
              </div>
              <span className={`font-medium ${(c.growth_pct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {fmtPct(c.growth_pct)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Demand Forecast — bar chart
// ============================================================================
function DemandForecastCard({ forecast }) {
  const bars = forecast.bars || [];
  const max = Math.max(...bars, 1);
  return (
    <div className="col-span-12 lg:col-span-3 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="demand-forecast-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-slate-900">Demand Forecast</h3>
        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600">
          <TrendingUp className="h-3 w-3" /> +{forecast.growth_pct}%
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Next 30 days</p>
      <div className="flex items-end gap-[3px] h-[100px]">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 rounded-t transition-colors hover:opacity-80"
            style={{
              height: `${(b / max) * 100}%`,
              background: `linear-gradient(to top, #8b5cf6, #c4b5fd)`,
              minHeight: "2px",
            }}
            title={`Day ${i + 1}: ${b}u`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2">
        <span>Today</span><span>+30d</span>
      </div>
    </div>
  );
}

// ============================================================================
// Stockout Risk
// ============================================================================
function StockoutRiskCard({ items }) {
  const SEV = {
    high: { bg: "bg-rose-50", text: "text-rose-700", label: "Critical" },
    medium: { bg: "bg-amber-50", text: "text-amber-700", label: "Medium" },
    low: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Low" },
  };
  return (
    <div className="col-span-12 lg:col-span-3 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="stockout-risk-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Stockout Risk</h3>
      <p className="text-xs text-slate-500 mb-3">SKUs depleting within 7 days</p>
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-slate-400 py-6 text-center">All stock healthy 🎉</div>
        )}
        {items.map((it, i) => {
          const sev = SEV[it.severity] || SEV.low;
          return (
            <div key={i} className="flex items-center justify-between" data-testid={`stockout-${i}`}>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-900 truncate">{it.product_name}</div>
                <div className="text-[10px] text-slate-400">{it.days_remaining}d remaining</div>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
                {sev.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Distributor performance table
// ============================================================================
function DistributorTableCard({ rows }) {
  const RISK = {
    low: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Low Risk" },
    medium: { bg: "bg-amber-50", text: "text-amber-700", label: "Watch" },
    high: { bg: "bg-rose-50", text: "text-rose-700", label: "High Risk" },
  };
  return (
    <div className="col-span-12 lg:col-span-7 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="distributor-table-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Distributor Performance</h3>
          <p className="text-xs text-slate-500">Top 8 by revenue</p>
        </div>
        <Link to="/network" className="text-xs text-violet-600 hover:underline font-medium">View all →</Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="border-slate-200">
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Distributor</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Region</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 text-right">Revenue</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 text-right">Growth</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 text-right">Health</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Risk</TableHead>
            <TableHead className="w-8"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(d => {
            const risk = RISK[d.risk_level] || RISK.low;
            return (
              <TableRow key={d.id} className="border-slate-100" data-testid={`dist-row-${d.id}`}>
                <TableCell className="text-sm font-medium text-slate-900">
                  <Link to={`/distributors/${d.id}`} className="hover:text-violet-600">{d.name}</Link>
                </TableCell>
                <TableCell className="text-xs text-slate-500">{d.region}</TableCell>
                <TableCell className="text-right text-sm font-medium text-slate-900">{fmtMoney(d.revenue_mtd)}</TableCell>
                <TableCell className={`text-right text-xs font-medium ${(d.growth_pct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {fmtPct(d.growth_pct)}
                </TableCell>
                <TableCell className="text-right">
                  <HealthScore score={d.health_score} />
                </TableCell>
                <TableCell>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${risk.bg} ${risk.text}`}>
                    {risk.label}
                  </span>
                </TableCell>
                <TableCell>
                  <Link to={`/distributors/${d.id}`} className="text-slate-400 hover:text-slate-700">
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function HealthScore({ score }) {
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="inline-flex items-center gap-2 justify-end">
      <span className="text-sm font-medium text-slate-700">{score}</span>
      <div className="h-1.5 w-12 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
    </div>
  );
}

// ============================================================================
// Supply chain pipeline
// ============================================================================
function PipelineCard({ pipeline }) {
  return (
    <div className="col-span-12 lg:col-span-3 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="pipeline-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Supply Chain Pipeline</h3>
      <p className="text-xs text-slate-500 mb-4">Real-time shipment status</p>
      <div className="space-y-3">
        <PipelineRow Icon={Clock} color="text-amber-600" bg="bg-amber-50" label="Pending" count={pipeline.pending} />
        <PipelineRow Icon={Truck} color="text-blue-600" bg="bg-blue-50" label="In Transit" count={pipeline.in_transit} />
        <PipelineRow Icon={CheckCircle2} color="text-emerald-600" bg="bg-emerald-50" label="Delivered" count={pipeline.delivered} />
        <PipelineRow Icon={XCircle} color="text-rose-600" bg="bg-rose-50" label="Delayed" count={pipeline.delayed} />
      </div>
      <div className="mt-4 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-500">Pipeline efficiency</span>
          <span className="text-emerald-600 font-medium">{pipeline.progress_pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
            style={{ width: `${pipeline.progress_pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function PipelineRow({ Icon, color, bg, label, count }) {
  return (
    <div className="flex items-center justify-between" data-testid={`pipeline-${label.toLowerCase().replace(' ', '-')}`}>
      <div className="flex items-center gap-2.5">
        <div className={`h-8 w-8 rounded-lg ${bg} ${color} flex items-center justify-center`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm text-slate-700">{label}</span>
      </div>
      <span className="text-base font-bold text-slate-900">{count}</span>
    </div>
  );
}

// ============================================================================
// Network alerts feed
// ============================================================================
function AlertsCard({ alerts }) {
  const SEV = {
    critical: { Icon: AlertTriangle, bg: "bg-rose-50", color: "text-rose-600" },
    warning: { Icon: AlertTriangle, bg: "bg-amber-50", color: "text-amber-600" },
    info: { Icon: Activity, bg: "bg-blue-50", color: "text-blue-600" },
  };
  return (
    <div className="col-span-12 lg:col-span-2 bg-white rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]" data-testid="alerts-card">
      <h3 className="text-sm font-semibold text-slate-900 mb-1">Network Alerts</h3>
      <p className="text-xs text-slate-500 mb-3">Latest signals</p>
      <div className="space-y-3">
        {alerts.length === 0 && <div className="text-xs text-slate-400 py-3">No alerts.</div>}
        {alerts.map((a, i) => {
          const sev = SEV[a.severity] || SEV.info;
          const Icon = sev.Icon;
          return (
            <div key={i} className="flex gap-2" data-testid={`alert-${i}`}>
              <div className={`h-7 w-7 rounded-lg ${sev.bg} ${sev.color} flex items-center justify-center flex-shrink-0`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-900 truncate">{a.title}</div>
                <div className="text-[10px] text-slate-500 line-clamp-2">{a.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
