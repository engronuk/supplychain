/**
 * Distributor Intelligence Center — Manufacturer's drill-down into a single
 * distributor's downstream retail network.
 *
 * Pixel-perfect Fortune-500 layout:
 *   1. Breadcrumb + header (name · status · region · onboarded date · CTAs)
 *   2. 6 hero KPIs (retailers, products, retail revenue 90D, network health,
 *      stockout risk, avg sell-through)
 *   3. AI Executive Summary (purple gradient) + Network Health gauge
 *   4. Retail Performance Matrix (BCG-style scatter, dots only)
 *      + Retail Coverage Map (bubble city map)
 *   5. Top Retailers + Product Penetration + Retailers Requiring Attention
 *   6. Full Retailer Intelligence table (search / filter / export)
 *
 * All data is sourced from a single fat endpoint:
 *   GET /api/manufacturer/:id/distributor-intelligence/:distributor_id
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import EditDistributorDialog from "@/components/EditDistributorDialog";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, ArrowDownRight, ChevronRight,
  MapPin, Calendar, Mail, Edit2, MoreHorizontal, Sparkles,
  Users, Package2, Coins, Activity, ShoppingCart, AlertTriangle,
  TrendingUp, TrendingDown, Gauge, Clock, Info, Loader2,
  Search, Filter, Download, ExternalLink, CheckCircle2,
  Eye, BarChart3,
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
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const titleCase = (s) => (s || "").replace(/(^|\s)\S/g, c => c.toUpperCase());

// =============================================================================
// MAIN VIEW
// =============================================================================
export default function ManufacturerDistributorDetail() {
  const { distributorId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = () => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerDistributorIntelligence(session.entity.id, distributorId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [distributorId, session?.entity?.id]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="distributor-intel-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading distributor intelligence…
        </div>
      </div>
    );
  }

  const d = data.distributor;

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="manufacturer-distributor-detail">
      <div className="px-8 py-7 max-w-[1840px] mx-auto space-y-6">
        <Breadcrumb name={d.name} onBack={() => navigate(-1)} />
        <Header distributor={d} onEdit={() => setEditOpen(true)} />

        <KPIStrip kpis={data.kpis} retailerCount={data.retailer_table.length}
                  productsCount={data.product_penetration.length} />

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8">
            <AIBriefHero brief={data.ai_brief} />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <NetworkHealthGauge score={data.ai_brief.score.value}
                                 status={data.ai_brief.score.status} />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-7">
            <RetailPerformanceMatrix items={data.retail_performance_matrix} />
          </div>
          <div className="col-span-12 xl:col-span-5">
            <RetailCoverageMap rows={data.retail_coverage} />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-4">
            <TopRetailers rows={data.top_retailers} distributorId={distributorId} />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <ProductPenetration rows={data.product_penetration} />
          </div>
          <div className="col-span-12 lg:col-span-4">
            <AttentionList rows={data.attention_retailers} distributorId={distributorId} />
          </div>
        </div>

        <WholesalerNetworkTable distributorId={distributorId} />

        <EditDistributorDialog
          open={editOpen} onOpenChange={setEditOpen}
          distributor={d}
          onSaved={() => { setEditOpen(false); load(); }}
        />
      </div>
    </div>
  );
}

// =============================================================================
// WHOLESALER NETWORK TABLE — replaces the legacy direct-retailer drill table.
// Reuses the existing /distributor/{id}/wholesaler-network endpoint. Clicking
// a wholesaler opens the wholesaler detail page where retailers live.
// =============================================================================
function WholesalerNetworkTable({ distributorId }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!distributorId) return;
    let live = true;
    setLoading(true);
    Api.distributorWholesalerNetwork(distributorId)
      .then((d) => { if (live) setRows(d?.wholesalers || []); })
      .catch(() => { if (live) setRows([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [distributorId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((w) =>
      (w.name || "").toLowerCase().includes(q)
      || (w.code || "").toLowerCase().includes(q)
      || (w.city || "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70"
         data-testid="wholesaler-network-table">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.18em] text-slate-400 font-semibold">
            Direct downstream · ownership
          </div>
          <h3 className="text-[17px] font-semibold text-slate-900 mt-0.5">
            Wholesaler Network
            <span className="ml-2 text-[12px] font-medium text-slate-500">({rows.length} wholesalers)</span>
          </h3>
          <p className="text-[12.5px] text-slate-500 mt-1">
            Strict ownership chain: <span className="font-semibold text-slate-700">Distributor → Wholesaler → Retailer</span>.
            Open a wholesaler to see the retailers they own.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="text"
            placeholder="Search wholesaler…"
            className="h-9 pl-9 pr-3 w-[240px] rounded-xl border border-slate-200 bg-slate-50 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
            data-testid="wholesaler-network-search"
          />
        </div>
      </div>

      <div className="overflow-x-auto mt-3">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold border-b border-slate-100">
              <th className="text-left pb-3 pl-2">Wholesaler</th>
              <th className="text-left pb-3">Location</th>
              <th className="text-right pb-3">Retailers</th>
              <th className="text-right pb-3">Active 30d</th>
              <th className="text-right pb-3">Revenue (90d)</th>
              <th className="text-right pb-3">Growth</th>
              <th className="text-right pb-3">Pending</th>
              <th className="text-left pb-3">Status</th>
              <th className="text-right pb-3 pr-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading && (
              <tr><td colSpan={9} className="text-center py-10 text-slate-500">Loading wholesalers…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={9} className="text-center py-10 text-slate-500">
                {rows.length === 0
                  ? "No wholesalers under this distributor yet."
                  : "No wholesalers match your search."}
              </td></tr>
            )}
            {!loading && filtered.map((w) => {
              const up = (w.growth_pct ?? 0) >= 0;
              const tone =
                w.status === "healthy" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                w.status === "warning" ? "bg-amber-50 text-amber-700 border-amber-200" :
                "bg-rose-50 text-rose-700 border-rose-200";
              const drillTo = `/distributor/${distributorId}/wholesaler/${w.id}`;
              return (
                <tr key={w.id} data-testid={`wholesaler-net-row-${w.id}`} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 pl-2">
                    <Link to={drillTo} className="block group" data-testid={`wholesaler-net-link-${w.id}`}>
                      <div className="font-medium text-slate-900 group-hover:text-violet-600 transition-colors flex items-center gap-1">
                        {w.name}
                        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 font-mono">{w.code}</div>
                    </Link>
                  </td>
                  <td className="text-slate-600">{w.city || "—"}, {w.region || "—"}</td>
                  <td className="text-right tabular-nums font-semibold text-slate-900">{fmtInt(w.retailer_count)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{fmtInt(w.active_retailers_30d)}</td>
                  <td className="text-right tabular-nums font-semibold">{fmtMoney(w.revenue_90d)}</td>
                  <td className={`text-right tabular-nums font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
                    {fmtPct(w.growth_pct)}
                  </td>
                  <td className="text-right tabular-nums">{fmtInt(w.pending_orders)}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-semibold ${tone}`}>
                      {w.status || "—"}
                    </span>
                  </td>
                  <td className="text-right pr-2">
                    <Link to={drillTo} className="text-violet-700 hover:text-violet-900 font-semibold text-xs inline-flex items-center gap-1"
                          data-testid={`wholesaler-net-drill-${w.id}`}>
                      <Eye className="h-3.5 w-3.5" /> View retailers
                    </Link>
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

// =============================================================================
// BREADCRUMB
// =============================================================================
function Breadcrumb({ name, onBack }) {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-slate-500 font-semibold tracking-wider uppercase" data-testid="distributor-breadcrumb">
      <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-violet-600 transition-colors" data-testid="back-btn">
        <ArrowLeft className="h-3 w-3" /> Distributors
      </button>
      <ChevronRight className="h-3 w-3 text-slate-300" />
      <span className="text-slate-700 truncate max-w-[40vw]">{name}</span>
      <ChevronRight className="h-3 w-3 text-slate-300" />
      <span className="text-slate-400">Intelligence Center</span>
    </div>
  );
}

// =============================================================================
// HEADER
// =============================================================================
function Header({ distributor: d, onEdit }) {
  const status = (d.status || "active").toLowerCase();
  const statusChip = {
    active:  "bg-emerald-50 text-emerald-700 ring-emerald-200/60",
    pending: "bg-amber-50 text-amber-700 ring-amber-200/60",
    inactive:"bg-slate-100 text-slate-600 ring-slate-200",
  }[status] || "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <div className="flex items-start justify-between gap-4 flex-wrap" data-testid="distributor-header">
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[34px] font-bold tracking-tight text-slate-900 leading-none truncate max-w-[60vw]">
            {titleCase(d.name)}
          </h1>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-semibold ring-1 ${statusChip}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {titleCase(status)}
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap mt-3 text-[12.5px] text-slate-500">
          {d.region && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium text-slate-700">{d.region}</span>
            </span>
          )}
          {d.city && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium text-slate-700">{d.city}</span>
            </span>
          )}
          {d.created_at && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-slate-400" />
              <span>Onboarded {fmtDate(d.created_at)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors" data-testid="view-retailers-btn">
          <Users className="h-3.5 w-3.5 text-slate-500" /> View Retailers
        </button>
        <button className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors" data-testid="retail-heatmap-btn">
          <BarChart3 className="h-3.5 w-3.5 text-slate-500" /> Retail Heatmap
        </button>
        {d.contact_email && (
          <a href={`mailto:${d.contact_email}`} className="inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors" data-testid="contact-distributor-btn">
            <Mail className="h-3.5 w-3.5 text-slate-500" /> Contact
          </a>
        )}
        <button onClick={onEdit}
          className="inline-flex items-center gap-2 px-4 h-10 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#8B5CF6] text-white text-[12.5px] font-semibold hover:opacity-90 transition-opacity shadow-sm"
          data-testid="page-edit-distributor-btn">
          <Edit2 className="h-3.5 w-3.5" /> Edit Distributor
        </button>
        <button className="inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors" data-testid="more-actions-btn">
          <MoreHorizontal className="h-4 w-4 text-slate-500" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// KPI STRIP — 6 hero cards
// =============================================================================
function KPIStrip({ kpis, retailerCount, productsCount }) {
  const cards = [
    { id: "retailers", label: "Retailers Managed", value: fmtInt(retailerCount),
      sub: `${kpis.active_retailers.value} active`, Icon: Users, color: "indigo" },
    { id: "products", label: "Products Distributed", value: fmtInt(productsCount || 0),
      sub: "SKUs in network", Icon: Package2, color: "violet" },
    { id: "retail_revenue", label: "Retail Revenue (90D)", value: fmtMoney(kpis.retail_revenue_90d.value),
      sub: kpis.retail_revenue_90d.sub, Icon: Coins, color: "emerald",
      growth: kpis.retail_revenue_90d.growth_pct, spark: kpis.retail_revenue_90d.spark },
    { id: "network_health", label: "Retail Network Health", value: `${kpis.network_health_score.value}%`,
      sub: kpis.network_health_score.status, Icon: Activity, color: "green",
      spark: kpis.network_health_score.spark },
    { id: "stockout_risk", label: "Stockout Risk", value: fmtInt(kpis.stockout_risk_retailers.value),
      sub: kpis.stockout_risk_retailers.sub, Icon: AlertTriangle, color: "rose",
      spark: kpis.stockout_risk_retailers.spark },
    { id: "sell_through", label: "Avg Sell-Through", value: `${kpis.avg_sell_through.value}%`,
      sub: kpis.avg_sell_through.sub, Icon: Gauge, color: "amber",
      spark: kpis.avg_sell_through.spark },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="distributor-kpis">
      {cards.map(c => <KPICard key={c.id} {...c} />)}
    </div>
  );
}

const PALETTE = {
  indigo:  { bg: "#EEF2FF", fg: "#4338CA" },
  violet:  { bg: "#F5F3FF", fg: "#7C3AED" },
  emerald: { bg: "#ECFDF5", fg: "#047857" },
  green:   { bg: "#F0FDF4", fg: "#15803D" },
  rose:    { bg: "#FFF1F2", fg: "#BE123C" },
  amber:   { bg: "#FFFBEB", fg: "#B45309" },
};

function KPICard({ id, label, value, sub, Icon, color, growth, spark }) {
  const c = PALETTE[color];
  const hasGrowth = growth !== undefined && growth !== null;
  const up = (growth ?? 0) >= 0;
  return (
    <div
      className="group bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 transition-all duration-300 border border-slate-100/70"
      data-testid={`kpi-${id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: c.bg, color: c.fg }}
        >
          <Icon className="h-4 w-4" />
        </div>
        {spark && spark.length > 1 && <SparkLine points={spark} color={c.fg} />}
      </div>
      <div className="mt-3.5">
        <div className="text-[11px] font-semibold text-slate-500 leading-tight">{label}</div>
        <div className="flex items-baseline gap-2 mt-1">
          <div className="text-[26px] font-bold text-slate-900 leading-none tabular-nums tracking-tight">{value}</div>
          {hasGrowth && (
            <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
              {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {fmtPct(growth)}
            </span>
          )}
        </div>
        <div className="text-[10.5px] text-slate-400 mt-1.5">{sub}</div>
      </div>
    </div>
  );
}

function SparkLine({ points, color }) {
  const w = 76, h = 26;
  const valid = points.filter(p => Number.isFinite(p));
  if (valid.length < 2) return null;
  const max = Math.max(...valid), min = Math.min(...valid);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${w} ${h} L 0 ${h} Z`;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[76px] h-[26px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color.replace("#", "")})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(points.length - 1) * step} cy={h - ((last - min) / range) * (h - 4) - 2} r="1.8" fill={color} stroke="white" strokeWidth="1" />
    </svg>
  );
}

// =============================================================================
// AI EXECUTIVE SUMMARY (purple gradient)
// =============================================================================
function AIBriefHero({ brief }) {
  return (
    <div className="relative overflow-hidden rounded-2xl h-full shadow-[0_20px_50px_-15px_rgba(109,40,217,0.5)]" data-testid="ai-exec-summary">
      <div className="absolute inset-0 bg-gradient-to-br from-[#4C1D95] via-[#6D28D9] to-[#7C3AED]" />
      <div className="absolute inset-0 opacity-[0.12] bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.6),transparent_45%)]" />
      <div className="absolute -top-24 -right-24 h-[280px] w-[280px] rounded-full bg-fuchsia-400/20 blur-3xl" />

      <div className="relative px-6 lg:px-7 py-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-amber-200" />
          <h2 className="text-[15px] font-semibold tracking-tight text-white">AI Executive Summary</h2>
        </div>
        <ul className="space-y-2.5">
          {brief.insights.map((ins, i) => (
            <li key={i} className="flex items-start gap-3 text-white/95" data-testid={`ai-insight-${i}`}>
              <span className="h-6 w-6 rounded-lg bg-white/15 backdrop-blur flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10.5px] font-bold text-white/90">{i + 1}</span>
              </span>
              <span className="text-[13px] leading-snug">{ins}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// =============================================================================
// NETWORK HEALTH GAUGE (semi-circle)
// =============================================================================
function NetworkHealthGauge({ score, status }) {
  const color = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";
  const bgColor = score >= 80 ? "bg-emerald-50" : score >= 60 ? "bg-amber-50" : "bg-rose-50";
  const txtColor = score >= 80 ? "text-emerald-700" : score >= 60 ? "text-amber-700" : "text-rose-700";
  const ringColor = score >= 80 ? "ring-emerald-200/60" : score >= 60 ? "ring-amber-200/60" : "ring-rose-200/60";

  // Semi-circle arc (180°)
  const r = 70;
  const cx = 96, cy = 96;
  const startAngle = Math.PI; // left
  const endAngle = 2 * Math.PI; // right
  const valAngle = startAngle + (endAngle - startAngle) * (score / 100);
  const x0 = cx + r * Math.cos(startAngle), y0 = cy + r * Math.sin(startAngle);
  const xV = cx + r * Math.cos(valAngle), yV = cy + r * Math.sin(valAngle);
  const xE = cx + r * Math.cos(endAngle), yE = cy + r * Math.sin(endAngle);
  const largeArc = (valAngle - startAngle) > Math.PI ? 1 : 0;
  const trackPath = `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${xE} ${yE}`;
  const valPath = `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${xV} ${yV}`;

  return (
    <div className="bg-white rounded-2xl p-6 h-full shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 flex flex-col" data-testid="network-health-gauge">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-slate-900">Network Health Score</h3>
        <Info className="h-3.5 w-3.5 text-slate-300" />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="relative w-[192px] h-[120px]">
          <svg viewBox="0 0 192 120" className="w-full h-full">
            <path d={trackPath} fill="none" stroke="#F1F5F9" strokeWidth="14" strokeLinecap="round" />
            <path d={valPath} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
          </svg>
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center pb-1">
            <div className="text-[36px] font-bold text-slate-900 tabular-nums leading-none">
              {score}
              <span className="text-[13px] text-slate-400 ml-0.5">/100</span>
            </div>
            <span className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ring-1 ${bgColor} ${txtColor} ${ringColor}`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {status}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
        <span>0</span>
        <span className="text-center">50</span>
        <span className="text-right">100</span>
      </div>
    </div>
  );
}

// =============================================================================
// RETAIL PERFORMANCE MATRIX (BCG-style scatter, dots only)
// =============================================================================
const QUAD_TINT = {
  emerging:    { bg: "bg-emerald-50/40", text: "text-emerald-700", label: "Growth Opportunities", sub: "Low Rev · High Growth" },
  stars:       { bg: "bg-violet-50/40",  text: "text-violet-700",  label: "Stars",                sub: "High Rev · High Growth" },
  at_risk:     { bg: "bg-rose-50/40",    text: "text-rose-700",    label: "At Risk",              sub: "Low Rev · Low Growth" },
  cash_cows:   { bg: "bg-blue-50/40",    text: "text-blue-700",    label: "Cash Cows",            sub: "High Rev · Low Growth" },
};
const HEALTH_FILL = { healthy: "#10B981", watch: "#F59E0B", risk: "#EF4444" };
const QUAD_FILL  = { stars: "#7C3AED", growth_opps: "#10B981", cash_cows: "#3B82F6", at_risk: "#EF4444" };

function RetailPerformanceMatrix({ items }) {
  const W = 460, H = 320, PADX = 18, PADY = 18;
  const [hover, setHover] = useState(null);

  const enriched = useMemo(() => items.filter(x => Number.isFinite(x.revenue_90d)), [items]);

  const xs = enriched.map(i => i.revenue_90d);
  const xMax = Math.max(...xs, 1);
  const xScale = (v) => Math.sqrt(Math.max(v, 0) / xMax);

  // Y axis: growth clamped to a wide range; spread if clustered
  const yClamp = (g) => Math.max(Math.min(g ?? 0, 200), -50);
  const yNorm = (g) => (yClamp(g) + 50) / 250;
  const gs = enriched.map(p => yClamp(p.growth_pct));
  const range = gs.length ? Math.max(...gs) - Math.min(...gs) : 0;
  const rankByRev = useMemo(() => {
    const sorted = [...enriched].sort((a, b) => b.revenue_90d - a.revenue_90d);
    const m = {};
    sorted.forEach((p, i) => { m[p.id] = i; });
    return m;
  }, [enriched]);
  const useFallback = range < 10;

  // Radius based on revenue
  const rxMax = Math.max(...xs, 1);
  const rxMin = Math.min(...xs, 0);
  const rScale = (v) => 6 + Math.sqrt((v - rxMin) / (rxMax - rxMin || 1)) * 10;

  // Initial positions
  const raw = enriched.map(p => {
    let cy;
    if (useFallback) {
      const rank = rankByRev[p.id];
      const norm = enriched.length > 1 ? rank / (enriched.length - 1) : 0.5;
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
  // Force-style anti-overlap
  for (let it = 0; it < 80; it++) {
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
      raw[i].cx = Math.max(PADX + raw[i].r, Math.min(W - PADX - raw[i].r, raw[i].cx));
      raw[i].cy = Math.max(PADY + raw[i].r, Math.min(H - PADY - raw[i].r, raw[i].cy));
    }
    if (moved === 0) break;
  }

  const quadCount = {
    stars: enriched.filter(p => p.quadrant === "stars").length,
    growth_opps: enriched.filter(p => p.quadrant === "growth_opps").length,
    cash_cows: enriched.filter(p => p.quadrant === "cash_cows").length,
    at_risk: enriched.filter(p => p.quadrant === "at_risk").length,
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="retail-performance-matrix">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-[15px] font-semibold text-slate-900 flex items-center gap-1.5">
          Retail Performance Matrix
          <Info className="h-3 w-3 text-slate-300" />
        </h3>
        <div className="flex items-center gap-3 text-[10.5px] text-slate-600">
          {[{ k: "healthy", l: "Excellent" }, { k: "watch", l: "Watch" }, { k: "risk", l: "At Risk" }].map(it => (
            <div key={it.k} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_FILL[it.k] }} />
              <span className="font-medium">{it.l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        {/* Y axis hints */}
        <div className="absolute left-0 top-0 h-full w-7 flex flex-col items-end justify-between text-[9px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-1">
          <span>High</span>
          <span className="-rotate-90 whitespace-nowrap py-2 text-slate-500">Growth</span>
          <span>Low</span>
        </div>

        <div className="ml-7">
          <div className="relative rounded-xl overflow-hidden border border-slate-100" style={{ aspectRatio: `${W}/${H}` }}>
            {/* quadrant tints */}
            <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
              <div className={`${QUAD_TINT.emerging.bg} border-r border-b border-slate-100 relative`}>
                <div className="absolute top-2 left-3">
                  <div className={`text-[10.5px] font-bold ${QUAD_TINT.emerging.text}`}>{QUAD_TINT.emerging.label}</div>
                  <div className="text-[8.5px] text-slate-500">{QUAD_TINT.emerging.sub}</div>
                </div>
              </div>
              <div className={`${QUAD_TINT.stars.bg} border-b border-slate-100 relative`}>
                <div className="absolute top-2 right-3 text-right">
                  <div className={`text-[10.5px] font-bold ${QUAD_TINT.stars.text}`}>{QUAD_TINT.stars.label}</div>
                  <div className="text-[8.5px] text-slate-500">{QUAD_TINT.stars.sub}</div>
                </div>
              </div>
              <div className={`${QUAD_TINT.at_risk.bg} border-r border-slate-100 relative`}>
                <div className="absolute bottom-2 left-3">
                  <div className={`text-[10.5px] font-bold ${QUAD_TINT.at_risk.text}`}>{QUAD_TINT.at_risk.label}</div>
                  <div className="text-[8.5px] text-slate-500">{QUAD_TINT.at_risk.sub}</div>
                </div>
              </div>
              <div className={`${QUAD_TINT.cash_cows.bg} relative`}>
                <div className="absolute bottom-2 right-3 text-right">
                  <div className={`text-[10.5px] font-bold ${QUAD_TINT.cash_cows.text}`}>{QUAD_TINT.cash_cows.label}</div>
                  <div className="text-[8.5px] text-slate-500">{QUAD_TINT.cash_cows.sub}</div>
                </div>
              </div>
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
              <line x1={W / 2} y1={PADY} x2={W / 2} y2={H - PADY} stroke="#CBD5E1" strokeWidth="0.8" strokeDasharray="3 3" />
              <line x1={PADX} y1={H / 2} x2={W - PADX} y2={H / 2} stroke="#CBD5E1" strokeWidth="0.8" strokeDasharray="3 3" />
              {raw.map(p => {
                const isHover = hover?.id === p.id;
                const fill = HEALTH_FILL[p.health] || HEALTH_FILL.healthy;
                return (
                  <g key={p.id} style={{ cursor: "pointer" }}
                     onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
                    {isHover && <circle cx={p.cx} cy={p.cy} r={p.r + 5} fill="none" stroke={fill} strokeWidth="1.5" opacity="0.45" />}
                    <circle cx={p.cx} cy={p.cy} r={p.r} fill={fill} fillOpacity="0.85" stroke="white" strokeWidth="1.6" />
                  </g>
                );
              })}
            </svg>

            {hover && (
              <div className="absolute z-30 pointer-events-none animate-fade-rise" style={{
                left: `${(hover.cx / W) * 100}%`, top: `${(hover.cy / H) * 100}%`,
                transform: `translate(${hover.cx > W / 2 ? "calc(-100% - 16px)" : "16px"}, -50%)`,
              }}>
                <div className="rounded-xl bg-slate-900/95 backdrop-blur text-white px-4 py-3 shadow-2xl text-[11px] tabular-nums w-[220px]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: HEALTH_FILL[hover.health] }} />
                    <div className="font-semibold text-[12.5px] leading-tight">{hover.name}</div>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <div className="text-white/60">Revenue</div>
                    <div className="text-right font-semibold">{fmtMoney(hover.revenue_90d)}</div>
                    <div className="text-white/60">Growth</div>
                    <div className={`text-right font-semibold ${(hover.growth_pct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(hover.growth_pct)}</div>
                    <div className="text-white/60">Units</div>
                    <div className="text-right font-semibold">{fmtInt(hover.units_90d)}</div>
                    <div className="text-white/60">Health</div>
                    <div className="text-right font-semibold capitalize">{hover.health}</div>
                  </div>
                </div>
              </div>
            )}

            {enriched.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">
                No retailer sales data yet.
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-1.5">
            <span>Low</span>
            <span className="text-slate-500">Revenue (90D)</span>
            <span>High</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-100">
        {[
          { k: "stars", label: "Stars", color: QUAD_FILL.stars, bg: "bg-violet-50" },
          { k: "growth_opps", label: "Growth Opps", color: QUAD_FILL.growth_opps, bg: "bg-emerald-50" },
          { k: "cash_cows", label: "Cash Cows", color: QUAD_FILL.cash_cows, bg: "bg-blue-50" },
          { k: "at_risk", label: "At Risk", color: QUAD_FILL.at_risk, bg: "bg-rose-50" },
        ].map(q => (
          <div key={q.k} className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${q.bg}`} data-testid={`matrix-quad-${q.k}`}>
            <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: q.color }} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-slate-500 leading-tight">{q.label}</div>
              <div className="text-[12.5px] font-bold text-slate-900 tabular-nums leading-tight">
                {quadCount[q.k]}<span className="text-slate-500 font-medium text-[10px] ml-1">Retailer{quadCount[q.k] === 1 ? "" : "s"}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// RETAIL COVERAGE MAP (city bubbles)
// =============================================================================
const CITY_BAND = {
  excellent: { fill: "#10B981", ring: "rgba(16,185,129,0.18)" },
  good:      { fill: "#22C55E", ring: "rgba(34,197,94,0.15)" },
  fair:      { fill: "#F59E0B", ring: "rgba(245,158,11,0.18)" },
  poor:      { fill: "#FB923C", ring: "rgba(251,146,60,0.18)" },
  critical:  { fill: "#EF4444", ring: "rgba(239,68,68,0.18)" },
};

function RetailCoverageMap({ rows }) {
  const [sortKey, setSortKey] = useState("revenue");
  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => sortKey === "revenue" ? b.revenue_90d - a.revenue_90d : b.retailer_count - a.retailer_count);
    return list.slice(0, 9);
  }, [rows, sortKey]);

  // Bubble layout: polar coordinates around the centre
  const W = 400, H = 320;
  const cx = W / 2, cy = H / 2;
  const rMax = Math.max(...sorted.map(r => r.retailer_count), 1);
  const rMin = Math.min(...sorted.map(r => r.retailer_count), 0);
  const rScale = (n) => 18 + (n - rMin) / (rMax - rMin || 1) * 22;

  const placed = sorted.map((row, i) => {
    if (i === 0) return { ...row, cx, cy, r: rScale(row.retailer_count) };
    const ringStep = Math.ceil((i + 1) / 6);
    const radius = ringStep * 78;
    const angle = ((i - 1) * (2 * Math.PI / 6)) + (ringStep % 2) * 0.3;
    return {
      ...row,
      cx: cx + radius * Math.cos(angle),
      cy: cy + radius * Math.sin(angle) * 0.78,
      r: rScale(row.retailer_count),
    };
  });

  // Clamp to viewport
  for (const p of placed) {
    p.cx = Math.max(p.r + 6, Math.min(W - p.r - 6, p.cx));
    p.cy = Math.max(p.r + 6, Math.min(H - p.r - 6, p.cy));
  }
  // Anti-overlap
  for (let it = 0; it < 60; it++) {
    let moved = 0;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const dx = b.cx - a.cx, dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 0.01;
        const target = a.r + b.r + 30;
        if (dist < target) {
          const push = (target - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          a.cx -= ux * push; a.cy -= uy * push;
          b.cx += ux * push; b.cy += uy * push;
          a.cx = Math.max(a.r + 6, Math.min(W - a.r - 6, a.cx));
          a.cy = Math.max(a.r + 6, Math.min(H - a.r - 6, a.cy));
          b.cx = Math.max(b.r + 6, Math.min(W - b.r - 6, b.cx));
          b.cy = Math.max(b.r + 6, Math.min(H - b.r - 6, b.cy));
          moved++;
        }
      }
    }
    if (moved === 0) break;
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="retail-coverage-map">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-[15px] font-semibold text-slate-900">Retail Coverage Map</h3>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-[11.5px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
          data-testid="coverage-sort"
        >
          <option value="revenue">By Revenue</option>
          <option value="retailers">By Retailers</option>
        </select>
      </div>

      <div className="relative rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50/60 to-white" style={{ aspectRatio: `${W}/${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full">
          {/* faint radial grid */}
          {[60, 120, 180].map(r => (
            <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke="#E2E8F0" strokeDasharray="3 3" strokeWidth="0.7" opacity="0.6" />
          ))}
          {placed.map((p) => {
            const c = CITY_BAND[p.band] || CITY_BAND.fair;
            return (
              <g key={p.city}>
                <circle cx={p.cx} cy={p.cy} r={p.r + 4} fill={c.ring} />
                <circle cx={p.cx} cy={p.cy} r={p.r} fill={c.fill} fillOpacity="0.95" stroke="white" strokeWidth="2" />
                <text x={p.cx} y={p.cy - 2} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="white">{p.city}</text>
                <text x={p.cx} y={p.cy + 8} textAnchor="middle" fontSize="8" fontWeight="600" fill="white">{fmtMoney(p.revenue_90d)}</text>
                <text x={p.cx} y={p.cy + 18} textAnchor="middle" fontSize="7.5" fontWeight="500" fill="rgba(255,255,255,0.85)">{p.retailer_count} retailers</text>
              </g>
            );
          })}
        </svg>
        {placed.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-400">
            No coverage data yet.
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-slate-500">
        {[
          { k: "excellent", l: "Excellent" },
          { k: "good",      l: "Good" },
          { k: "fair",      l: "Fair" },
          { k: "poor",      l: "Poor" },
          { k: "critical",  l: "Critical" },
        ].map(it => (
          <span key={it.k} className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CITY_BAND[it.k].fill }} />
            <span className="font-semibold">{it.l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// TOP RETAILERS
// =============================================================================
const HEALTH_CHIP = {
  healthy: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Excellent" },
  watch:   { bg: "bg-amber-50",   text: "text-amber-700",   label: "Watch" },
  risk:    { bg: "bg-rose-50",    text: "text-rose-700",    label: "At Risk" },
};

function TopRetailers({ rows, distributorId }) {
  // Visibility-only rollup. Retailers are owned by wholesalers — direct
  // navigation from a distributor view is intentionally disabled to preserve
  // the strict tier path: open the wholesaler from the network table below
  // and drill from there.
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="top-retailers-card">
      <div className="flex items-start justify-between mb-3 gap-2">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Downstream visibility</div>
          <h3 className="text-[14px] font-semibold text-slate-900 mt-0.5">Top Performing Retailers</h3>
          <p className="text-[10.5px] text-slate-400 mt-0.5">Owned by wholesalers — open via Wholesaler Network</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-400 py-6 text-center">No retailer sales recorded yet.</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {rows.map((r, i) => {
            const h = HEALTH_CHIP[r.health] || HEALTH_CHIP.healthy;
            const up = (r.growth_pct ?? 0) >= 0;
            return (
              <div key={r.id}
                className="flex items-center gap-2.5 py-2.5 -mx-2 px-2 rounded-lg cursor-default"
                data-testid={`top-retailer-${i}`}>
                <span className="text-[10.5px] font-bold text-slate-400 w-4 text-center tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-slate-900 truncate leading-tight">{titleCase(r.name)}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10.5px] text-slate-600 font-semibold tabular-nums">{fmtMoney(r.revenue_90d)}</span>
                    <span className={`text-[10.5px] tabular-nums font-semibold inline-flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-rose-600"}`}>
                      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                      {fmtPct(r.growth_pct)}
                    </span>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-bold ${h.bg} ${h.text}`}>
                  {h.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PRODUCT PENETRATION
// =============================================================================
const PERF_CHIP = {
  Excellent: { bg: "bg-emerald-50", text: "text-emerald-700", bar: "#10B981" },
  Good:      { bg: "bg-blue-50",    text: "text-blue-700",    bar: "#3B82F6" },
  Fair:      { bg: "bg-amber-50",   text: "text-amber-700",   bar: "#F59E0B" },
  Poor:      { bg: "bg-rose-50",    text: "text-rose-700",    bar: "#EF4444" },
};

function ProductPenetration({ rows }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="product-penetration-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-slate-900">Product Penetration</h3>
        <Link to="/product-intelligence" className="text-[11.5px] font-semibold text-violet-600 hover:text-violet-700 inline-flex items-center gap-1">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-400 py-6 text-center">No product sales recorded yet.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, 6).map((r) => {
            const c = PERF_CHIP[r.performance] || PERF_CHIP.Fair;
            return (
              <div key={r.product_id} data-testid={`penetration-${r.product_id}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Link to={`/products/${r.product_id}`} className="text-[12px] font-semibold text-slate-900 truncate hover:text-violet-600 transition-colors">
                    {r.product_name}
                  </Link>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9.5px] font-bold ${c.bg} ${c.text}`}>
                    {r.performance}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${r.coverage_pct}%`, background: c.bar }} />
                  </div>
                  <span className="text-[10.5px] font-bold tabular-nums text-slate-700">{r.coverage_pct}%</span>
                  <span className="text-[10px] text-slate-500 tabular-nums whitespace-nowrap">{r.retailers_carrying} retailers</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ATTENTION LIST
// =============================================================================
function AttentionList({ rows, distributorId }) {
  // Visibility-only — same rule as TopRetailers above.
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="attention-list-card">
      <div className="mb-3">
        <div className="text-[9.5px] uppercase tracking-[0.18em] text-slate-400 font-semibold">Downstream visibility</div>
        <h3 className="text-[14px] font-semibold text-slate-900 mt-0.5">Retailers Requiring Attention</h3>
        <p className="text-[10.5px] text-slate-400 mt-0.5">Owned by wholesalers — open via Wholesaler Network</p>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
          <div className="text-[12px] font-semibold text-slate-700">All clear</div>
          <div className="text-[11px] text-slate-500">No retailers need follow-up.</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => {
            const isRisk = r.status === "At Risk";
            return (
              <div key={r.id}
                className="flex items-start gap-3 py-1 -mx-2 px-2 rounded-lg cursor-default"
                data-testid={`attention-${i}`}>
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isRisk ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}>
                  <AlertTriangle className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-slate-900 truncate leading-tight">{titleCase(r.name)}</div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5">{r.issue}</div>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-bold flex-shrink-0 ${isRisk ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                  {r.status}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// RETAILER INTELLIGENCE TABLE
// =============================================================================
function RetailerIntelligenceTable({ rows, distributorId }) {
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
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [rows, query, healthFilter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sortInd = (k) => sortKey === k ? <span className="text-violet-500">{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  const exportCsv = () => {
    const header = ["Retailer", "City", "Type", "Revenue (90D)", "Growth %", "Sell-Through %", "Stockouts", "Last Order", "Health"];
    const csv = [header.join(",")].concat(filtered.map(r => [
      `"${r.name}"`, `"${r.city || ""}"`, `"${r.retail_type || ""}"`,
      r.revenue_90d, r.growth_pct ?? "", r.sell_through_pct,
      r.stockouts, r.last_order_date || "", r.health,
    ].join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `retailers_${distributorId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="retailer-intel-table">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-[17px] font-semibold text-slate-900">
          Retailer Intelligence
          <span className="ml-2 text-[12px] font-medium text-slate-500">({rows.length} retailers)</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              type="text"
              placeholder="Search retailers..."
              className="h-9 pl-9 pr-3 w-[240px] rounded-xl border border-slate-200 bg-slate-50 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
              data-testid="retailer-search"
            />
          </div>
          <select
            value={healthFilter}
            onChange={e => setHealthFilter(e.target.value)}
            className="h-9 pl-3 pr-7 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
            data-testid="retailer-filter"
          >
            <option value="all">All Health</option>
            <option value="healthy">Excellent</option>
            <option value="watch">Watch</option>
            <option value="risk">At Risk</option>
          </select>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            data-testid="retailer-export"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" /> Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="text-left pb-3 pl-2">Retailer</th>
              <th className="text-left pb-3">Location</th>
              <th className="text-left pb-3">Type</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("revenue_90d")}>Revenue (90D) {sortInd("revenue_90d")}</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("growth_pct")}>Growth {sortInd("growth_pct")}</th>
              <th className="text-right pb-3 cursor-pointer hover:text-slate-600" onClick={() => toggleSort("sell_through_pct")}>Sell-Through {sortInd("sell_through_pct")}</th>
              <th className="text-right pb-3">Stockouts</th>
              <th className="text-right pb-3">Last Order</th>
              <th className="text-left pb-3">Health</th>
              <th className="text-right pb-3 pr-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map(r => <RetailerRow key={r.id} row={r} distributorId={distributorId} />)}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-12 text-slate-400 text-xs">
                  No retailers match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RetailerRow({ row: r, distributorId }) {
  const h = HEALTH_CHIP[r.health] || HEALTH_CHIP.healthy;
  const up = (r.growth_pct ?? 0) >= 0;
  const sinceOrder = (() => {
    if (!r.last_order_date) return "—";
    if (r.days_since_order === 0) return "Today";
    if (r.days_since_order === 1) return "1 day ago";
    return `${r.days_since_order} days ago`;
  })();
  return (
    <tr className="group hover:bg-slate-50/60 transition-colors" data-testid={`retailer-row-${r.id}`}>
      <td className="py-2.5 pl-2">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-100 to-fuchsia-100 flex items-center justify-center flex-shrink-0 text-[10.5px] font-bold text-violet-700">
            {(r.name || "?").slice(0, 2).toUpperCase()}
          </div>
          <span className="font-semibold text-slate-900 group-hover:text-violet-700 text-[12.5px] truncate max-w-[180px]">{titleCase(r.name)}</span>
        </div>
      </td>
      <td className="py-2.5 text-slate-600">{r.city || "—"}</td>
      <td className="py-2.5 text-slate-600">{r.retail_type || "—"}</td>
      <td className="py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmtMoney(r.revenue_90d)}</td>
      <td className="py-2.5 text-right">
        {r.growth_pct == null ? <span className="text-slate-300">—</span> : (
          <span className={`inline-flex items-center gap-0.5 font-bold tabular-nums text-[12px] ${up ? "text-emerald-600" : "text-rose-600"}`}>
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {fmtPct(r.growth_pct)}
          </span>
        )}
      </td>
      <td className="py-2.5 text-right text-slate-700 tabular-nums">{r.sell_through_pct}%</td>
      <td className="py-2.5 text-right text-slate-700 tabular-nums">{r.stockouts}</td>
      <td className="py-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap">{sinceOrder}</td>
      <td className="py-2.5">
        <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10.5px] font-semibold ${h.bg} ${h.text}`}>
          {h.label}
        </span>
      </td>
      <td className="py-2.5 pr-2 text-right">
        <Link to={`/distributors/${distributorId}/retailers/${r.id}`}
          className="inline-flex h-7 w-7 rounded-lg bg-slate-50 hover:bg-violet-50 items-center justify-center group-hover:bg-violet-100 transition-colors"
          data-testid={`retailer-cta-${r.id}`}>
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-600" />
        </Link>
      </td>
    </tr>
  );
}
