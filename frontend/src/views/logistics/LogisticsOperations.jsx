// Planning & Operations workspace — inventory KPIs, allocations, transfers,
// pipeline and demand intelligence. Lives as the second tab of the
// Procurement workspace (live fleet/map visibility is the Control Tower's job).
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Boxes, Warehouse, Banknote, Gauge, RefreshCw,
} from "lucide-react";
import { Api } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { toast } from "sonner";
import { AlertsPanel, QuickActionsPanel, PipelinePanel, ForecastPanel } from "./LogisticsPanels";
import { TransfersPanel, CreateTransferDialog } from "./LogisticsActionPanels";

const naira = (n) => `₦${(Number(n) || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const num = (n) => (Number(n) || 0).toLocaleString();
const nairaCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e9) return `₦${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `₦${(v / 1e6).toFixed(1)}M`;
  return naira(v);
};
const unitsCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return num(v);
};

export const LogisticsOperations = ({ onGoShipments }) => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const forecastRef = useRef(null);

  const reload = useCallback((silent = false) => {
    if (!silent) setRefreshing(true);
    return Api.logisticsOverview()
      .then(setData)
      .catch((e) => {
        toast.error("Failed to load logistics overview", {
          description: e?.response?.data?.detail || e?.message,
        });
      })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  useEffect(() => { setTimeout(() => reload(true), 0); }, [reload]);

  const scrollTo = (ref) => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (loading) {
    return (
      <div className="p-8 grid place-items-center min-h-[60vh] text-slate-400 text-sm" data-testid="logistics-loading">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading planning &amp; operations…
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-8 text-center text-slate-400 text-sm" data-testid="logistics-error">
        Could not load the logistics overview.
        <Button variant="outline" className="ml-3" onClick={() => reload()}>Retry</Button>
      </div>
    );
  }

  const k = data.kpis || {};

  return (
    <div className="space-y-5" data-testid="logistics-operations">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          Warehouses, allocations, authorizations and transfers across your network — one operational picture.
        </p>
        <Button variant="outline" className="border-slate-200" onClick={() => reload()} disabled={refreshing} data-testid="logistics-refresh">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI bar — inventory & network health. Open Orders + shipment KPIs
          live on the dedicated Order Allocation / Shipments tabs to avoid
          double-reporting. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="logistics-kpi-bar">
        <Kpi label="Total Inventory" value={unitsCompact(k.total_inventory_units)} suffix="Units" Icon={Boxes} tint="blue"
             sub={`Across ${k.regions || 0} regions`} onClick={() => navigate("/manufacturer/warehouses")} testId="kpi-total-inventory" />
        <Kpi label="Warehouses" value={num(k.warehouses)} Icon={Warehouse} tint="emerald"
             sub="Active facilities" onClick={() => navigate("/manufacturer/warehouses")} testId="kpi-warehouses" />
        <Kpi label="Inventory Value" value={nairaCompact(k.inventory_value)} Icon={Banknote} tint="violet"
             sub="Warehouse stock" onClick={() => navigate("/manufacturer/warehouses")} testId="kpi-inventory-value" />
        <Kpi label="Forecast Accuracy" value={`${k.forecast_accuracy || 0}%`} Icon={Gauge} tint="emerald"
             sub="Demand engine" onClick={() => scrollTo(forecastRef)} testId="kpi-forecast-accuracy" />
      </div>

      {/* Alerts + quick actions (live fleet map lives in the Control Tower) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AlertsPanel alerts={data.alerts || []} />
        <QuickActionsPanel
          onCreateTransfer={() => setTransferOpen(true)}
          onApproveRequests={() => (onGoShipments ? onGoShipments() : navigate("/procurement?tab=shipments"))}
          onCreateShipment={() => (onGoShipments ? onGoShipments() : navigate("/procurement?tab=shipments"))}
          onViewWarehouse={() => navigate("/manufacturer/warehouses")}
          onGenerateReport={() => navigate("/reports")}
        />
      </div>

      {/* Transfer management lives here (allocations and authorizations are
          now their own dedicated tabs in Procurement). */}
      <div className="grid grid-cols-1 gap-5">
        <TransfersPanel
          transfers={data.transfers || { active: [], total: 0 }}
          onCreate={() => setTransferOpen(true)}
          onChanged={() => reload(true)}
        />
      </div>

      {/* Pipeline + Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-5">
        <PipelinePanel pipeline={data.pipeline || {}} />
        <div ref={forecastRef} className="scroll-mt-20 min-w-0">
          <ForecastPanel forecast={data.forecast || {}} />
        </div>
      </div>

      <CreateTransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        warehouses={data.map?.warehouses || []}
        onCreated={() => { setTransferOpen(false); reload(true); }}
      />
    </div>
  );
};

const TINTS = {
  blue: "bg-blue-50 text-blue-600", emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600", indigo: "bg-indigo-50 text-indigo-600",
  rose: "bg-rose-50 text-rose-600", violet: "bg-violet-50 text-violet-600",
  slate: "bg-slate-100 text-slate-500",
};

function Kpi({ label, value, suffix, Icon, tint, sub, onClick, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="rounded-xl bg-white border border-slate-200/80 shadow-sm p-3.5 text-left transition-colors hover:border-blue-300 hover:shadow-md cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium text-slate-500 truncate">{label}</div>
        <div className={`h-7 w-7 rounded-lg grid place-items-center shrink-0 ${TINTS[tint] || TINTS.slate}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="text-xl font-bold text-slate-900 mt-1.5 tracking-tight">
        {value}{suffix && <span className="text-[11px] font-medium text-slate-400 ml-1">{suffix}</span>}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</div>}
    </button>
  );
}
