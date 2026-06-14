/**
 * Distributor Operations Intelligence Center — Premium Edition.
 *
 * Mirrors the Manufacturer Executive Command Center pattern: snapshot-backed
 * fat aggregator, 6 KPI cards with sparklines, AI Operations Summary,
 * Retailer Performance Matrix (BCG-style 2×2), Regional Coverage,
 * Inventory Health donut, Top / Attention retailers, Category Performance
 * and Order Pipeline funnel.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { useCachedFetch, setCached as setDataCache } from "@/lib/dataCache";
import { RefreshPill } from "@/components/RefreshPill";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, Sparkles, Compass, Trophy, Info,
  AlertOctagon, AlertTriangle, BrainCircuit, ShieldCheck, ArrowRight,
  Boxes, ClipboardList, Truck, Store, Loader2,
  ChevronRight, Package, BarChart3, MapPin,
} from "lucide-react";

const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(1)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtPct = (v) => v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;

const ICON_BY_NAME = {
  "trending-up": TrendingUp, "trending-down": TrendingDown,
  sparkles: Sparkles, "alert-octagon": AlertOctagon,
  "alert-triangle": AlertTriangle, "shield-check": ShieldCheck,
  trophy: Trophy, info: Info, compass: Compass,
};

const TONE = {
  positive: { tile: "bg-emerald-50", text: "text-emerald-700" },
  warning:  { tile: "bg-amber-50",   text: "text-amber-700" },
  critical: { tile: "bg-rose-50",    text: "text-rose-700" },
  info:     { tile: "bg-violet-50",  text: "text-violet-700" },
};

export default function DistributorDashboard() {
  const { session } = useSession();
  const entityId = session?.entity?.id;
  const [refreshing, setRefreshing] = useState(false);

  const cacheKey = entityId ? `dist-os:${entityId}` : null;
  const { data, loading, reload } = useCachedFetch(
    cacheKey,
    () => Api.distributorOps(entityId),
    [entityId],
  );

  const onRefresh = async () => {
    if (!entityId) return;
    setRefreshing(true);
    try {
      const fresh = await Api.refreshDistributorOps(entityId);
      setDataCache(cacheKey, fresh);
      reload();
      toast.success("Operations intelligence refreshed");
    } catch {
      toast.error("Could not refresh — try again");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="distributor-dashboard-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading operations intelligence…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="distributor-dashboard">
      <div className="px-8 py-7 max-w-[1760px] mx-auto space-y-7">
        <TitleBar
          name={data.distributor?.name}
          region={data.distributor?.region}
          asOf={data?._snapshot?.as_of || data.as_of}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />

        <ExecutiveHero
          brief={data.ai_brief}
          health={data.network_health}
          totals={data.totals}
          quadrants={data.quadrant_counts}
        />

        <KPIStrip kpis={data.kpis} />

        {/* Wholesaler network — the distributor's direct downstream customers.
            Per the canonical chain (Distributor → Wholesaler → Retailer) this
            is the primary surface; the legacy retailer-direct cards below
            still show key-account exceptions only. */}
        <WholesalerNetworkSection distributorId={entityId} />

        <div className="grid grid-cols-12 gap-6">
          <RevenueTrendCard trend={data.revenue_trend} />
          <InventoryHealthCard health={data.inventory_health} />
        </div>

        <PerformanceMatrixCard
          matrix={data.performance_matrix}
          counts={data.quadrant_counts}
        />

        <div className="grid grid-cols-12 gap-6">
          <RegionalCoverageCard regions={data.regional_coverage} />
          <CategoryPerformanceCard categories={data.category_performance} />
        </div>

        <div className="grid grid-cols-12 gap-6">
          <TopRetailersCard retailers={data.top_retailers} />
          <AttentionRetailersCard retailers={data.attention_retailers} />
        </div>

        <OrderPipelineCard pipeline={data.order_pipeline} />
      </div>
    </div>
  );
}

/* ---------- Title bar ---------- */
function TitleBar({ name, region, asOf, refreshing, onRefresh }) {
  return (
    <div className="flex items-start justify-between gap-4" data-testid="dist-titlebar">
      <div>
        <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-semibold mb-1">
          Distributor Workspace
        </div>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
          {name || "Distributor"} Operations Intelligence
        </h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
          Retail network performance, inventory health, and AI-driven recommendations
          {region ? <> — anchored in <span className="text-slate-700 font-medium">{region}</span></> : null}.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <RefreshPill asOf={asOf} onRefresh={onRefresh} busy={refreshing} testId="dist-os-refresh" />
      </div>
    </div>
  );
}

/* ---------- Executive Hero ---------- */
function ExecutiveHero({ brief, health, totals, quadrants }) {
  const insights = brief?.insights || [];
  const actions = brief?.recommended_actions || [];
  const score = health?.score ?? 0;
  return (
    <div
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#5b21b6] text-white shadow-2xl"
      data-testid="dist-exec-hero"
    >
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-0 right-0 h-72 w-72 rounded-full bg-violet-400 blur-3xl" />
        <div className="absolute -bottom-12 -left-8 h-64 w-64 rounded-full bg-fuchsia-500 blur-3xl" />
      </div>
      <div className="relative grid grid-cols-12 gap-6 p-8">
        <div className="col-span-12 lg:col-span-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/15 backdrop-blur px-3 text-[11px] font-semibold tracking-wide">
              <BrainCircuit className="h-3.5 w-3.5" /> AI OPERATIONS SUMMARY
            </div>
            <div className="inline-flex h-7 items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-3 text-[11px] font-semibold text-emerald-200">
              <ShieldCheck className="h-3.5 w-3.5" /> Confidence 92%
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.slice(0, 4).map((it, idx) => {
              const Icon = ICON_BY_NAME[it.icon] || Info;
              return (
                <div key={idx} className="rounded-2xl bg-white/10 backdrop-blur border border-white/15 p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold leading-tight">{it.title}</div>
                      <div className="text-[12px] text-white/70 mt-1 leading-snug">{it.detail}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {actions.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {actions.slice(0, 3).map((a, i) => (
                <button
                  key={i}
                  className="group inline-flex items-center gap-2 rounded-xl bg-white text-slate-900 px-4 h-10 text-[13px] font-semibold hover:bg-white/95 transition-colors"
                  data-testid={`hero-action-${i}`}
                >
                  {a.title.length > 50 ? a.title.slice(0, 50) + "…" : a.title}
                  <ArrowRight className="h-3.5 w-3.5 text-slate-500 group-hover:translate-x-0.5 transition-transform" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="col-span-12 lg:col-span-4">
          <HealthGauge score={score} band={health?.band} />
          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <Stat label="Retailers" value={fmtInt(totals?.total_retailers)} />
            <Stat label="Stars" value={fmtInt(quadrants?.stars)} accent="text-emerald-200" />
            <Stat label="Growth Opps" value={fmtInt(quadrants?.growth_opps)} accent="text-amber-200" />
            <Stat label="At Risk" value={fmtInt(quadrants?.at_risk)} accent="text-rose-200" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-xl bg-white/10 border border-white/15 px-3 py-2">
      <div className="text-[10px] tracking-[0.18em] uppercase text-white/60">{label}</div>
      <div className={`text-xl font-semibold mt-0.5 tabular-nums ${accent || ""}`}>{value}</div>
    </div>
  );
}

function HealthGauge({ score, band }) {
  const R = 70;
  const stroke = 12;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const offset = C * (1 - pct * 0.5);
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#facc15" : score >= 40 ? "#f97316" : "#ef4444";
  return (
    <div className="rounded-2xl bg-white/10 border border-white/15 p-5 text-center" data-testid="dist-health-gauge">
      <div className="text-[10px] tracking-[0.18em] uppercase text-white/60 mb-2">Network Health</div>
      <div className="relative mx-auto h-[110px] w-[180px]">
        <svg viewBox="0 0 180 100" className="absolute inset-0 h-full w-full">
          <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,0.15)"
                  strokeWidth={stroke} strokeDasharray={`${C * 0.5} ${C * 0.5}`}
                  transform="rotate(180 90 90)" strokeLinecap="round" />
          <circle cx="90" cy="90" r={R} fill="none" stroke={color}
                  strokeWidth={stroke} strokeDasharray={`${C} ${C}`}
                  strokeDashoffset={offset}
                  transform="rotate(180 90 90)" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-x-0 bottom-2 text-center">
          <div className="text-4xl font-semibold tabular-nums">{score}</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/60 mt-0.5">{band || "—"}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- KPI Strip ---------- */
function KPIStrip({ kpis }) {
  const items = [
    { key: "network_revenue_90d", label: "Network Revenue (90d)", fmt: fmtMoney, icon: BarChart3, accent: "text-violet-600" },
    { key: "active_retailers",    label: "Active Retailers (30d)", fmt: fmtInt,   icon: Store,    accent: "text-emerald-600" },
    { key: "retail_orders_pending", label: "Orders Pending",      fmt: fmtInt,   icon: ClipboardList, accent: "text-amber-600" },
    { key: "dispatched_30d",      label: "Dispatched (30d)",      fmt: fmtInt,   icon: Truck,    accent: "text-blue-600" },
    { key: "inventory_units",     label: "Inventory Units",       fmt: fmtInt,   icon: Boxes,    accent: "text-slate-600" },
    { key: "low_stock_skus",      label: "Low-Stock SKUs",        fmt: fmtInt,   icon: AlertTriangle, accent: "text-rose-600" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4" data-testid="dist-kpi-strip">
      {items.map((it) => (
        <KPICard
          key={it.key}
          label={it.label}
          fmt={it.fmt}
          icon={it.icon}
          accent={it.accent}
          kpi={kpis?.[it.key]}
          testId={`kpi-${it.key}`}
        />
      ))}
    </div>
  );
}

function KPICard({ label, fmt, icon: Icon, accent, kpi, testId }) {
  const val = kpi?.value;
  const growth = kpi?.growth_pct;
  const spark = (kpi?.spark || []).slice(-12);
  const up = (growth ?? 0) >= 0;
  return (
    <div
      className="group rounded-2xl bg-white border border-slate-200 p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
      data-testid={testId}
    >
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold leading-tight max-w-[140px]">
          {label}
        </div>
        <div className={`h-8 w-8 rounded-lg bg-slate-50 flex items-center justify-center ${accent}`}>
          {Icon ? <Icon className="h-4 w-4" /> : null}
        </div>
      </div>
      <div className="mt-3 text-[28px] font-semibold text-slate-900 tabular-nums tracking-tight">
        {fmt(val)}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${growth == null ? "text-slate-400" : up ? "text-emerald-600" : "text-rose-600"}`}>
          {growth != null ? (up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />) : null}
          {fmtPct(growth)}
        </div>
        <MiniSpark values={spark} up={up} />
      </div>
    </div>
  );
}

function MiniSpark({ values, up }) {
  if (!values || values.length === 0) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const w = 70, h = 22;
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const color = up ? "#10b981" : "#ef4444";
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ---------- Revenue Trend ---------- */
function RevenueTrendCard({ trend }) {
  const max = Math.max(...trend.map((t) => t.revenue), 1);
  const w = 720, h = 220, padL = 36, padR = 16, padT = 12, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const step = innerW / Math.max(1, trend.length - 1);
  const pts = trend.map((t, i) => ({
    x: padL + i * step,
    y: padT + innerH - (t.revenue / max) * innerH,
    raw: t,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaPath = pts.length > 0
    ? `${linePath} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z`
    : "";
  const total = trend.reduce((a, t) => a + t.revenue, 0);
  const last7 = trend.slice(-7).reduce((a, t) => a + t.revenue, 0);
  return (
    <div className="col-span-12 lg:col-span-8 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="dist-revenue-trend">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Revenue Trend</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Daily revenue · last 30 days</h3>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">30-day</div>
            <div className="text-lg font-semibold text-slate-900 tabular-nums">{fmtMoney(total)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Last 7d</div>
            <div className="text-lg font-semibold text-violet-700 tabular-nums">{fmtMoney(last7)}</div>
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[240px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rev-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={padL} x2={w - padR}
                y1={padT + innerH * p} y2={padT + innerH * p}
                stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {areaPath && <path d={areaPath} fill="url(#rev-area)" />}
        {linePath && <path d={linePath} fill="none" stroke="#7c3aed" strokeWidth="2.2"
              strokeLinejoin="round" strokeLinecap="round" />}
        {pts.filter((_, i) => i % 5 === 0).map((p, i) => (
          <text key={i} x={p.x} y={h - 8} fontSize="9" fill="#94a3b8" textAnchor="middle">
            {p.raw.date.slice(5)}
          </text>
        ))}
        {[0, 0.5, 1].map((p, i) => (
          <text key={i} x={padL - 6} y={padT + innerH * (1 - p) + 4} fontSize="9" fill="#94a3b8" textAnchor="end">
            {fmtMoney(max * p)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ---------- Inventory Health donut ---------- */
function InventoryHealthCard({ health }) {
  const donut = health?.donut || [];
  const total = donut.reduce((a, d) => a + (d.value || 0), 0) || 1;
  const R = 64, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="col-span-12 lg:col-span-4 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="dist-inventory-health">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Warehouse Inventory</div>
      <h3 className="text-base font-semibold text-slate-900 mt-0.5">Stock Health</h3>
      <div className="flex items-center gap-5 mt-4">
        <div className="relative h-[150px] w-[150px] shrink-0">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
            {donut.map((d, i) => {
              const len = (d.value / total) * C;
              const offset = -acc;
              acc += len;
              return (
                <circle key={i} cx="80" cy="80" r={R} fill="none"
                        stroke={d.color} strokeWidth="16"
                        strokeDasharray={`${len} ${C}`} strokeDashoffset={offset}
                        strokeLinecap="butt" />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-2xl font-semibold text-slate-900 tabular-nums">{fmtInt(health?.total_units)}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Units</div>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {donut.map((d, i) => {
            const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
            return (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                <span className="text-slate-700 font-medium flex-1">{d.label}</span>
                <span className="text-slate-500 tabular-nums">{d.value}</span>
                <span className="text-slate-400 tabular-nums text-[12px]">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- Retailer Performance Matrix (BCG 2×2) ---------- */
function PerformanceMatrixCard({ matrix, counts }) {
  const Q = {
    stars: { color: "#10b981", label: "Stars" },
    cash_cows: { color: "#7c3aed", label: "Cash Cows" },
    growth_opps: { color: "#f59e0b", label: "Growth Opps" },
    at_risk: { color: "#ef4444", label: "At Risk" },
  };
  if (!matrix || matrix.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-8 text-center text-slate-400"
           data-testid="dist-perf-matrix-empty">
        Performance matrix will appear once your retailers start trading.
      </div>
    );
  }
  const maxRev = Math.max(...matrix.map((m) => m.revenue_90d), 1);
  const minGrow = Math.min(-50, ...matrix.map((m) => m.growth_pct));
  const maxGrow = Math.max(50, ...matrix.map((m) => m.growth_pct));
  const span = maxGrow - minGrow || 1;
  const w = 1080, h = 360, pad = 36;
  const innerW = w - pad * 2, innerH = h - pad * 2;
  const xOf = (rev) => pad + (rev / maxRev) * innerW;
  const yOf = (grow) => pad + innerH - ((grow - minGrow) / span) * innerH;
  const medX = pad + innerW * 0.5, medY = pad + innerH * 0.5;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6" data-testid="dist-perf-matrix">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Retailer Portfolio</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Performance Matrix · revenue × growth</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(Q).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-3 h-7 text-[11px] font-semibold text-slate-700">
              <span className="h-2 w-2 rounded-full" style={{ background: v.color }} /> {v.label} · {counts?.[k] || 0}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[400px]">
        <rect x={medX} y={pad}    width={innerW * 0.5} height={innerH * 0.5} fill="#10b981" fillOpacity="0.04" />
        <rect x={pad}  y={pad}    width={innerW * 0.5} height={innerH * 0.5} fill="#f59e0b" fillOpacity="0.04" />
        <rect x={medX} y={medY}   width={innerW * 0.5} height={innerH * 0.5} fill="#7c3aed" fillOpacity="0.04" />
        <rect x={pad}  y={medY}   width={innerW * 0.5} height={innerH * 0.5} fill="#ef4444" fillOpacity="0.04" />
        <line x1={medX} x2={medX} y1={pad} y2={h - pad} stroke="#e2e8f0" strokeDasharray="4 4" />
        <line x1={pad} x2={w - pad} y1={medY} y2={medY} stroke="#e2e8f0" strokeDasharray="4 4" />
        <text x={w - pad - 8} y={pad + 16} fontSize="11" fill="#10b981" textAnchor="end" fontWeight="600">Stars</text>
        <text x={pad + 8} y={pad + 16}    fontSize="11" fill="#f59e0b" textAnchor="start" fontWeight="600">Growth Opps</text>
        <text x={w - pad - 8} y={h - pad - 8} fontSize="11" fill="#7c3aed" textAnchor="end" fontWeight="600">Cash Cows</text>
        <text x={pad + 8} y={h - pad - 8}     fontSize="11" fill="#ef4444" textAnchor="start" fontWeight="600">At Risk</text>
        <text x={w / 2} y={h - 6} fontSize="10" fill="#94a3b8" textAnchor="middle">REVENUE (90d) →</text>
        <text x={12} y={h / 2} fontSize="10" fill="#94a3b8" textAnchor="middle" transform={`rotate(-90 12 ${h / 2})`}>GROWTH % →</text>
        {matrix.map((m) => {
          const color = Q[m.quadrant]?.color || "#94a3b8";
          const radius = 6 + Math.min(14, Math.sqrt(m.revenue_90d / Math.max(maxRev, 1)) * 10);
          return (
            <circle key={m.id} cx={xOf(m.revenue_90d)} cy={yOf(m.growth_pct)} r={radius}
                    fill={color} fillOpacity="0.55" stroke={color} strokeWidth="1.5">
              <title>{`${m.name} · ${fmtMoney(m.revenue_90d)} · ${m.growth_pct.toFixed(1)}%`}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- Regional Coverage ---------- */
function RegionalCoverageCard({ regions }) {
  const max = Math.max(...(regions || []).map((r) => r.revenue), 1);
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="dist-regional">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Regional Coverage</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Revenue by region · last 90 days</h3>
        </div>
        <MapPin className="h-4 w-4 text-slate-400" />
      </div>
      {(!regions || regions.length === 0) ? (
        <div className="text-sm text-slate-400 py-8 text-center">No regional activity yet.</div>
      ) : (
        <div className="space-y-3">
          {regions.slice(0, 7).map((r, i) => {
            const pct = (r.revenue / max) * 100;
            return (
              <div key={i} className="text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-slate-700">{r.region}</div>
                  <div className="text-slate-500 tabular-nums">
                    {fmtMoney(r.revenue)}
                    <span className="text-slate-400 ml-2 text-[12px]">{r.retailers} retailer{r.retailers === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Category Performance ---------- */
function CategoryPerformanceCard({ categories }) {
  const max = Math.max(...(categories || []).map((c) => c.revenue), 1);
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="dist-category-perf">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Category Performance</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Top categories · last 90 days</h3>
        </div>
        <Package className="h-4 w-4 text-slate-400" />
      </div>
      {(!categories || categories.length === 0) ? (
        <div className="text-sm text-slate-400 py-8 text-center">No category sales yet.</div>
      ) : (
        <div className="space-y-3">
          {categories.map((c, i) => {
            const pct = (c.revenue / max) * 100;
            return (
              <div key={i} className="text-sm">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-slate-700">{c.category}</div>
                  <div className="text-slate-500 tabular-nums">
                    {fmtMoney(c.revenue)}
                    <span className="text-slate-400 ml-2 text-[12px]">{fmtInt(c.units)} units</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Top retailers / attention retailers (KEY-ACCOUNT DIRECT ONLY) ---------- */
function TopRetailersCard({ retailers }) {
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="dist-top-retailers">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Key-Account Direct · Top</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Best key-accounts · last 90 days</h3>
          <p className="text-[11px] text-slate-400 mt-1">Retailers (e.g. Shoprite, Spar) served directly. Regular retailers live under wholesalers.</p>
        </div>
        <Link to="/network" className="text-xs text-violet-700 font-semibold hover:underline">View all</Link>
      </div>
      <RetailerList retailers={retailers} tone="positive" testIdPrefix="top-retailer" />
    </div>
  );
}

function AttentionRetailersCard({ retailers }) {
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="dist-attention-retailers">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Key-Account Direct · Needs Attention</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Key-accounts requiring intervention</h3>
        </div>
        <AlertTriangle className="h-4 w-4 text-rose-500" />
      </div>
      <RetailerList retailers={retailers} tone="critical" testIdPrefix="attention-retailer" />
    </div>
  );
}

function RetailerList({ retailers, tone, testIdPrefix }) {
  if (!retailers || retailers.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No retailers to show.</div>;
  }
  const t = TONE[tone];
  return (
    <div className="space-y-2">
      {retailers.map((r, i) => {
        const up = (r.growth_pct ?? 0) >= 0;
        return (
          <Link
            key={r.id}
            to={`/network/retailer/${r.id}`}
            data-testid={`${testIdPrefix}-${i}`}
            className="group flex items-center gap-3 rounded-xl border border-slate-100 p-3 hover:border-violet-300 hover:bg-violet-50/40 transition-colors"
          >
            <div className={`h-9 w-9 rounded-lg ${t.tile} flex items-center justify-center font-semibold text-[13px] ${t.text}`}>
              {String(r.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">{r.name}</div>
              <div className="text-[11px] text-slate-500">{r.city || "—"} · {r.region || "—"}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold text-slate-900 tabular-nums">{fmtMoney(r.revenue_90d)}</div>
              <div className={`text-[11px] font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                {fmtPct(r.growth_pct)}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-violet-500 group-hover:translate-x-0.5 transition-all" />
          </Link>
        );
      })}
    </div>
  );
}

/* ---------- Order Pipeline ---------- */
function OrderPipelineCard({ pipeline }) {
  const stages = [
    { key: "pending",      label: "Pending Approval",  icon: ClipboardList, color: "from-slate-400 to-slate-600",     bg: "bg-slate-50",     text: "text-slate-700" },
    { key: "approved",     label: "Approved",          icon: ShieldCheck,    color: "from-blue-400 to-blue-600",      bg: "bg-blue-50",      text: "text-blue-700" },
    { key: "dispatched",   label: "Dispatched",        icon: Truck,          color: "from-amber-400 to-amber-600",    bg: "bg-amber-50",     text: "text-amber-700" },
    { key: "delivered_30d",label: "Delivered (30d)",   icon: ShieldCheck,    color: "from-emerald-400 to-emerald-600", bg: "bg-emerald-50",   text: "text-emerald-700" },
  ];
  const total = stages.reduce((a, s) => a + (pipeline?.[s.key] || 0), 0) || 1;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6" data-testid="dist-order-pipeline">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Order Pipeline</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Manufacturer → Distributor flow</h3>
        </div>
        <Link to="/shipments" className="text-xs text-violet-700 font-semibold hover:underline">Open Shipments</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stages.map((s) => {
          const Icon = s.icon;
          const v = pipeline?.[s.key] || 0;
          const pct = Math.round((v / total) * 100);
          return (
            <div key={s.key} className="rounded-xl border border-slate-100 p-4" data-testid={`pipeline-${s.key}`}>
              <div className="flex items-center justify-between">
                <div className={`h-9 w-9 rounded-lg ${s.bg} ${s.text} flex items-center justify-center`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-[11px] text-slate-400 font-semibold">{pct}%</div>
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-900 tabular-nums">{fmtInt(v)}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mt-0.5">{s.label}</div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full bg-gradient-to-r ${s.color} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
