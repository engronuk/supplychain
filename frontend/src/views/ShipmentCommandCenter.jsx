/**
 * Shipment Command Center — manufacturer logistics control tower.
 *
 * Pixel-perfect Fortune-500 layout mirroring the user mock:
 *   1. Header (title · subtitle · New Shipment / Export / Filters)
 *   2. 6 KPI cards with sparklines
 *   3. AI Logistics Summary (purple) + Shipment Pipeline funnel
 *   4. Regional Shipment Performance + Distributor Receiving Performance
 *      + Shipment Exceptions
 *   5. All Shipments table with right-side drawer
 *
 * The right-side drawer slides in when a shipment row is clicked and shows
 * route, overview, manifest, health gauge, batch & expiry compliance,
 * distributor acknowledgement, and AI recommendation.
 *
 * Backend: GET /api/manufacturer/{id}/shipment-command-center  and
 *          GET /api/manufacturer/{id}/shipment-intelligence/{shipment_id}
 */
import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import {
  Search, Filter, Download, ChevronRight, ChevronLeft, Plus,
  Package, Truck, CheckCircle2, AlertTriangle, DollarSign, Shield,
  Sparkles, ArrowRight, X, Printer, MapPin, Loader2, Info,
} from "lucide-react";

// -------- formatters --------------------------------------------------------
const fmtMoney = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
};
const fmtInt = (v) => Number(v || 0).toLocaleString();
const fmtPct = (v, plus = true) => v == null ? "—" : `${plus && v > 0 ? "+" : ""}${Math.round(v)}%`;
const fmtDate = (v) => v
  ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";
const fmtTime = (v) => v
  ? new Date(v).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  : "";
const titleCase = (s) => (s || "").replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// =============================================================================
// MAIN VIEW
// =============================================================================
export default function ShipmentCommandCenter() {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [openShipmentId, setOpenShipmentId] = useState(null);

  useEffect(() => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerShipmentCommand(session.entity.id)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [session?.entity?.id]);

  if (loading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF7]" data-testid="shipment-cc-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading shipment command center…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="shipment-command-center">
      <div className="px-8 py-7 max-w-[1840px] mx-auto space-y-6">
        <Breadcrumb />
        <PageHeader rows={data.shipments} query={q} onQuery={setQ} />

        <KPIStrip kpis={data.kpis} />

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-8">
            <AILogistics brief={data.ai_brief} />
          </div>
          <div className="col-span-12 xl:col-span-4">
            <PipelineFunnel pipeline={data.pipeline} />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 xl:col-span-5">
            <RegionalPerformance rows={data.regional} />
          </div>
          <div className="col-span-12 xl:col-span-4">
            <DistributorReceiving rows={data.distributor_performance} />
          </div>
          <div className="col-span-12 xl:col-span-3">
            <ExceptionsPanel rows={data.exceptions} />
          </div>
        </div>

        <ShipmentsTable
          rows={data.shipments} query={q} onQuery={setQ}
          onOpen={setOpenShipmentId}
        />
      </div>

      <ShipmentDrawer
        manufacturerId={session.entity.id}
        shipmentId={openShipmentId}
        onClose={() => setOpenShipmentId(null)}
      />
    </div>
  );
}

// =============================================================================
// BREADCRUMB + HEADER
// =============================================================================
function Breadcrumb() {
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-slate-500 font-semibold tracking-wider uppercase" data-testid="scc-breadcrumb">
      <span>Shipments</span>
      <ChevronRight className="h-3 w-3 text-slate-300" />
      <span className="text-slate-700">Command Center</span>
    </div>
  );
}

function PageHeader({ rows }) {
  const exportCsv = () => {
    const header = ["Shipment ID", "Distributor", "City", "Value", "Products",
                    "Units", "Dispatched", "Expected", "Actual Arrival", "Status",
                    "Acknowledgement"];
    const lines = [header].concat(rows.map((r) => [
      r.tracking_code, r.distributor_name, r.distributor_city, r.value,
      r.products_count, r.units, r.dispatched_at || "",
      r.expected_arrival || "", r.actual_arrival || "",
      r.status, r.ack_status,
    ]));
    const csv = lines.map((row) =>
      row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shipments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-end justify-between gap-4 flex-wrap" data-testid="scc-header">
      <div className="min-w-0">
        <h1 className="text-[34px] font-bold tracking-tight text-slate-900 leading-none">
          Shipment Command Center
        </h1>
        <p className="text-[12.5px] text-slate-500 mt-2 max-w-3xl">
          Visibility and operational control across all outbound shipments.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          data-testid="scc-export-btn"
        >
          <Download className="h-3.5 w-3.5 text-slate-500" /> Export
        </button>
        <button
          className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-gradient-to-br from-[#6D28D9] to-[#8B5CF6] text-white text-[12.5px] font-semibold hover:opacity-90 transition-opacity shadow-sm"
          data-testid="scc-new-shipment-btn"
          disabled
          title="Coming soon"
        >
          <Plus className="h-3.5 w-3.5" /> New Shipment
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// KPI STRIP — 6 cards
// =============================================================================
const KPI_PALETTE = {
  amber:  { bg: "#FFFBEB", fg: "#B45309" },
  blue:   { bg: "#EFF6FF", fg: "#1D4ED8" },
  green:  { bg: "#ECFDF5", fg: "#047857" },
  rose:   { bg: "#FFF1F2", fg: "#BE123C" },
  violet: { bg: "#F5F3FF", fg: "#7C3AED" },
  teal:   { bg: "#F0FDFA", fg: "#0F766E" },
};

function KPIStrip({ kpis }) {
  const cards = [
    { id: "pending_dispatch", label: "Pending Dispatch", color: "amber", icon: Package,
      value: fmtInt(kpis.pending_dispatch.value), payload: kpis.pending_dispatch },
    { id: "in_transit", label: "In Transit", color: "blue", icon: Truck,
      value: fmtInt(kpis.in_transit.value), payload: kpis.in_transit },
    { id: "delivered", label: "Delivered", color: "green", icon: CheckCircle2,
      value: fmtInt(kpis.delivered.value), payload: kpis.delivered },
    { id: "delayed", label: "Delayed", color: "rose", icon: AlertTriangle,
      value: fmtInt(kpis.delayed.value), payload: kpis.delayed, invertGrowth: true },
    { id: "shipment_value", label: "Shipment Value", color: "violet", icon: DollarSign,
      value: fmtMoney(kpis.shipment_value.value), payload: kpis.shipment_value },
    { id: "fill_rate", label: "Fill Rate", color: "teal", icon: Shield,
      value: `${kpis.fill_rate.value}%`, payload: kpis.fill_rate },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4" data-testid="scc-kpis">
      {cards.map((c) => <KPICard key={c.id} {...c} />)}
    </div>
  );
}

function KPICard({ id, label, color, icon: Icon, value, payload, invertGrowth }) {
  const c = KPI_PALETTE[color];
  const growth = payload?.growth_pct ?? null;
  const isUp = growth != null && growth >= 0;
  // For "Delayed" we treat a decrease as positive
  const isPositive = invertGrowth ? !isUp : isUp;
  return (
    <div
      className="group bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_18px_40px_-12px_rgba(15,23,42,0.16)] hover:-translate-y-0.5 transition-all duration-300 border border-slate-100/70"
      data-testid={`kpi-${id}`}
    >
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: c.bg, color: c.fg }}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-[11px] font-semibold text-slate-500 leading-tight">{label}</div>
      </div>
      <div className="text-[28px] font-bold text-slate-900 tabular-nums leading-none mt-3">
        {value}
      </div>
      {growth != null && (
        <div className={`text-[10.5px] font-bold tabular-nums mt-1 ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
          {isUp ? "↑" : "↓"} {fmtPct(Math.abs(growth), false)} vs last 7d
        </div>
      )}
      {payload?.spark && payload.spark.length > 1 && (
        <SparkLine points={payload.spark} color={c.fg} />
      )}
    </div>
  );
}

function SparkLine({ points, color }) {
  const w = 240, h = 28;
  const max = Math.max(...points, 1), min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const id = color.replace("#", "");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 mt-2" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sccspark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sccspark-${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// =============================================================================
// AI LOGISTICS SUMMARY (left wide card with right action panel)
// =============================================================================
function AILogistics({ brief }) {
  return (
    <div className="relative overflow-hidden rounded-2xl h-full shadow-[0_20px_50px_-15px_rgba(76,29,149,0.5)]" data-testid="ai-logistics">
      <div className="absolute inset-0 bg-gradient-to-br from-[#312E81] via-[#4338CA] to-[#6D28D9]" />
      <div className="absolute -top-32 -right-24 h-[300px] w-[300px] rounded-full bg-fuchsia-400/20 blur-3xl" />
      <div className="absolute -bottom-20 -left-10 h-[220px] w-[220px] rounded-full bg-cyan-400/10 blur-3xl" />

      <div className="relative grid grid-cols-1 xl:grid-cols-[1fr_320px]">
        {/* Left: insights */}
        <div className="px-7 py-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-amber-200" />
            <h2 className="text-[15px] font-semibold tracking-tight text-white">AI Logistics Summary</h2>
          </div>
          <ul className="space-y-2.5">
            {brief.insights.map((ins, i) => (
              <li key={i} className="flex items-start gap-2.5 text-white/95" data-testid={`ai-insight-${i}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-white/70 flex-shrink-0 mt-1.5" />
                <span className="text-[12.5px] leading-snug">{ins}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: recommended actions panel */}
        <div className="m-4 rounded-xl bg-white/8 backdrop-blur-sm ring-1 ring-white/15 p-4 flex flex-col">
          <h3 className="text-[12px] font-bold text-white mb-3 tracking-tight">Recommended Actions</h3>
          <ul className="space-y-2 flex-1">
            {brief.recommended_actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-white/90" data-testid={`recommended-${i}`}>
                <CheckCircle2 className="h-3 w-3 text-emerald-300 flex-shrink-0 mt-0.5" />
                <span className="text-[11px] leading-snug">{a}</span>
              </li>
            ))}
          </ul>
          <button
            className="mt-3 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-white text-[#4338CA] text-[11.5px] font-semibold hover:bg-white/90 transition-colors"
            data-testid="view-recommendations-btn"
          >
            View all recommendations <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// PIPELINE FUNNEL
// =============================================================================
const PIPELINE_STAGES = [
  { k: "pending_dispatch", label: "Pending Dispatch", bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-800" },
  { k: "in_transit",       label: "In Transit",        bg: "bg-blue-50",   border: "border-blue-200",   text: "text-blue-800" },
  { k: "delivered",        label: "Delivered",         bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800" },
  { k: "delayed",          label: "Delayed",           bg: "bg-rose-50",   border: "border-rose-200",   text: "text-rose-800" },
];

function PipelineFunnel({ pipeline }) {
  const total = pipeline.total || 1;
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="pipeline-funnel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-slate-900">Shipment Pipeline</h3>
        <div className="text-[11.5px] tabular-nums text-slate-500"><span className="font-bold text-slate-900">{pipeline.total}</span> Total</div>
      </div>
      <div className="space-y-2.5">
        {PIPELINE_STAGES.map((s, i) => {
          const count = pipeline[s.k] || 0;
          const width = Math.max(20, Math.min(100, (count / total) * 100 + 30));
          return (
            <div key={s.k}>
              <div
                className={`relative ${s.bg} ${s.border} border rounded-xl px-4 py-3 flex items-center justify-between transition-all`}
                style={{ width: `${width}%` }}
                data-testid={`pipeline-${s.k}`}
              >
                <span className={`text-[12px] font-semibold ${s.text}`}>{s.label}</span>
                <span className={`text-[18px] font-bold tabular-nums ${s.text}`}>{count}</span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div className="flex justify-start pl-6 my-0.5">
                  <div className="h-3 w-px bg-slate-200" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// REGIONAL PERFORMANCE
// =============================================================================
function RegionalPerformance({ rows }) {
  const sorted = [...rows].sort((a, b) => b.shipments - a.shipments);
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="regional-shipment-performance">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Regional Shipment Performance</h3>
        <Info className="h-3.5 w-3.5 text-slate-300" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {sorted.map((r) => {
          const successColor =
            r.success_rate >= 90 ? "text-emerald-600 bg-emerald-50" :
            r.success_rate >= 70 ? "text-amber-600 bg-amber-50" :
            "text-rose-600 bg-rose-50";
          return (
            <div
              key={r.region}
              className="rounded-xl border border-slate-100 p-3 hover:border-slate-200 transition-colors"
              data-testid={`region-card-${r.region.toLowerCase().replace(/ /g, "-")}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-slate-900 leading-tight">{r.region}</div>
                <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${successColor}`}>
                  {r.success_rate || 0}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 mt-2 text-center">
                <div>
                  <div className="text-[8.5px] text-slate-500 font-semibold uppercase tracking-wider">Shipments</div>
                  <div className="text-[14px] font-bold text-slate-900 tabular-nums">{r.shipments}</div>
                </div>
                <div>
                  <div className="text-[8.5px] text-slate-500 font-semibold uppercase tracking-wider">Avg Transit</div>
                  <div className="text-[14px] font-bold text-slate-900 tabular-nums">
                    {r.avg_transit_days != null ? `${r.avg_transit_days}d` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[8.5px] text-slate-500 font-semibold uppercase tracking-wider">Fill</div>
                  <div className="text-[14px] font-bold text-slate-900 tabular-nums">{r.fill_rate || 0}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// DISTRIBUTOR RECEIVING PERFORMANCE
// =============================================================================
const GRADE_CHIP = {
  "A+": "bg-emerald-100 text-emerald-800",
  "A":  "bg-emerald-50 text-emerald-700",
  "B":  "bg-blue-50 text-blue-700",
  "C":  "bg-amber-50 text-amber-700",
  "D":  "bg-rose-50 text-rose-700",
};

function DistributorReceiving({ rows }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="distributor-receiving">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Distributor Receiving Performance</h3>
        <Info className="h-3.5 w-3.5 text-slate-300" />
      </div>
      <table className="w-full text-[11.5px]" data-testid="receiving-table">
        <thead>
          <tr className="text-[9.5px] uppercase tracking-wider text-slate-400 font-semibold">
            <th className="text-left pb-2">Distributor</th>
            <th className="text-right pb-2">Received</th>
            <th className="text-right pb-2">Avg Conf.</th>
            <th className="text-right pb-2">Accuracy</th>
            <th className="text-right pb-2">Grade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.length === 0 && (
            <tr><td colSpan={5} className="text-center text-slate-400 py-6 text-[11px]">No delivered shipments yet.</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50/60 transition-colors" data-testid={`recv-row-${r.id}`}>
              <td className="py-2 font-semibold text-slate-900 truncate max-w-[180px]">{titleCase(r.name)}</td>
              <td className="py-2 text-right text-slate-700 tabular-nums">{r.received}</td>
              <td className="py-2 text-right text-slate-700 tabular-nums">
                {r.avg_confirmation_hours != null ? `${Math.round(r.avg_confirmation_hours)} hrs` : "—"}
              </td>
              <td className="py-2 text-right text-emerald-600 font-semibold tabular-nums">{r.accuracy_pct}%</td>
              <td className="py-2 text-right">
                <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold ${GRADE_CHIP[r.grade] || GRADE_CHIP.B}`}>
                  {r.grade}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// EXCEPTIONS PANEL
// =============================================================================
const SEVERITY_CHIP = {
  critical: { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    label: "Critical" },
  high:     { bg: "bg-rose-50",    text: "text-rose-700",    border: "border-rose-200",    label: "High" },
  medium:   { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200",   label: "Medium" },
  low:      { bg: "bg-slate-100",  text: "text-slate-700",   border: "border-slate-200",   label: "Low" },
};

function ExceptionsPanel({ rows }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70 h-full" data-testid="exceptions-panel">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-semibold text-slate-900">Shipment Exceptions</h3>
        <span className="text-[11px] font-semibold text-violet-600">View all</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
          <div className="text-[12px] font-semibold text-slate-700">No exceptions</div>
          <div className="text-[11px] text-slate-500">All shipments operating normally.</div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((e, i) => {
            const sev = SEVERITY_CHIP[e.severity] || SEVERITY_CHIP.medium;
            return (
              <div key={`${e.shipment_id}-${i}`} className={`rounded-xl border ${sev.border} bg-slate-50/40 p-2.5`} data-testid={`exception-${i}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <AlertTriangle className={`h-3 w-3 flex-shrink-0 ${sev.text}`} />
                    <span className="text-[11.5px] font-bold text-slate-900 truncate">{e.tracking_code}</span>
                  </div>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold ${sev.bg} ${sev.text}`}>
                    {sev.label}
                  </span>
                </div>
                <div className="text-[10.5px] text-slate-600 mt-1 leading-tight">{e.label}</div>
                <div className="text-[10px] text-slate-500 truncate">{e.distributor}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{e.detail}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ALL SHIPMENTS TABLE
// =============================================================================
const STATUS_CHIP = {
  pending:    { bg: "bg-amber-50",   text: "text-amber-700",   label: "Pending Dispatch" },
  in_transit: { bg: "bg-blue-50",    text: "text-blue-700",    label: "In Transit" },
  delivered:  { bg: "bg-emerald-50", text: "text-emerald-700", label: "Delivered" },
  delayed:    { bg: "bg-rose-50",    text: "text-rose-700",    label: "Delayed" },
};

function ShipmentsTable({ rows, query, onQuery, onOpen }) {
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const pageSize = 10;
  const filtered = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    let r = rows;
    if (q) {
      r = r.filter((x) =>
        x.tracking_code.toLowerCase().includes(q) ||
        x.distributor_name.toLowerCase().includes(q) ||
        (x.distributor_city || "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") r = r.filter((x) => x.status === statusFilter);
    return r;
  }, [rows, query, statusFilter]);
  useEffect(() => { setPage(0); }, [query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] border border-slate-100/70" data-testid="all-shipments-table">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[17px] font-semibold text-slate-900">All Shipments</h3>
          <span className="inline-flex items-center justify-center h-5 px-2 rounded-full bg-violet-50 text-violet-700 text-[10.5px] font-bold tabular-nums">
            {filtered.length}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search shipment, distributor…"
              className="h-9 pl-9 pr-3 w-[280px] rounded-xl border border-slate-200 bg-slate-50 text-[12.5px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
              data-testid="shipment-search"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 pl-3 pr-7 rounded-xl border border-slate-200 bg-white text-[12.5px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
            data-testid="shipment-status-filter"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending Dispatch</option>
            <option value="in_transit">In Transit</option>
            <option value="delivered">Delivered</option>
            <option value="delayed">Delayed</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-slate-400 font-semibold">
              <th className="text-left pb-3 pl-2">Shipment ID</th>
              <th className="text-left pb-3">Route</th>
              <th className="text-right pb-3">Products</th>
              <th className="text-right pb-3">Value</th>
              <th className="text-right pb-3">Units</th>
              <th className="text-left pb-3">ETA</th>
              <th className="text-left pb-3">Status</th>
              <th className="text-left pb-3">Acknowledgement</th>
              <th className="text-left pb-3">Exceptions</th>
              <th className="text-right pb-3 pr-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pageRows.map((r) => {
              const chip = STATUS_CHIP[r.status] || STATUS_CHIP.pending;
              return (
                <tr
                  key={r.id}
                  className="cursor-pointer hover:bg-slate-50/60 transition-colors group"
                  onClick={() => onOpen(r.id)}
                  data-testid={`shipment-row-${r.id}`}
                >
                  <td className="py-2.5 pl-2 font-mono text-[11px] text-slate-900 font-semibold group-hover:text-violet-700">{r.tracking_code}</td>
                  <td className="py-2.5 text-slate-600">
                    <span className="text-[11px]">
                      <span className="font-medium text-slate-500">Lagos DC</span>
                      {" → "}
                      <span className="font-semibold text-slate-900">{titleCase(r.distributor_name)}</span>
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-slate-700 tabular-nums">{r.products_count}</td>
                  <td className="py-2.5 text-right font-semibold text-slate-900 tabular-nums">{fmtMoney(r.value)}</td>
                  <td className="py-2.5 text-right text-slate-700 tabular-nums">{fmtInt(r.units)}</td>
                  <td className="py-2.5 text-slate-600 whitespace-nowrap">
                    <div className="text-[11.5px]">{fmtDate(r.expected_arrival)}</div>
                    {r.status === "in_transit" && r.expected_arrival && (
                      <div className="text-[10px] text-blue-600 font-semibold">
                        {(() => {
                          const days = Math.ceil((new Date(r.expected_arrival) - Date.now()) / (1000 * 60 * 60 * 24));
                          return days > 0 ? `${days} day${days === 1 ? "" : "s"} left` : "Today";
                        })()}
                      </div>
                    )}
                    {r.status === "delayed" && (
                      <div className="text-[10px] text-rose-600 font-semibold">Overdue</div>
                    )}
                  </td>
                  <td className="py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${chip.bg} ${chip.text}`}>
                      {chip.label}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {r.ack_status === "confirmed" && (
                      <div className="text-[10.5px]">
                        <div className="text-emerald-600 font-semibold">Yes</div>
                        <div className="text-slate-500">{fmtDate(r.ack_at)}{r.ack_at ? `, ${fmtTime(r.ack_at)}` : ""}</div>
                      </div>
                    )}
                    {r.ack_status === "pending" && (
                      <div className="text-[10.5px]">
                        <div className="text-rose-600 font-semibold">No</div>
                        <div className="text-slate-500">Pending</div>
                      </div>
                    )}
                    {r.ack_status === "n/a" && (<span className="text-slate-400 text-[10.5px]">—</span>)}
                  </td>
                  <td className="py-2.5">
                    {r.exceptions
                      ? <span className="inline-flex items-center justify-center h-5 w-5 rounded bg-rose-100 text-rose-600"><AlertTriangle className="h-3 w-3" /></span>
                      : <span className="text-slate-300 text-[10.5px]">—</span>}
                  </td>
                  <td className="py-2.5 pr-2 text-right">
                    <span className="text-[11px] font-semibold text-violet-600 group-hover:text-violet-700 inline-flex items-center gap-0.5">
                      View <ChevronRight className="h-3 w-3" />
                    </span>
                  </td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={10} className="text-center text-slate-400 py-10 text-[11.5px]">No shipments match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-[11.5px] text-slate-500">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length} shipments
          </div>
          <div className="flex items-center gap-1" data-testid="ship-table-pagination">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 inline-flex items-center justify-center"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i).filter((i) =>
              i === 0 || i === totalPages - 1 || (i >= page - 1 && i <= page + 1)
            ).map((p, idx, arr) => (
              <span key={p} className="flex items-center gap-1">
                {idx > 0 && arr[idx - 1] !== p - 1 && (
                  <span className="text-slate-400 text-[11px] px-1">…</span>
                )}
                <button
                  onClick={() => setPage(p)}
                  className={`h-7 min-w-[28px] px-2 rounded-lg text-[11.5px] font-semibold ${
                    p === page
                      ? "bg-violet-600 text-white"
                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {p + 1}
                </button>
              </span>
            ))}
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page === totalPages - 1}
              className="h-7 w-7 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-30 inline-flex items-center justify-center"
            >
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SHIPMENT INTELLIGENCE DRAWER
// =============================================================================
function ShipmentDrawer({ manufacturerId, shipmentId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shipmentId) { setData(null); return; }
    setLoading(true);
    Api.manufacturerShipmentIntelligence(manufacturerId, shipmentId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [manufacturerId, shipmentId]);

  if (!shipmentId) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm animate-in fade-in" onClick={onClose} data-testid="drawer-backdrop" />

      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[520px] bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in-right"
        data-testid="shipment-drawer"
      >
        {loading || !data ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <ShipmentDrawerContent data={data} onClose={onClose} />
        )}
      </aside>

      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in-right { animation: slideInRight 220ms cubic-bezier(0.32, 0.72, 0, 1); }
      `}</style>
    </>
  );
}

function ShipmentDrawerContent({ data, onClose }) {
  const { shipment, route, overview, manifest, health, compliance,
          acknowledgement, ai_recommendations } = data;
  const chip = STATUS_CHIP[shipment.status === "received" ? "delivered" : shipment.status] || STATUS_CHIP.pending;

  return (
    <>
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <button onClick={onClose} className="h-7 w-7 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center justify-center mt-0.5" data-testid="drawer-back">
            <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-bold text-slate-900">{shipment.tracking_code}</h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${chip.bg} ${chip.text}`}>
                {chip.label}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Shipment Intelligence</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="h-8 w-8 rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center justify-center" onClick={() => window.print()} data-testid="drawer-print">
            <Printer className="h-3.5 w-3.5 text-slate-500" />
          </button>
          <button className="h-8 w-8 rounded-lg hover:bg-slate-50 inline-flex items-center justify-center" onClick={onClose} data-testid="drawer-close">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Route */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Route</h3>
          <div className="rounded-xl border border-slate-100 p-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <MapPin className="h-3.5 w-3.5 text-violet-500 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-900 truncate">{route.from.name}</div>
                <div className="text-[10px] text-slate-500 truncate">{route.from.city}, {route.from.state}</div>
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
            <div className="flex items-start gap-2 min-w-0">
              <MapPin className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-900 truncate">{titleCase(route.to.name)}</div>
                <div className="text-[10px] text-slate-500 truncate">{route.to.city}, {route.to.state}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Overview */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Overview</h3>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Shipment Value" value={fmtMoney(overview.shipment_value)} />
            <Stat label="Total Units" value={fmtInt(overview.total_units)} />
            <Stat label="Total Products" value={overview.total_products} />
            <Stat label="Dispatch Date" value={`${fmtDate(shipment.dispatched_at)} · ${fmtTime(shipment.dispatched_at)}`} small />
            <Stat label="Expected Arrival" value={`${fmtDate(shipment.expected_arrival)} · ${fmtTime(shipment.expected_arrival)}`} small />
            <Stat label="Actual Arrival" value={`${fmtDate(shipment.received_at)} · ${fmtTime(shipment.received_at)}`} small />
          </div>
        </section>

        {/* Product Manifest */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Product Manifest</h3>
            <span className="text-[10.5px] text-slate-500 tabular-nums">{manifest.length} products</span>
          </div>
          <div className="rounded-xl border border-slate-100 overflow-hidden">
            <table className="w-full text-[11px]" data-testid="manifest-table">
              <thead className="bg-slate-50/50">
                <tr className="text-[9.5px] uppercase tracking-wider text-slate-400 font-semibold">
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-left px-3 py-2">Batch</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-left px-3 py-2">Unit</th>
                  <th className="text-left px-3 py-2 pr-3">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {manifest.map((m) => (
                  <tr key={m.product_id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2 font-semibold text-slate-900 truncate max-w-[120px]">{m.product_name}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{m.batch_number || "—"}</td>
                    <td className="px-3 py-2 text-right text-slate-700 tabular-nums font-semibold">{fmtInt(m.quantity)}</td>
                    <td className="px-3 py-2 text-slate-500">{m.unit}</td>
                    <td className="px-3 py-2 pr-3 text-slate-700 tabular-nums">{fmtDate(m.expiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Health gauge */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Shipment Health</h3>
          <div className="rounded-xl border border-slate-100 p-4 flex items-center gap-4">
            <HealthGauge score={health.overall} />
            <ul className="flex-1 space-y-1.5">
              {[
                ["On-time Delivery", health.breakdown.on_time_delivery],
                ["Product Condition", health.breakdown.product_condition],
                ["Quantity Accuracy", health.breakdown.quantity_accuracy],
                ["Documentation", health.breakdown.documentation],
              ].map(([label, v]) => (
                <li key={label} className="flex items-center justify-between text-[11px]">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    <span className="text-slate-700">{label}</span>
                  </span>
                  <span className={`font-bold ${v >= 90 ? "text-emerald-600" : v >= 70 ? "text-amber-600" : "text-rose-600"}`}>
                    {v >= 90 ? "Excellent" : v >= 70 ? "Good" : v >= 50 ? "Fair" : "Poor"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Batch & Expiry Compliance */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Batch &amp; Expiry Compliance</h3>
          <div className={`rounded-xl border p-3 flex items-center justify-between ${
            compliance.all_compliant ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"
          }`}>
            <div className="flex items-center gap-2">
              {compliance.all_compliant
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <AlertTriangle className="h-4 w-4 text-amber-600" />}
              <div>
                <div className="text-[12px] font-semibold text-slate-900">
                  {compliance.all_compliant ? "All products compliant" : `${compliance.near_expiry_count} product(s) near expiry`}
                </div>
                <div className="text-[10px] text-slate-500">Compliance score: {compliance.compliance_score}%</div>
              </div>
            </div>
          </div>
        </section>

        {/* Acknowledgement */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Distributor Acknowledgement</h3>
          {acknowledgement.confirmed ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-[12px] font-semibold text-slate-900">Confirmed by {acknowledgement.by_role}</span>
              </div>
              <div className="text-[10.5px] text-slate-600 mt-1">
                {fmtDate(acknowledgement.confirmed_at)} · {fmtTime(acknowledgement.confirmed_at)}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-[11.5px] text-slate-700">
              Acknowledgement pending from distributor.
            </div>
          )}
        </section>

        {/* AI Recommendation */}
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">AI Shipment Recommendation</h3>
          <div className="rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-100 p-3">
            <ul className="space-y-1.5">
              {ai_recommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-[11.5px] text-slate-700">
                  <Sparkles className="h-3 w-3 text-violet-500 flex-shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}

function Stat({ label, value, small }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{label}</div>
      <div className={`font-bold text-slate-900 tabular-nums mt-0.5 ${small ? "text-[12px]" : "text-[16px]"}`}>{value}</div>
    </div>
  );
}

function HealthGauge({ score }) {
  const color = score >= 90 ? "#10B981" : score >= 70 ? "#3B82F6" : score >= 50 ? "#F59E0B" : "#EF4444";
  const circumference = 2 * Math.PI * 32;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="relative flex-shrink-0">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx="44" cy="44" r="32" fill="none" stroke="#F1F5F9" strokeWidth="8" />
        <circle cx="44" cy="44" r="32" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          transform="rotate(-90 44 44)" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[18px] font-bold text-slate-900 tabular-nums leading-none">{score}%</div>
        <div className={`text-[9px] font-bold mt-0.5`} style={{ color }}>
          {score >= 90 ? "Excellent" : score >= 70 ? "Good" : "Watch"}
        </div>
      </div>
    </div>
  );
}
