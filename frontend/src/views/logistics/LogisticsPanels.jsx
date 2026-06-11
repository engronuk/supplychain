// Logistics Command Center — read-only panels: Alerts, Quick Actions,
// Order Pipeline funnel, Demand Forecast.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Flame, Info, Plus, Warehouse, FileText, Truck,
  ClipboardCheck, TrendingUp, TrendingDown, PackageSearch,
} from "lucide-react";

const num = (n) => (Number(n) || 0).toLocaleString();

function relativeFrom(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return null;
  const m = Math.floor(Math.max(0, Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ============================================================================
// Alerts & Risks
// ============================================================================
const SEV = {
  critical: { Icon: Flame, badge: "bg-rose-100 text-rose-700", dot: "bg-rose-500" },
  warning: { Icon: AlertTriangle, badge: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  info: { Icon: Info, badge: "bg-sky-100 text-sky-700", dot: "bg-sky-500" },
};

export const AlertsPanel = ({ alerts }) => {
  const [filter, setFilter] = useState("all");
  const counts = alerts.reduce((a, x) => { a[x.severity] = (a[x.severity] || 0) + 1; return a; }, {});
  const rows = filter === "all" ? alerts : alerts.filter((a) => a.severity === filter);
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden flex flex-col" data-testid="alerts-panel">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-900 text-sm inline-flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> Alerts & Risks
        </div>
        <span className="text-[11px] text-slate-500">{alerts.length} active</span>
      </div>
      <div className="px-4 pt-3 flex items-center gap-1.5 flex-wrap">
        {[
          ["all", `All (${alerts.length})`],
          ["critical", `Critical (${counts.critical || 0})`],
          ["warning", `Warning (${counts.warning || 0})`],
          ["info", `Info (${counts.info || 0})`],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            data-testid={`alerts-filter-${key}`}
            className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
              filter === key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto mt-2" data-testid="alerts-list">
        {rows.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-slate-400">No alerts in this bucket.</li>
        ) : rows.map((a) => {
          const s = SEV[a.severity] || SEV.info;
          return (
            <li key={a.id} className="px-5 py-2.5 flex items-start gap-2.5" data-testid={`alert-${a.kind || "row"}`}>
              <span className={`h-6 w-6 rounded-full grid place-items-center shrink-0 mt-0.5 ${s.badge}`}>
                <s.Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-slate-900 leading-snug">{a.title}</div>
                {a.detail && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{a.detail}</div>}
              </div>
              <span className="text-[10px] text-slate-400 shrink-0 mt-0.5">{relativeFrom(a.at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

// ============================================================================
// Quick Actions
// ============================================================================
export const QuickActionsPanel = ({ onCreateTransfer, onApproveRequests, onCreateShipment, onViewWarehouse, onGenerateReport }) => {
  const actions = [
    { label: "Create Transfer", Icon: Plus, onClick: onCreateTransfer, testId: "qa-create-transfer" },
    { label: "Approve Requests", Icon: ClipboardCheck, onClick: onApproveRequests, testId: "qa-approve-requests" },
    { label: "Create Shipment", Icon: Truck, onClick: onCreateShipment, testId: "qa-create-shipment" },
    { label: "View Warehouses", Icon: Warehouse, onClick: onViewWarehouse, testId: "qa-view-warehouse" },
    { label: "Generate Report", Icon: FileText, onClick: onGenerateReport, testId: "qa-generate-report" },
  ];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid="quick-actions-panel">
      <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">Quick Actions</div>
      <div className="p-4 grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            data-testid={a.testId}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-[12px] font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 transition-colors"
          >
            <a.Icon className="h-3.5 w-3.5" /> {a.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Order Pipeline funnel
// ============================================================================
const STAGES = [
  ["open", "Open Orders", "bg-blue-500"],
  ["allocated", "Allocated", "bg-indigo-500"],
  ["picked", "Picked", "bg-violet-500"],
  ["packed", "Packed", "bg-fuchsia-500"],
  ["shipped", "Shipped", "bg-amber-500"],
  ["delivered", "Delivered", "bg-emerald-500"],
];

export const PipelinePanel = ({ pipeline }) => {
  const max = Math.max(1, ...STAGES.map(([k]) => Number(pipeline[k]) || 0));
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid="pipeline-panel">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-900 text-sm">Order Pipeline</div>
        <span className="text-[11px] text-slate-500">order lifecycle funnel</span>
      </div>
      <div className="p-5 space-y-2.5">
        {STAGES.map(([key, label, color]) => {
          const v = Number(pipeline[key]) || 0;
          const w = Math.max(6, (v / max) * 100);
          return (
            <div key={key} className="flex items-center gap-3" data-testid={`pipeline-${key}`}>
              <div className="w-24 text-[11px] font-medium text-slate-600 shrink-0">{label}</div>
              <div className="flex-1 h-7 rounded-md bg-slate-50 overflow-hidden">
                <div
                  className={`h-full ${color} rounded-md flex items-center justify-end pr-2 transition-[width] duration-500`}
                  style={{ width: `${w}%` }}
                >
                  <span className="text-[11px] font-bold text-white drop-shadow-sm">{num(v)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// Demand Forecast Center
// ============================================================================
export const ForecastPanel = ({ forecast }) => {
  const navigate = useNavigate();
  const top = forecast.top_product;
  const regional = forecast.regional || [];
  const stockouts = forecast.stockouts || [];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid="forecast-panel">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-900 text-sm inline-flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-indigo-600" /> Demand Forecast Center
        </div>
        <button
          type="button"
          onClick={() => navigate("/intel")}
          className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
          data-testid="forecast-view-all"
        >
          View all →
        </button>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top product */}
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3.5" data-testid="forecast-top-product">
          <div className="text-[10px] uppercase tracking-wider font-bold text-indigo-700">Top Product Forecast</div>
          {top ? (
            <>
              <div className="text-sm font-semibold text-slate-900 mt-1.5 leading-snug">{top.product_name}</div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Today</div>
                  <div className="text-base font-bold text-slate-900">{num(top.today_units)}<span className="text-[10px] text-slate-400 font-medium ml-0.5">u/day</span></div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">Next Week</div>
                  <div className="text-base font-bold text-slate-900">{num(top.next_week_units)}<span className="text-[10px] text-slate-400 font-medium ml-0.5">u/day</span></div>
                </div>
              </div>
              <div className={`inline-flex items-center gap-1 mt-2.5 text-[12px] font-bold ${top.pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {top.pct >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {top.pct >= 0 ? "+" : ""}{top.pct}% projected
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400 mt-3">No forecast data yet.</div>
          )}
        </div>

        {/* Regional */}
        <div className="rounded-lg border border-slate-100 p-3.5" data-testid="forecast-regional">
          <div className="text-[10px] uppercase tracking-wider font-bold text-slate-600">Regional Forecast · 7 days</div>
          <ul className="mt-2 space-y-1.5">
            {regional.length === 0 ? (
              <li className="text-sm text-slate-400">No regional signals.</li>
            ) : regional.map((r) => (
              <li key={r.region} className="flex items-center justify-between text-[12px]">
                <span className="text-slate-700">{r.region}</span>
                <span className={`inline-flex items-center gap-1 font-bold ${r.pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {r.pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {r.pct >= 0 ? "+" : ""}{r.pct}%
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Stockouts */}
        <div className="rounded-lg border border-rose-100 bg-rose-50/30 p-3.5" data-testid="forecast-stockouts">
          <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700 inline-flex items-center gap-1">
            <PackageSearch className="h-3 w-3" /> Stockout Predictions
          </div>
          <ul className="mt-2 space-y-2">
            {stockouts.length === 0 ? (
              <li className="text-sm text-slate-400">No imminent stockouts.</li>
            ) : stockouts.map((s, i) => (
              <li key={i} className="text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 truncate">{s.product_name}</span>
                  <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${s.risk === "high" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                    {s.days} days
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{s.warehouse_name}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
