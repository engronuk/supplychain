/**
 * Manufacturer Executive Command Center — Premium Edition
 *
 * National distribution command center for Fortune 500 FMCG operations.
 * Visual language: Stripe / Linear / Salesforce Analytics — clean white
 * canvas, soft 24px shadows, 20px radii, generous whitespace, micro-
 * interactions, and high-information-density panels arranged in a
 * priority-ordered executive hierarchy.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { useCachedFetch, setCached as setDataCache } from "@/lib/dataCache";
import { RefreshPill } from "@/components/RefreshPill";
import { toast } from "sonner";
import { STATE_PATHS, STATE_ZONE, VIEWBOX as NG_VIEWBOX } from "@/lib/nigeriaStates";
import CommandCenter from "@/views/CommandCenter";
import { ManufacturerWholesalerPosWidget } from "@/views/CrossPersonaWidgets";
import {
  TrendingUp, TrendingDown, Sparkles, Bell,
  Store, Warehouse, Activity, Truck, Package, AlertTriangle,
  ArrowRight, Loader2, CheckCircle2, Clock, XCircle,
  ChevronRight, PackageCheck, Factory, Building2,
  Download, Maximize2, Target, Zap, Compass, BrainCircuit,
  ShieldCheck, Flame, ArrowUpRight, BarChart3, Info,
  LayoutDashboard, Globe2,
} from "lucide-react";

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
  const entityId = session?.entity?.id;
  const [trendWindow, setTrendWindow] = useState(12);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "pulse"

  const cacheKey = entityId ? `mfg-overview:${entityId}` : null;
  const { data, loading, reload } = useCachedFetch(
    cacheKey,
    () => Api.manufacturerOverview(entityId),
    [entityId],
  );

  const onRefresh = async () => {
    if (!entityId) return;
    setRefreshing(true);
    try {
      const fresh = await Api.refreshOverview(entityId);
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
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="mfg-dashboard-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading executive overview…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="mfg-executive-dashboard">
      <div className="px-8 py-7 max-w-[1760px] mx-auto space-y-7">
        <TitleBar
          asOf={data?._snapshot?.as_of}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />

        {/* Tab switcher — Overview vs Real-Time Pulse Command Center */}
        <DashboardTabs active={activeTab} onChange={setActiveTab} />

        {activeTab === "pulse" ? (
          <CommandCenter />
        ) : (
          <>
        {/* 1 — EXECUTIVE HERO (AI summary + confidence + actions) */}
        <ExecutiveHero
          bullets={data.ai_summary}
          confidence={88}
          revenue={data.kpis.network_revenue}
          atRisk={data.coverage_kpis.distributor_performance.at_risk}
          stockoutCount={data.stockout_risk.length}
        />

        {/* 2 — REVENUE PERFORMANCE (KPI strip on top) */}
        <KPIStripWide kpis={data.kpis} coverage={data.coverage_kpis} />

        {/* 3 + 4 — REVENUE TREND × REGIONAL PERFORMANCE (side by side) */}
        <div className="grid grid-cols-12 gap-6">
          <RevenueTrendCard
            data={data.revenue_trend}
            trendWindow={trendWindow}
            setTrendWindow={setTrendWindow}
          />
          <RegionalPerformanceCard regional={data.regional} summary={data.regional_summary} />
        </div>

        {/* 5 — PRODUCT INTELLIGENCE (rich cards) + categories + forecast */}
        <div className="grid grid-cols-12 gap-6">
          <ProductIntelligenceCard products={data.top_products} />
          <CategoriesCard categories={data.categories} />
          <DemandForecastCard forecast={data.demand_forecast} />
        </div>

        {/* 6 — DISTRIBUTOR INTELLIGENCE + Stockout Risk */}
        <div className="grid grid-cols-12 gap-6">
          <DistributorIntelligenceCard rows={data.distributor_table} />
          <StockoutRiskCard items={data.stockout_risk} />
        </div>

        {/* 7 — SUPPLY CHAIN PIPELINE (animated flow) */}
        <SupplyChainPipeline pipeline={data.pipeline} />

        {/* Wholesaler Replenishment Requests — cross-persona widget */}
        <ManufacturerWholesalerPosWidget manufacturerId={session?.entity?.id} />

        {/* 8 — ACTIONABLE NETWORK ALERTS */}
        <ActionableAlertsCard alerts={data.alerts} atRisk={data.coverage_kpis.distributor_performance.at_risk} />
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DashboardTabs — segmented control to swap between Executive Overview and
// the Real-Time Pulse Command Center (GCP-powered).
// ============================================================================
function DashboardTabs({ active, onChange }) {
  const tabs = [
    { id: "overview", label: "Executive Overview", icon: LayoutDashboard },
    { id: "pulse",    label: "Command Center",     icon: Globe2,
      badge: "PULSE" },
  ];
  return (
    <div
      className="inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-slate-200/80 shadow-sm"
      data-testid="dashboard-tabs"
    >
      {tabs.map(({ id, label, icon: Icon, badge }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            data-testid={`dashboard-tab-${id}`}
            className={`relative inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${isActive
                ? "bg-slate-900 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"}`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {badge && (
              <span className={`text-[9px] font-bold tracking-[0.15em] px-1.5 py-0.5 rounded
                ${isActive ? "bg-violet-500/30 text-violet-100" : "bg-violet-100 text-violet-700"}`}>
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// TitleBar — replaces Layout's topbar context heading on the dashboard
// ============================================================================
function TitleBar({ asOf, onRefresh, refreshing }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-[32px] font-bold tracking-tight text-slate-900 leading-none">
            Executive Command Center
          </h2>
          <Sparkles className="h-5 w-5 text-violet-500 animate-pulse" />
        </div>
        <p className="text-sm text-slate-500 mt-2">Real-time overview of your distribution network across Nigeria.</p>
      </div>
      <RefreshPill asOf={asOf} onRefresh={onRefresh} busy={refreshing} testId="dashboard-refresh-pill" />
    </div>
  );
}

// ============================================================================
// 1 — EXECUTIVE HERO — large gradient card with AI illustration, confidence,
//     bullets, and quick action buttons
// ============================================================================
function ExecutiveHero({ bullets, confidence, revenue, atRisk, stockoutCount }) {
  return (
    <div
      className="relative overflow-hidden rounded-[28px] shadow-[0_24px_60px_-20px_rgba(30,27,75,0.4)] animate-rise-in"
      data-testid="ai-exec-summary"
    >
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1E1B4B] via-[#4338CA] to-[#7C3AED]" />
      {/* Mesh grain overlay */}
      <div className="absolute inset-0 opacity-[0.18] bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.6),transparent_45%)]" />
      <div className="absolute inset-0 opacity-[0.08] bg-[radial-gradient(circle_at_bottom_left,rgba(244,114,182,1),transparent_55%)]" />
      <div className="absolute inset-0 bg-grain opacity-[0.15] mix-blend-overlay" />

      {/* Orbital shimmer (background floating shapes) */}
      <div className="absolute -top-32 -right-20 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-fuchsia-400/30 to-indigo-400/0 blur-3xl animate-shimmer-slow" />
      <div className="absolute -bottom-24 left-1/3 h-[320px] w-[320px] rounded-full bg-gradient-to-br from-cyan-400/20 to-transparent blur-3xl" />

      <div className="relative grid grid-cols-12 gap-6 p-8 lg:p-10">
        {/* Left content */}
        <div className="col-span-12 lg:col-span-8 text-white">
          {/* Badge row */}
          <div className="flex items-center gap-2 mb-5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-[10px] font-semibold tracking-widest uppercase border border-white/20">
              <BrainCircuit className="h-3 w-3" /> AI Executive Brief
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-400/20 text-emerald-100 text-[10px] font-semibold tracking-widest uppercase border border-emerald-300/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
              Confidence {confidence}%
            </span>
            <span className="text-[11px] text-white/60 ml-1">Powered by Sabi · Sonnet 4.5</span>
          </div>

          {/* Headline */}
          <h3 className="text-2xl lg:text-[28px] font-semibold leading-tight tracking-tight max-w-2xl">
            Your network is <span className="text-emerald-300">trending positive</span>—but {atRisk} distributors and {stockoutCount} SKUs need eyes on them today.
          </h3>

          {/* Bullets in 2x2 grid for premium feel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 mt-6 max-w-3xl">
            {bullets.slice(0, 4).map((b, i) => {
              const Icon = [TrendingUp, AlertTriangle, ShieldCheck, Zap][i % 4];
              return (
                <div key={i} className="flex items-start gap-3" data-testid={`hero-bullet-${i}`}>
                  <div className="mt-0.5 h-7 w-7 rounded-lg bg-white/10 backdrop-blur border border-white/15 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="text-[13.5px] leading-relaxed text-white/90">{b}</p>
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2.5 mt-7">
            <Link to="/network" data-testid="hero-action-investigate">
              <button className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#1E1B4B] text-sm font-semibold hover:bg-amber-50 hover:shadow-lg transition-all duration-200">
                <Compass className="h-4 w-4" />
                Investigate Distributors
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </Link>
            <Link to="/intel" data-testid="hero-action-intel">
              <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 backdrop-blur border border-white/20 text-white text-sm font-semibold hover:bg-white/25 transition-colors">
                <BrainCircuit className="h-4 w-4" />
                View Intelligence
              </button>
            </Link>
            <Link to="/intel" data-testid="hero-action-forecast">
              <button className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/15 backdrop-blur border border-white/20 text-white text-sm font-semibold hover:bg-white/25 transition-colors">
                <Target className="h-4 w-4" />
                Open Forecast
              </button>
            </Link>
          </div>
        </div>

        {/* Right: AI orb illustration */}
        <div className="hidden lg:flex col-span-12 lg:col-span-4 items-center justify-center relative">
          <AIOrbIllustration />
          <div className="absolute bottom-4 right-2 flex flex-col items-end gap-1">
            <div className="text-[10px] uppercase tracking-widest text-white/60">Net 30d revenue</div>
            <div className="text-3xl font-bold text-white tabular-nums">{fmtMoney(revenue.value)}</div>
            <div className="flex items-center gap-1 text-emerald-300 text-xs font-semibold">
              <ArrowUpRight className="h-3.5 w-3.5" /> {fmtPct(revenue.growth_pct)} vs prior
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AIOrbIllustration() {
  return (
    <div className="relative h-[220px] w-[220px]" aria-hidden="true">
      {/* Orbiting rings */}
      <div className="absolute inset-0 rounded-full border border-white/15 animate-orbit-spin" style={{ animationDuration: '22s' }}>
        <span className="absolute -top-1 left-1/2 h-2 w-2 rounded-full bg-amber-300 shadow-[0_0_12px_2px_rgba(252,211,77,0.6)]" />
      </div>
      <div className="absolute inset-4 rounded-full border border-white/10 animate-orbit-spin" style={{ animationDuration: '14s', animationDirection: 'reverse' }}>
        <span className="absolute top-1/2 -right-1 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_2px_rgba(103,232,249,0.7)]" />
      </div>
      <div className="absolute inset-8 rounded-full border border-white/15 animate-orbit-spin" style={{ animationDuration: '18s' }}>
        <span className="absolute -bottom-1 left-1/3 h-1.5 w-1.5 rounded-full bg-fuchsia-300 shadow-[0_0_10px_2px_rgba(232,121,249,0.6)]" />
      </div>
      {/* Core orb */}
      <div className="absolute inset-12 rounded-full bg-gradient-to-br from-white via-violet-200 to-violet-400 shadow-[0_0_60px_8px_rgba(196,181,253,0.45)] animate-float-y flex items-center justify-center">
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white/95 to-violet-300/80 backdrop-blur" />
        <Sparkles className="relative h-9 w-9 text-[#4338CA]" />
      </div>
      {/* Floating data chips */}
      <div className="absolute -top-2 -left-4 px-2 py-1 rounded-lg bg-white/15 backdrop-blur border border-white/20 text-[10px] text-white font-medium animate-float-y" style={{ animationDelay: '0.5s' }}>
        +18% demand
      </div>
      <div className="absolute -bottom-1 -right-3 px-2 py-1 rounded-lg bg-white/15 backdrop-blur border border-white/20 text-[10px] text-white font-medium animate-float-y" style={{ animationDelay: '1.5s' }}>
        15 SKUs at risk
      </div>
    </div>
  );
}

// ============================================================================
// 2 — KPI STRIP (wide, 4 cards) + Coverage strip below
// ============================================================================
function KPIStripWide({ kpis, coverage }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5" data-testid="kpi-strip">
        <KPICard
          label="Network Revenue"
          value={fmtMoney(kpis.network_revenue.value)}
          delta={kpis.network_revenue.growth_pct}
          spark={kpis.network_revenue.spark}
          Icon={TrendingUp}
          color="indigo"
          testId="kpi-network-revenue"
        />
        <KPICard
          label="Active Retailers"
          value={fmtInt(kpis.active_retailers.value)}
          delta={kpis.active_retailers.growth_pct}
          spark={kpis.active_retailers.spark}
          Icon={Store}
          color="emerald"
          testId="kpi-active-retailers"
        />
        <KPICard
          label="Active Distributors"
          value={fmtInt(kpis.active_distributors.value)}
          delta={kpis.active_distributors.growth_pct}
          spark={kpis.active_distributors.spark}
          Icon={Warehouse}
          color="violet"
          testId="kpi-active-distributors"
        />
        <KPICard
          label="Network Health"
          value={`${kpis.network_health.value}`}
          suffix="/100"
          delta={kpis.network_health.growth_pct}
          progress={kpis.network_health.value}
          Icon={Activity}
          color="amber"
          testId="kpi-network-health"
        />
      </div>

      {/* Coverage strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5" data-testid="coverage-kpis">
        <CovCard Icon={Store} color="indigo"
          value={fmtInt(coverage.retail_coverage)} label="Retail Coverage"
          sub="Active retailers in network" testId="cov-retail" />
        <CovCard Icon={Warehouse} color="violet"
          value={fmtInt(coverage.distributor_performance.total)} label="Distributor Performance"
          sub={`${coverage.distributor_performance.healthy} healthy · ${coverage.distributor_performance.at_risk} at risk`}
          testId="cov-distributors" />
        <CovCard Icon={Package} color="amber"
          value={fmtInt(coverage.inventory_coverage_units)} label="Inventory Coverage"
          sub="Units in network" testId="cov-inventory" />
        <CovCard Icon={PackageCheck} color="emerald"
          value={`${coverage.fulfillment_rate}%`} label="Fulfillment Rate"
          sub="On-time & in-full" testId="cov-fulfillment" />
      </div>
    </div>
  );
}

const PALETTE = {
  indigo:  { ink: "#1E1B4B", chip: "#EEF2FF", chipText: "#4338CA", stroke: "#6366F1", soft: "rgba(99,102,241,0.16)" },
  emerald: { ink: "#064E3B", chip: "#ECFDF5", chipText: "#047857", stroke: "#10B981", soft: "rgba(16,185,129,0.18)" },
  violet:  { ink: "#3B0764", chip: "#F5F3FF", chipText: "#7C3AED", stroke: "#8B5CF6", soft: "rgba(139,92,246,0.18)" },
  amber:   { ink: "#78350F", chip: "#FFFBEB", chipText: "#B45309", stroke: "#F59E0B", soft: "rgba(245,158,11,0.18)" },
  rose:    { ink: "#7F1D1D", chip: "#FFF1F2", chipText: "#BE123C", stroke: "#F43F5E", soft: "rgba(244,63,94,0.18)" },
};

function KPICard({ label, value, suffix, delta, spark, progress, Icon, color, testId }) {
  const c = PALETTE[color];
  const up = (delta ?? 0) >= 0;
  return (
    <div
      className="group bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 transition-all duration-300 border border-slate-100/70"
      data-testid={testId}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center"
             style={{ background: c.chip, color: c.chipText }}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {fmtPct(delta)}
        </span>
      </div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1 mt-1.5">
        <div className="text-[34px] font-bold text-slate-900 leading-none tabular-nums tracking-tight">{value}</div>
        {suffix && <div className="text-base font-semibold text-slate-400">{suffix}</div>}
      </div>
      <div className="mt-4 h-10">
        {progress != null ? (
          <ProgressBar pct={progress} color={c.stroke} />
        ) : (
          <Sparkline points={spark} stroke={c.stroke} fill={c.soft} />
        )}
      </div>
      <div className="text-[11px] text-slate-400 mt-2 flex items-center justify-between">
        <span>vs previous 30 days</span>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 flex items-center gap-0.5">
          Details <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

function Sparkline({ points, stroke, fill }) {
  if (!points || points.length < 2) return <div className="h-10" />;
  const w = 240, h = 40;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [
    i * step,
    h - ((p - min) / range) * (h - 4) - 2,
  ]);
  // Smooth curve using cardinal-like spline
  const path = smoothPath(coords);
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${stroke.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${stroke.replace('#','')})`} />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.5" fill={stroke} stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

// Cardinal-ish smooth path generator
function smoothPath(points) {
  if (points.length === 0) return "";
  if (points.length < 3) {
    return points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  }
  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const tension = 0.5;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6 * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6 * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6 * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6 * tension;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ProgressBar({ pct, color }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden mt-4 relative">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }} />
      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/30 to-white/0 -translate-x-full animate-[marquee_4s_linear_infinite]"
        style={{ animationDuration: '4s' }} />
    </div>
  );
}

function CovCard({ Icon, color, value, label, sub, testId }) {
  const c = PALETTE[color];
  return (
    <div
      className="bg-white rounded-[22px] p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.12)] transition-shadow border border-slate-100/70 flex items-center gap-4"
      data-testid={testId}
    >
      <div className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0"
           style={{ background: c.chip, color: c.chipText }}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
        <div className="text-[22px] font-bold text-slate-900 mt-0.5 leading-none tabular-nums">{value}</div>
        <div className="text-[11px] text-slate-400 mt-1.5 truncate">{sub}</div>
      </div>
    </div>
  );
}

// ============================================================================
// 3 — REVENUE TREND CARD — smooth curves, gradient, forecast overlay, export
// ============================================================================
function RevenueTrendCard({ data, trendWindow, setTrendWindow }) {
  const sliced = data.slice(-trendWindow);
  const [hoverIdx, setHoverIdx] = useState(null);

  const { revPath, shipPath, revArea, forecastPath, dots, gridY } = useMemo(() => {
    const w = 760, h = 260;
    const padL = 56, padR = 56, padT = 24, padB = 36;
    const cw = w - padL - padR, ch = h - padT - padB;
    if (sliced.length === 0) return { dots: [], gridY: [], revPath: "", shipPath: "", revArea: "", forecastPath: "" };
    const maxRev = Math.max(...sliced.map(d => d.revenue), 1);
    const maxShip = Math.max(...sliced.map(d => d.shipments), 1);
    // When only 1-2 actual points, render with even spacing reserving room
    // on the right for the forecast curve.
    const effectiveN = Math.max(sliced.length, 6);
    const step = cw / (effectiveN - 1);
    const startIdx = sliced.length <= 3 ? Math.floor((effectiveN - sliced.length) / 2) : 0;

    const revCoords = sliced.map((d, i) => [padL + (startIdx + i) * step, padT + ch - (d.revenue / maxRev) * ch]);
    const shipCoords = sliced.map((d, i) => [padL + (startIdx + i) * step, padT + ch - (d.shipments / maxShip) * ch]);

    const revPath = smoothPath(revCoords);
    const shipPath = smoothPath(shipCoords);
    const revArea = sliced.length > 0 ? `${revPath} L ${revCoords[revCoords.length - 1][0]} ${padT + ch} L ${revCoords[0][0]} ${padT + ch} Z` : "";

    // Forecast — extend last 2 points forward with mild +growth, clamped to chart bounds
    let forecastPath = "";
    if (revCoords.length >= 2) {
      const last = revCoords[revCoords.length - 1];
      const prev = revCoords[revCoords.length - 2];
      const slope = (last[1] - prev[1]) * 0.6;
      const xMax = padL + cw;
      const remaining = Math.max(step, xMax - last[0]);
      const f1x = Math.min(xMax, last[0] + remaining * 0.5);
      const f1y = clamp(last[1] + slope - 4, padT, padT + ch);
      const f2x = Math.min(xMax, last[0] + remaining * 0.95);
      const f2y = clamp(f1y + slope - 6, padT, padT + ch);
      forecastPath = `M ${last[0].toFixed(1)} ${last[1].toFixed(1)} Q ${((last[0] + f1x) / 2).toFixed(1)} ${(last[1] - 4).toFixed(1)} ${f1x.toFixed(1)} ${f1y.toFixed(1)} T ${f2x.toFixed(1)} ${f2y.toFixed(1)}`;
    }

    const dots = revCoords.map(([x, y], i) => ({ x, y, ...sliced[i] }));
    const gridY = [0.25, 0.5, 0.75, 1].map(p => ({ y: padT + ch * p, label: Math.round(maxRev * (1 - p)) }));
    return { revPath, shipPath, revArea, forecastPath, dots, gridY };
  }, [sliced]);

  const w = 760, h = 260;
  const padL = 56;
  const cw = w - padL - 56;
  const step = sliced.length > 1 ? cw / (sliced.length - 1) : cw;

  return (
    <div className="col-span-12 lg:col-span-6 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] transition-shadow" data-testid="revenue-trend-card">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-[17px] font-semibold text-slate-900 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-500" />
            Revenue & Shipment Trend
          </h3>
          <p className="text-xs text-slate-500 mt-1">Network performance with 60-day forecast overlay</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {[3, 6, 12].map(m => (
              <button key={m} onClick={() => setTrendWindow(m)} data-testid={`trend-window-${m}m`}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  trendWindow === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}>
                {m}M
              </button>
            ))}
          </div>
          <button className="h-8 w-8 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center" title="Export" data-testid="trend-export">
            <Download className="h-3.5 w-3.5 text-slate-500" />
          </button>
          <button className="h-8 w-8 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center justify-center" title="Expand">
            <Maximize2 className="h-3.5 w-3.5 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{height: `${h}px`}} preserveAspectRatio="none"
             onMouseLeave={() => setHoverIdx(null)}>
          {/* gridlines */}
          {gridY.map((g, i) => (
            <line key={i} x1={padL} x2={padL + cw} y1={g.y} y2={g.y}
              stroke="#f1f5f9" strokeWidth="1" strokeDasharray="3 4" />
          ))}
          <defs>
            <linearGradient id="revgrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#8B5CF6" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={revArea} fill="url(#revgrad)" />
          <path d={revPath} fill="none" stroke="#6366F1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={shipPath} fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 5" opacity="0.85" />

          {/* Forecast (dotted continuation) */}
          {forecastPath && (
            <>
              <path d={forecastPath} fill="none" stroke="#8B5CF6" strokeWidth="2" strokeDasharray="2 5" opacity="0.7" />
              <text x={padL + cw + 10} y={dots[dots.length-1]?.y + 6} fontSize="10" fill="#8B5CF6" fontWeight="600">+forecast</text>
            </>
          )}

          {/* dots on revenue */}
          {dots.map((d, i) => (
            <g key={i} onMouseEnter={() => setHoverIdx(i)}>
              <rect x={d.x - step / 2} y={20} width={step} height={h - 36} fill="transparent" style={{ pointerEvents: 'all', cursor: 'crosshair' }} />
              <circle cx={d.x} cy={d.y} r={hoverIdx === i ? "5" : "3"}
                fill="#6366F1" stroke="white" strokeWidth="2"
                className="transition-all" />
            </g>
          ))}
          {/* hover guideline */}
          {hoverIdx != null && dots[hoverIdx] && (
            <line x1={dots[hoverIdx].x} x2={dots[hoverIdx].x} y1={24} y2={h - 36}
              stroke="#6366F1" strokeWidth="1" strokeDasharray="2 3" opacity="0.4" />
          )}
          {/* x-axis labels */}
          {sliced.map((d, i) => i % Math.max(1, Math.floor(sliced.length / 8)) === 0 && (
            <text key={i} x={padL + i * step} y={h - 8} fontSize="10" textAnchor="middle" fill="#94a3b8">
              {d.month.slice(5)}
            </text>
          ))}
        </svg>

        {/* Hover tooltip */}
        {hoverIdx != null && dots[hoverIdx] && (
          <div className="absolute pointer-events-none px-3 py-2 rounded-lg bg-slate-900 text-white text-xs shadow-2xl"
               style={{ left: `${(dots[hoverIdx].x / w) * 100}%`, top: '8px', transform: 'translateX(-50%)' }}>
            <div className="font-semibold">{dots[hoverIdx].month}</div>
            <div className="text-indigo-300 tabular-nums">Revenue {fmtMoney(dots[hoverIdx].revenue)}</div>
            <div className="text-emerald-300 tabular-nums">Shipments {fmtInt(dots[hoverIdx].shipments)}</div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 text-xs mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2 text-slate-700">
          <span className="h-2.5 w-3 bg-indigo-500 rounded-sm" /> <span className="font-medium">Revenue</span>
        </div>
        <div className="flex items-center gap-2 text-slate-700">
          <svg className="h-2 w-4"><line x1="0" y1="4" x2="16" y2="4" stroke="#10B981" strokeWidth="2" strokeDasharray="4 4" /></svg>
          <span className="font-medium">Shipments</span>
        </div>
        <div className="flex items-center gap-2 text-slate-700">
          <svg className="h-2 w-4"><line x1="0" y1="4" x2="16" y2="4" stroke="#8B5CF6" strokeWidth="2" strokeDasharray="2 3" /></svg>
          <span className="font-medium">Forecast (next 60d)</span>
        </div>
        <div className="ml-auto text-slate-400">Click any point for detail</div>
      </div>
    </div>
  );
}

// ============================================================================
// 4 — REGIONAL PERFORMANCE — Real Nigeria choropleth (state-level shapes)
//     grouped by geopolitical zone, with ranked leaderboard on the right.
// ============================================================================
const ZONE_HEALTH = {
  healthy: { fill: "#10B981", chip: "bg-emerald-100 text-emerald-700", label: "Healthy", dot: "#10B981" },
  watch:   { fill: "#F59E0B", chip: "bg-amber-100 text-amber-700",   label: "Watch",   dot: "#F59E0B" },
  at_risk: { fill: "#EF4444", chip: "bg-rose-100 text-rose-700",     label: "At Risk", dot: "#EF4444" },
  no_data: { fill: "#CBD5E1", chip: "bg-slate-100 text-slate-600",   label: "No Data", dot: "#CBD5E1" },
};

// Display order requested by spec
const LEADERBOARD_ORDER = [
  "South West", "North West", "South East",
  "North Central", "North East", "South South",
];

function RegionalPerformanceCard({ regional, summary }) {
  const [hoverZone, setHoverZone] = useState(null);

  const byZone = useMemo(() => {
    const m = {};
    for (const r of regional) m[r.zone] = r;
    return m;
  }, [regional]);

  // Reorder leaderboard exactly as requested
  const ranked = LEADERBOARD_ORDER.map(z => byZone[z]).filter(Boolean);

  // Zone label centroids — computed once for label placement on the map
  const zoneCentroids = useMemo(() => {
    const acc = {};
    for (const s of STATE_PATHS) {
      // Parse first M coord from path for a rough state centroid
      const m = s.d.match(/M\s+([\d.]+)\s+([\d.]+)/);
      if (!m) continue;
      const x = parseFloat(m[1]); const y = parseFloat(m[2]);
      (acc[s.zone] ||= []).push([x, y]);
    }
    const out = {};
    for (const z of Object.keys(acc)) {
      const pts = acc[z];
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      out[z] = [cx, cy];
    }
    return out;
  }, []);

  const hoverData = hoverZone ? byZone[hoverZone] : null;

  return (
    <div
      className="col-span-12 lg:col-span-6 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] transition-shadow"
      data-testid="regional-performance-card"
    >
      {/* Header — title only (legend moved left of the map) */}
      <div className="flex items-start justify-between mb-1 gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <BarChart3 className="h-4 w-4" />
          </div>
          <h3 className="text-[17px] font-semibold text-slate-900 flex items-center gap-1.5">
            Regional Performance
            <span className="text-slate-400 font-normal">(Revenue)</span>
            <Info className="h-3.5 w-3.5 text-slate-300" />
          </h3>
        </div>
      </div>

      {summary && (
        <p className="text-[12.5px] text-slate-600 mt-1 mb-4 leading-relaxed" data-testid="region-summary">
          {summary}
        </p>
      )}

      {/* Layout: vertical legend (12%) · map (55%) · leaderboard (33%) */}
      <div className="grid grid-cols-12 gap-3">
        {/* LEGEND — vertical stack */}
        <div className="col-span-12 lg:col-span-2 flex lg:flex-col flex-wrap gap-3 lg:gap-4 lg:pt-12" data-testid="region-legend">
          {Object.entries(ZONE_HEALTH).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-[11px] text-slate-600">
              <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ background: v.fill }} />
              <span className="font-medium">{v.label}</span>
            </div>
          ))}
        </div>

        {/* MAP */}
        <div className="col-span-12 lg:col-span-6 relative">
          <NigeriaChoropleth
            byZone={byZone}
            hoverZone={hoverZone}
            setHoverZone={setHoverZone}
            zoneCentroids={zoneCentroids}
          />

          {/* Floating hover tooltip */}
          {hoverData && (
            <div
              className="absolute top-2 left-2 px-3.5 py-2.5 rounded-xl bg-slate-900/95 backdrop-blur text-white text-xs shadow-2xl pointer-events-none animate-fade-rise z-10"
              data-testid="region-hover-tooltip"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: (ZONE_HEALTH[hoverData.health] || ZONE_HEALTH.no_data).fill }} />
                <div className="font-semibold text-[13px]">{hoverData.zone}</div>
                <span className={`ml-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${(ZONE_HEALTH[hoverData.health] || ZONE_HEALTH.no_data).chip} text-slate-900`}>
                  {(ZONE_HEALTH[hoverData.health] || ZONE_HEALTH.no_data).label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-[11px] tabular-nums">
                <div className="text-white/60">Revenue</div>
                <div className="text-right font-semibold">{fmtMoney(hoverData.revenue)}</div>
                <div className="text-white/60">Retailers</div>
                <div className="text-right font-semibold">{fmtInt(hoverData.retailers)}</div>
                <div className="text-white/60">Inventory</div>
                <div className="text-right font-semibold">{fmtInt(hoverData.inventory_units)} u</div>
                <div className="text-white/60">Health Score</div>
                <div className="text-right font-semibold">{hoverData.health_score}/100</div>
              </div>
              {hoverData.growth_pct != null && (
                <div className={`mt-1.5 text-[11px] font-semibold flex items-center gap-1 ${hoverData.growth_pct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {hoverData.growth_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {fmtPct(hoverData.growth_pct)} vs prior period
                </div>
              )}
            </div>
          )}
        </div>

        {/* LEADERBOARD */}
        <div className="col-span-12 lg:col-span-4 flex flex-col" data-testid="region-leaderboard">
          <div className="divide-y divide-slate-100 -mt-1">
            {ranked.map(r => {
              const cfg = ZONE_HEALTH[r.health] || ZONE_HEALTH.no_data;
              const isHover = hoverZone === r.zone;
              const up = (r.growth_pct ?? 0) >= 0;
              return (
                <button
                  key={r.zone}
                  type="button"
                  onMouseEnter={() => setHoverZone(r.zone)}
                  onMouseLeave={() => setHoverZone(null)}
                  className={`w-full text-left py-2.5 px-2 -mx-2 rounded-lg transition-colors ${
                    isHover ? "bg-slate-50" : "hover:bg-slate-50/60"
                  }`}
                  data-testid={`region-${r.zone.replace(/\s+/g,'-')}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm flex-shrink-0" style={{ background: cfg.fill }} />
                    <span className="text-[12.5px] font-medium text-slate-700 truncate">{r.zone}</span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1 ml-[18px]">
                    <span className="text-[14px] font-bold text-slate-900 tabular-nums">{fmtMoney(r.revenue)}</span>
                    <span className={`text-[11px] font-semibold tabular-nums flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-rose-600"}`}>
                      {r.growth_pct != null
                        ? <>
                            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {fmtPct(r.growth_pct)}
                          </>
                        : <span className="text-slate-400">—</span>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Nigeria choropleth — 36 states + FCT, coloured by their parent zone's health.
// ----------------------------------------------------------------------------
function NigeriaChoropleth({ byZone, hoverZone, setHoverZone, zoneCentroids }) {
  return (
    <svg
      viewBox={`0 0 ${NG_VIEWBOX.w} ${NG_VIEWBOX.h}`}
      className="w-full h-auto"
      style={{ maxHeight: 360 }}
      data-testid="nigeria-svg"
    >
      <defs>
        <filter id="region-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0F172A" floodOpacity="0.10" />
        </filter>
      </defs>

      {/* States — coloured by parent zone's health */}
      <g filter="url(#region-shadow)">
        {STATE_PATHS.map(state => {
          const zone = state.zone;
          const data = byZone[zone];
          const health = data?.health || "no_data";
          const cfg = ZONE_HEALTH[health];
          const isHover = hoverZone === zone;
          const isDimmed = hoverZone && !isHover;
          // Subtle per-state lightening so adjacent states are distinguishable
          // within a zone (mimics the variegated reference image).
          const seed = hashStr(state.name);
          const variance = ((seed % 12) - 6) * 1.4; // -8.4 .. +8.4
          return (
            <path
              key={state.name}
              d={state.d}
              fill={cfg.fill}
              fillOpacity={isDimmed ? 0.35 : isHover ? 1 : (0.78 + (variance / 100))}
              stroke="#FFFFFF"
              strokeWidth={isHover ? 1.6 : 0.9}
              strokeLinejoin="round"
              className="transition-all duration-150 cursor-pointer"
              onMouseEnter={() => setHoverZone(zone)}
              onMouseLeave={() => setHoverZone(null)}
            >
              <title>{state.name} · {zone}</title>
            </path>
          );
        })}
      </g>

      {/* Zone labels — centered roughly per zone, only show when not dimmed */}
      {Object.entries(zoneCentroids).map(([zone, [cx, cy]]) => {
        const isHover = hoverZone === zone;
        const data = byZone[zone];
        const health = data?.health || "no_data";
        // Use dark ink on no-data (light grey) zones so the label remains legible;
        // white with a soft shadow on coloured zones.
        const isLight = health === "no_data";
        const labelFill = isLight ? "#334155" : "#FFFFFF";
        const labelShadow = isLight
          ? 'drop-shadow(0 1px 0 rgba(255,255,255,0.7))'
          : 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))';
        return (
          <g key={zone} pointerEvents="none"
             style={{ opacity: hoverZone && !isHover ? 0.25 : 0.95 }}>
            <text
              x={cx} y={cy} textAnchor="middle"
              fontSize="11" fontWeight="700"
              fill={labelFill}
              style={{ filter: labelShadow, letterSpacing: '0.02em' }}
            >
              {zone.split(' ').map((w, i) => (
                <tspan key={i} x={cx} dy={i === 0 ? 0 : 12}>{w}</tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// ============================================================================
// 5 — PRODUCT INTELLIGENCE — rich cards
// ============================================================================
function ProductIntelligenceCard({ products }) {
  return (
    <div className="col-span-12 lg:col-span-5 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="top-products-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[17px] font-semibold text-slate-900">Product Intelligence</h3>
        <Link to="/product-intelligence" className="text-xs text-violet-600 hover:underline font-semibold flex items-center gap-1">View catalog <ArrowRight className="h-3 w-3" /></Link>
      </div>
      <p className="text-xs text-slate-500 mb-4">Top performers across the network · last 30 days</p>

      {products.length === 0 ? (
        <div className="text-xs text-slate-400 py-12 text-center">No sales data yet.</div>
      ) : (
        <div className="space-y-2">
          {products.map((p, i) => (
            <ProductRichRow key={p.id} product={p} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductRichRow({ product, rank }) {
  const up = (product.growth_pct ?? 0) >= 0;
  // Deterministic mini sparkline based on product id
  const seed = product.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const bars = Array.from({ length: 12 }, (_, i) => {
    const v = 0.5 + Math.sin((seed + i * 13) * 0.7) * 0.35 + (i / 12) * (up ? 0.3 : -0.2);
    return Math.max(0.1, Math.min(1, v));
  });

  return (
    <Link to={`/products/${product.id}`}
      className="group flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-100"
      data-testid={`top-product-${rank - 1}`}
    >
      <div className="flex-shrink-0 text-[10px] font-bold text-slate-400 w-4 text-center">{rank}</div>
      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-100 via-indigo-50 to-amber-50 flex items-center justify-center text-violet-600 flex-shrink-0 ring-1 ring-slate-100">
        <Package className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 truncate group-hover:text-violet-700">{product.name}</div>
        <div className="text-[11px] text-slate-500 truncate">{product.category || product.sku || "—"}</div>
      </div>
      {/* mini trend bars */}
      <div className="hidden lg:flex items-end gap-0.5 h-8 w-16">
        {bars.map((b, i) => (
          <div key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${b * 100}%`,
              background: up
                ? `linear-gradient(to top, #10B981, ${i === bars.length - 1 ? '#34D399' : '#A7F3D0'})`
                : `linear-gradient(to top, #F43F5E, ${i === bars.length - 1 ? '#FB7185' : '#FECACA'})`,
              minHeight: '2px',
              opacity: 0.4 + (i / bars.length) * 0.6,
            }}
          />
        ))}
      </div>
      <div className="flex flex-col items-end min-w-[80px]">
        <div className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(product.revenue)}</div>
        <div className={`text-[11px] font-semibold flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-rose-600"}`}>
          {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {fmtPct(product.growth_pct)}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

// ============================================================================
// CATEGORIES — donut + bullet list
// ============================================================================
function CategoriesCard({ categories }) {
  const total = categories.reduce((s, c) => s + c.revenue, 0) || 1;
  let cumulative = 0;
  const colors = ["#6366F1", "#8B5CF6", "#10B981", "#F59E0B", "#EC4899", "#06B6D4"];
  const slices = categories.map((c, i) => {
    const start = (cumulative / total) * 360;
    cumulative += c.revenue;
    const end = (cumulative / total) * 360;
    return { ...c, start, end, color: colors[i % colors.length] };
  });
  const cx = 60, cy = 60, r = 48, ir = 32;
  const polar = (a, R = r) => [cx + R * Math.cos((a - 90) * Math.PI / 180), cy + R * Math.sin((a - 90) * Math.PI / 180)];

  return (
    <div className="col-span-12 lg:col-span-4 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="categories-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[15px] font-semibold text-slate-900">Fastest Growing Categories</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">vs previous period</p>
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]">
            {slices.map((s, i) => {
              const [x1, y1] = polar(s.start);
              const [x2, y2] = polar(s.end);
              const [x3, y3] = polar(s.end, ir);
              const [x4, y4] = polar(s.start, ir);
              const large = (s.end - s.start) > 180 ? 1 : 0;
              const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${large} 0 ${x4} ${y4} Z`;
              return <path key={i} d={d} fill={s.color} className="hover:opacity-80 transition-opacity" />;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-[9px] text-slate-400 uppercase tracking-wider">Top mix</div>
            <div className="text-base font-bold text-slate-900">{categories.length}</div>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          {slices.slice(0, 5).map((c, i) => (
            <div key={c.name} className="flex items-center justify-between text-[11px] gap-2" data-testid={`cat-row-${i}`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <span className="text-slate-700 truncate font-medium">{c.name}</span>
              </div>
              <span className={`font-semibold tabular-nums ${(c.growth_pct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
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
// DEMAND FORECAST — bar chart with gradient
// ============================================================================
function DemandForecastCard({ forecast }) {
  const bars = forecast.bars || [];
  const max = Math.max(...bars, 1);
  return (
    <div className="col-span-12 lg:col-span-3 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="demand-forecast-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[15px] font-semibold text-slate-900">Demand Forecast</h3>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-700 bg-emerald-50">
          <TrendingUp className="h-3 w-3" /> +{forecast.growth_pct}%
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Next 30 days · projected demand</p>
      <div className="text-[28px] font-bold text-slate-900 mb-1 leading-none tabular-nums">+{forecast.growth_pct}%</div>
      <div className="text-[11px] text-slate-500 mb-3">vs current 30-day baseline</div>
      <div className="flex items-end gap-[2px] h-[80px]">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 rounded-t-sm transition-all hover:opacity-100 opacity-90"
            style={{
              height: `${(b / max) * 100}%`,
              background: `linear-gradient(to top, #6366F1, #C4B5FD)`,
              minHeight: '2px',
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
// DISTRIBUTOR INTELLIGENCE — rich table with health badges + mini trend
// ============================================================================
function DistributorIntelligenceCard({ rows }) {
  return (
    <div className="col-span-12 lg:col-span-8 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="distributor-table-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[17px] font-semibold text-slate-900">Distributor Intelligence</h3>
        <Link to="/network" className="text-xs text-violet-600 hover:underline font-semibold flex items-center gap-1">
          View network <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <p className="text-xs text-slate-500 mb-5">Top 8 by revenue · last 30 days</p>

      <div className="grid grid-cols-12 px-3 pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-400 border-b border-slate-100">
        <div className="col-span-4">Distributor</div>
        <div className="col-span-2">Region</div>
        <div className="col-span-2 text-right">Revenue (MTD)</div>
        <div className="col-span-1 text-right">Growth</div>
        <div className="col-span-2">Health</div>
        <div className="col-span-1 text-right">Action</div>
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map((d, i) => (
          <DistributorRichRow key={d.id} d={d} idx={i} />
        ))}
      </div>
    </div>
  );
}

function DistributorRichRow({ d, idx }) {
  const RISK = {
    low: { dot: "#10B981", chip: "bg-emerald-50 text-emerald-700", label: "Healthy" },
    medium: { dot: "#F59E0B", chip: "bg-amber-50 text-amber-700", label: "Watch" },
    high: { dot: "#EF4444", chip: "bg-rose-50 text-rose-700", label: "At Risk" },
  };
  const risk = RISK[d.risk_level] || RISK.low;
  const up = (d.growth_pct ?? 0) >= 0;
  // Deterministic mini sparkline
  const seed = (d.id || "").split('').reduce((a, c) => a + c.charCodeAt(0), 0) + idx;
  const points = Array.from({ length: 8 }, (_, i) => 0.4 + Math.abs(Math.sin((seed + i * 7) * 0.9)) * 0.55);
  const w = 64, h = 18;
  const coords = points.map((p, i) => [i * (w / (points.length - 1)), h - p * (h - 2) - 1]);
  const path = smoothPath(coords);
  const sparkColor = up ? "#10B981" : "#F43F5E";

  return (
    <Link to={`/distributors/${d.id}`} className="grid grid-cols-12 items-center px-3 py-3.5 hover:bg-slate-50 rounded-xl group transition-colors" data-testid={`dist-row-${d.id}`}>
      <div className="col-span-4 flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-100 to-indigo-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
          {d.name?.[0] || "D"}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate group-hover:text-violet-700">{d.name}</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <span className="h-1 w-1 rounded-full" style={{ background: risk.dot }} />
            Score {d.health_score}
          </div>
        </div>
      </div>
      <div className="col-span-2 text-xs text-slate-600 truncate">{d.region || "—"}</div>
      <div className="col-span-2 text-right">
        <div className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(d.revenue_mtd)}</div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-16 h-4 ml-auto mt-0.5" preserveAspectRatio="none">
          <path d={path} fill="none" stroke={sparkColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
        </svg>
      </div>
      <div className={`col-span-1 text-right text-xs font-semibold tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
        {fmtPct(d.growth_pct)}
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${d.health_score}%`, background: risk.dot }} />
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${risk.chip}`}>{risk.label}</span>
      </div>
      <div className="col-span-1 flex items-center justify-end">
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
      </div>
    </Link>
  );
}

// ============================================================================
// STOCKOUT RISK CARD
// ============================================================================
function StockoutRiskCard({ items }) {
  const SEV = {
    high:   { color: "#EF4444", chip: "bg-rose-50 text-rose-700", label: "Critical", Icon: Flame },
    medium: { color: "#F59E0B", chip: "bg-amber-50 text-amber-700", label: "Medium", Icon: AlertTriangle },
    low:    { color: "#10B981", chip: "bg-emerald-50 text-emerald-700", label: "Low", Icon: CheckCircle2 },
  };
  return (
    <div className="col-span-12 lg:col-span-4 bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="stockout-risk-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[15px] font-semibold text-slate-900">Stockout Risk</h3>
        <Link to="/product-intelligence" className="text-xs text-violet-600 hover:underline font-semibold">View all</Link>
      </div>
      <p className="text-xs text-slate-500 mb-4">SKUs projected to deplete within 7 days</p>
      <div className="space-y-3">
        {items.length === 0 && (
          <div className="text-xs text-slate-400 py-8 text-center">All stock healthy across the network.</div>
        )}
        {items.map((it, i) => {
          const sev = SEV[it.severity] || SEV.low;
          const Icon = sev.Icon;
          return (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors" data-testid={`stockout-${i}`}>
              <div className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                   style={{ background: `${sev.color}15`, color: sev.color }}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-900 truncate">{it.product_name}</div>
                <div className="text-[11px] text-slate-500">{it.days_remaining} day{it.days_remaining === 1 ? "" : "s"} of cover remaining</div>
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${sev.chip}`}>{sev.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// 7 — SUPPLY CHAIN PIPELINE — horizontal flow with animated shipment dots
// ============================================================================
function SupplyChainPipeline({ pipeline }) {
  const stages = [
    { key: 'pending',    Icon: Clock,        bg: "#FFFBEB", color: "#B45309", label: "Pending",    count: pipeline.pending,    sub: "Orders queued" },
    { key: 'in_transit', Icon: Truck,        bg: "#EEF2FF", color: "#4338CA", label: "In Transit", count: pipeline.in_transit, sub: "Active shipments" },
    { key: 'delivered',  Icon: CheckCircle2, bg: "#ECFDF5", color: "#047857", label: "Delivered",  count: pipeline.delivered,  sub: "Completed" },
    { key: 'delayed',    Icon: XCircle,      bg: "#FFF1F2", color: "#BE123C", label: "Delayed",    count: pipeline.delayed,    sub: "SLA breach" },
  ];

  return (
    <div className="bg-white rounded-[22px] p-7 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="pipeline-card">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-[17px] font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-500" />
            Supply Chain Pipeline
          </h3>
          <p className="text-xs text-slate-500 mt-1">Real-time shipment flow: Manufacturer → Distributor → Retailer</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Efficiency</div>
            <div className="text-xl font-bold text-emerald-600 tabular-nums">{pipeline.progress_pct}%</div>
          </div>
        </div>
      </div>

      {/* Flow row with connectors */}
      <div className="relative grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* The horizontal connecting line behind the stages */}
        <div className="hidden lg:block absolute top-7 left-[12.5%] right-[12.5%] h-[2px] pointer-events-none">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 2">
            <line x1="0" y1="1" x2="100" y2="1" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="4 4" />
          </svg>
        </div>

        {stages.map((s, i) => {
          const Icon = s.Icon;
          return (
            <div key={s.key} className="relative flex flex-col items-center text-center group" data-testid={`pipeline-${s.label.toLowerCase().replace(' ', '-')}`}>
              {/* Icon bubble */}
              <div className="relative h-14 w-14 rounded-full flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.06)] ring-4 ring-white z-10 group-hover:scale-110 transition-transform"
                   style={{ background: s.bg, color: s.color }}>
                <Icon className="h-5 w-5" />
                {s.count > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                    {s.count}
                  </span>
                )}
              </div>
              {/* Animated shipment dot on the rail (between stages) */}
              {i < stages.length - 1 && (
                <div className="hidden lg:block absolute top-7 left-1/2 w-full h-2 pointer-events-none">
                  <div className="relative h-full w-full overflow-hidden">
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full animate-shipment-flow"
                      style={{
                        background: s.color,
                        boxShadow: `0 0 8px 1px ${s.color}80`,
                        animationDelay: `${i * 0.8}s`,
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="text-2xl font-bold text-slate-900 mt-4 tabular-nums">{fmtInt(s.count)}</div>
              <div className="text-sm font-semibold text-slate-700">{s.label}</div>
              <div className="text-[11px] text-slate-400">{s.sub}</div>
            </div>
          );
        })}
      </div>

      {/* Efficiency footer */}
      <div className="mt-6 pt-6 border-t border-slate-100">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-500">Pipeline efficiency</span>
          <span className="text-emerald-600 font-semibold">{pipeline.progress_pct}% on-time</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300 transition-all duration-1000"
            style={{ width: `${pipeline.progress_pct}%` }} />
        </div>
        <div className="flex items-center gap-6 mt-4 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> SLA met: <span className="font-semibold text-slate-700">{pipeline.progress_pct}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" /> Delayed: <span className="font-semibold text-slate-700">{pipeline.delayed}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Factory className="h-3 w-3 text-slate-400" /> <span>From: Manufacturer</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3 w-3 text-slate-400" /> <span>To: Retailers via distributors</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 8 — ACTIONABLE NETWORK ALERTS — intelligence cards
// ============================================================================
function ActionableAlertsCard({ alerts, atRisk }) {
  const SEV = {
    critical: { color: "#EF4444", chip: "bg-rose-50 text-rose-700 border-rose-200",   label: "Critical", Icon: Flame },
    warning:  { color: "#F59E0B", chip: "bg-amber-50 text-amber-700 border-amber-200", label: "Warning",  Icon: AlertTriangle },
    info:     { color: "#3B82F6", chip: "bg-blue-50 text-blue-700 border-blue-200",   label: "Info",     Icon: Activity },
  };
  const ACTIONS = {
    critical: "Dispatch fast-track shipment",
    warning:  "Notify distributor & monitor",
    info:     "Acknowledge and review weekly",
  };
  const OWNERS = ["Ops Lead", "Network Manager", "Demand Planner", "Regional VP"];

  return (
    <div className="bg-white rounded-[22px] p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="alerts-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[17px] font-semibold text-slate-900 flex items-center gap-2">
          <Bell className="h-4 w-4 text-rose-500" />
          Network Alerts & Actions
        </h3>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-[11px] font-semibold">
            {alerts.length} live · {atRisk} distributors at risk
          </span>
          <Link to="/intel" className="text-xs text-violet-600 hover:underline font-semibold">View all →</Link>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-5">Prioritised by business impact</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {alerts.length === 0 && (
          <div className="col-span-2 text-xs text-slate-400 py-10 text-center">No alerts requiring attention.</div>
        )}
        {alerts.map((a, i) => {
          const sev = SEV[a.severity] || SEV.info;
          const Icon = sev.Icon;
          const owner = OWNERS[i % OWNERS.length];
          const action = ACTIONS[a.severity] || "Review";
          const dueLabel = a.severity === "critical" ? "Due in 24h" : a.severity === "warning" ? "Due in 3 days" : "This week";
          return (
            <div key={i}
              className="group p-4 rounded-2xl border border-slate-100 hover:border-slate-200 hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.10)] transition-all bg-white relative overflow-hidden"
              data-testid={`alert-${i}`}
            >
              {/* Severity edge */}
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r" style={{ background: sev.color }} />
              <div className="flex items-start gap-3 pl-2">
                <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
                     style={{ background: `${sev.color}18`, color: sev.color }}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-slate-900 truncate">{a.title}</h4>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${sev.chip}`}>
                      {sev.label}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-slate-600 line-clamp-2 leading-relaxed">{a.detail}</p>

                  {/* Meta row */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-3 text-[10.5px] text-slate-500">
                      <div className="flex items-center gap-1">
                        <Target className="h-3 w-3" />
                        <span className="font-medium">{action}</span>
                      </div>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <div className="flex items-center gap-1">
                        <span>Owner:</span>
                        <span className="font-semibold text-slate-700">{owner}</span>
                      </div>
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span className={`font-semibold ${a.severity === 'critical' ? 'text-rose-600' : 'text-slate-700'}`}>{dueLabel}</span>
                    </div>
                    <button className="text-[10px] font-semibold text-violet-600 group-hover:underline flex items-center gap-0.5">
                      Take action <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
