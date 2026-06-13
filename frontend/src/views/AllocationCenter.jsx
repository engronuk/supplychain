// Manufacturer Order Allocation Center
// ----------------------------------------------------------------------------
// Single command surface for every distributor purchase order. Distributors
// place demand here, manufacturers allocate it to warehouses, warehouses
// execute. Warehouses never accept orders directly.
//
// Layout:
//   • KPI strip (8 buckets)
//   • Bucket nav (left rail) + Order list table
//   • Slide-over allocation decision drawer with auto / manual modes
// ----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Inbox, Clock, CheckCircle2, Truck, PackageCheck, Ban, AlertTriangle,
  ArrowLeftRight, X, Sparkles, Wand2, Search, ChevronRight, Send,
  RotateCcw, ShieldX, ClipboardList, MapPin, Wallet, Package, ArrowRight,
  Gauge, Timer, ShieldCheck, Warehouse,
} from "lucide-react";
import { Api } from "../lib/api";
import { Button } from "../components/ui/button";

const BUCKETS = [
  { id: "new",                     label: "New Orders",            Icon: Inbox,         tint: "blue" },
  { id: "awaiting_allocation",     label: "Awaiting Allocation",   Icon: Clock,         tint: "amber" },
  { id: "allocated",               label: "Allocated",             Icon: CheckCircle2,  tint: "emerald" },
  { id: "fulfillment_in_progress", label: "Fulfillment In Progress", Icon: Truck,       tint: "indigo" },
  { id: "completed",               label: "Completed",             Icon: PackageCheck,  tint: "violet" },
  { id: "back_ordered",            label: "Back Orders",           Icon: AlertTriangle, tint: "rose" },
  { id: "rejected",                label: "Rejected",              Icon: Ban,           tint: "slate" },
];

const naira = (n) => `₦${(Number(n) || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const num   = (n) => (Number(n) || 0).toLocaleString();

export default function AllocationCenter() {
  const [summary, setSummary] = useState({});
  const [kpis, setKpis] = useState(null);
  const [bucket, setBucket] = useState("new");
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState(null); // order to act on

  const reload = () => {
    Promise.all([
      Api.allocationSummary().then(setSummary).catch(() => setSummary({})),
      Api.allocationPool(bucket).then(setRows).catch(() => setRows([])),
      Api.allocationKpis(30).then(setKpis).catch(() => setKpis(null)),
    ]).finally(() => setLoading(false));
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      Api.allocationSummary().then((d) => !cancelled && setSummary(d)).catch(() => !cancelled && setSummary({})),
      Api.allocationPool(bucket).then((d) => !cancelled && setRows(d)).catch(() => !cancelled && setRows([])),
      Api.allocationKpis(30).then((d) => !cancelled && setKpis(d)).catch(() => !cancelled && setKpis(null)),
    ]).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [bucket]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return rows;
    return rows.filter((r) => [r.distributor_name, r.id, r.distributor_city].join(" ").toLowerCase().includes(ql));
  }, [rows, q]);

  return (
    <div className="space-y-6" data-testid="allocation-center">
      {/* Heading */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Order Allocation</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Central command surface for every distributor order. Allocate inventory to warehouses for execution; warehouses cannot accept orders directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="border-slate-200" onClick={reload}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Performance KPI strip — pure rule-based (no AI) */}
      <PerformanceKpiStrip kpis={kpis} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {BUCKETS.map((b) => (
          <BucketCard key={b.id} bucket={b} count={summary[b.id] || 0} active={bucket === b.id} onClick={() => setBucket(b.id)} />
        ))}
      </div>

      {/* Body: list */}
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <div className="font-semibold text-slate-900">{BUCKETS.find((b) => b.id === bucket)?.label}</div>
          <span className="text-xs text-slate-500">{filtered.length} order{filtered.length === 1 ? "" : "s"}</span>
          <div className="flex-1" />
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search distributor or order #"
              className="w-72 rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              data-testid="allocation-search" />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400 text-sm">Loading orders…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">No orders in this bucket.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-5 font-medium">Order</th>
                <th className="text-left py-3 font-medium">Distributor</th>
                <th className="text-left py-3 font-medium">Region</th>
                <th className="text-right py-3 font-medium">Units</th>
                <th className="text-right py-3 font-medium">Value</th>
                <th className="text-left py-3 pl-6 font-medium">Submitted</th>
                <th className="text-right py-3 px-5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                  <td className="py-3 px-5 font-mono text-xs text-slate-900 font-medium">{o.id.slice(0, 8).toUpperCase()}</td>
                  <td className="py-3">
                    <div className="text-slate-900 font-medium">{o.distributor_name}</div>
                    <div className="text-xs text-slate-500">{o.items?.length || 0} SKU lines</div>
                  </td>
                  <td className="py-3 text-slate-600 text-xs">{o.distributor_city || o.distributor_region || "—"}</td>
                  <td className="py-3 text-right text-slate-700">{num(o.total_units)}</td>
                  <td className="py-3 text-right font-semibold text-slate-900">{naira(o.total_value)}</td>
                  <td className="py-3 pl-6 text-slate-500 text-xs">{relTime(o.created_at)}</td>
                  <td className="py-3 px-5 text-right">
                    <Button size="sm" onClick={() => setDecision(o)}
                      className="bg-blue-600 hover:bg-blue-700 text-white" data-testid={`open-${o.id.slice(0, 8)}`}>
                      Review <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {decision && (
        <AllocationDrawer order={decision}
          onClose={() => setDecision(null)}
          onChanged={() => { setDecision(null); reload(); }} />
      )}
    </div>
  );
}

function BucketCard({ bucket, count, active, onClick }) {
  const C = {
    blue:    ["bg-blue-50 text-blue-600",       "ring-blue-500"],
    amber:   ["bg-amber-50 text-amber-600",     "ring-amber-500"],
    emerald: ["bg-emerald-50 text-emerald-600", "ring-emerald-500"],
    indigo:  ["bg-indigo-50 text-indigo-600",   "ring-indigo-500"],
    violet:  ["bg-violet-50 text-violet-600",   "ring-violet-500"],
    rose:    ["bg-rose-50 text-rose-600",       "ring-rose-500"],
    slate:   ["bg-slate-100 text-slate-500",    "ring-slate-400"],
  }[bucket.tint];
  return (
    <button onClick={onClick} data-testid={`bucket-${bucket.id}`}
      className={`text-left rounded-xl border bg-white shadow-sm p-4 hover:shadow-md transition ${
        active ? `border-transparent ring-2 ${C[1]}` : "border-slate-200"
      }`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`h-8 w-8 rounded-lg grid place-items-center ${C[0]}`}><bucket.Icon className="h-4 w-4" /></div>
        <span className="text-2xl font-bold text-slate-900 leading-none">{count}</span>
      </div>
      <div className="text-xs font-medium text-slate-700 mt-3">{bucket.label}</div>
    </button>
  );
}

function PerformanceKpiStrip({ kpis }) {
  const k = kpis?.kpis;
  const warehouses = kpis?.warehouses || [];
  const days = kpis?.window_days || 30;

  // Tone helpers so good performance reads as green, weak as rose, neutral as slate.
  const tone = (good, warn, value) => {
    if (value == null) return "slate";
    if (value >= good) return "emerald";
    if (value >= warn) return "amber";
    return "rose";
  };
  const inverseTone = (low, mid, value) => {
    if (value == null) return "slate";
    if (value <= low) return "emerald";
    if (value <= mid) return "amber";
    return "rose";
  };
  const fillTone = tone(85, 60, k?.fill_rate_pct);
  const allocTone = inverseTone(4, 12, k?.avg_allocation_hours);
  const backTone = inverseTone(5, 15, k?.back_order_rate_pct);
  const serviceTone = tone(85, 60, k?.service_level_pct);

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm p-4 md:p-5"
      data-testid="allocation-kpi-strip">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider font-medium text-slate-500">
            Allocation Performance · last {days} days
          </div>
          <div className="text-sm text-slate-600">
            Rule-based metrics derived from your order, allocation and fulfillment timestamps.
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <KpiTile
          testid="kpi-fill-rate"
          Icon={Gauge}
          tint={fillTone}
          label="Fill Rate"
          value={k ? `${k.fill_rate_pct}%` : "—"}
          hint={k ? `${(k.allocated_units || 0).toLocaleString()} of ${(k.requested_units || 0).toLocaleString()} units allocated` : ""}
        />
        <KpiTile
          testid="kpi-allocation-time"
          Icon={Timer}
          tint={allocTone}
          label="Avg Allocation Time"
          value={k?.avg_allocation_hours != null ? `${k.avg_allocation_hours}h` : "—"}
          hint="From order submitted → allocation decided"
        />
        <KpiTile
          testid="kpi-backorder-rate"
          Icon={AlertTriangle}
          tint={backTone}
          label="Back-Order Rate"
          value={k ? `${k.back_order_rate_pct}%` : "—"}
          hint={k ? `${k.back_orders || 0} of ${k.decided_orders || 0} decided orders` : ""}
        />
        <KpiTile
          testid="kpi-service-level"
          Icon={ShieldCheck}
          tint={serviceTone}
          label="Service Level"
          value={k ? `${k.service_level_pct}%` : "—"}
          hint={k ? `${k.on_time_orders || 0} of ${k.completed_orders || 0} completed within 7 days` : ""}
        />
        <KpiTile
          testid="kpi-top-warehouse"
          Icon={Warehouse}
          tint="indigo"
          label="Top Warehouse"
          value={warehouses[0]?.warehouse_name?.split(" ").slice(0, 3).join(" ") || "—"}
          hint={
            warehouses[0]
              ? `${warehouses[0].fulfillments} fulfillments · ${warehouses[0].delivered} delivered`
              : "No fulfillment activity yet"
          }
        />
      </div>
      {warehouses.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="text-xs uppercase tracking-wider font-medium text-slate-500 mb-2">
            Warehouse Performance
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="kpi-warehouse-table">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="text-left font-medium py-1">Warehouse</th>
                  <th className="text-right font-medium py-1">Fulfillments</th>
                  <th className="text-right font-medium py-1">Delivered</th>
                  <th className="text-right font-medium py-1">In Progress</th>
                  <th className="text-right font-medium py-1">On-Time %</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => (
                  <tr key={w.warehouse_id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-800">{w.warehouse_name}</td>
                    <td className="py-2 text-right text-slate-700">{w.fulfillments}</td>
                    <td className="py-2 text-right text-emerald-700 font-medium">{w.delivered}</td>
                    <td className="py-2 text-right text-slate-600">{w.in_progress}</td>
                    <td className="py-2 text-right font-medium text-slate-800">
                      {w.on_time_pct != null ? `${w.on_time_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiTile({ testid, Icon, tint, label, value, hint }) {
  const C = {
    emerald: "bg-emerald-50 text-emerald-600 ring-emerald-200",
    amber: "bg-amber-50 text-amber-600 ring-amber-200",
    rose: "bg-rose-50 text-rose-600 ring-rose-200",
    indigo: "bg-indigo-50 text-indigo-600 ring-indigo-200",
    slate: "bg-slate-100 text-slate-500 ring-slate-200",
  }[tint] || "bg-slate-100 text-slate-500 ring-slate-200";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <div className={`h-7 w-7 rounded-md grid place-items-center ${C}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-xl font-bold text-slate-900 leading-none">{value}</span>
      </div>
      <div className="text-[11px] font-medium text-slate-700 mt-3 uppercase tracking-wider">
        {label}
      </div>
      {hint && (
        <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</div>
      )}
    </div>
  );
}

function relTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "—";
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

// ----------------------------------------------------------------------------
// Allocation Decision Drawer
// ----------------------------------------------------------------------------
function AllocationDrawer({ order, onClose, onChanged }) {
  const [rec, setRec] = useState(null);
  const [mode, setMode] = useState("auto"); // auto | manual
  const [manual, setManual] = useState({}); // pid -> [{warehouse_id, quantity}]
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Api.allocationRecommend(order.id).then(setRec).catch(() => setRec({ rows: [] }));
  }, [order.id]);

  const totalRequested = order.items?.reduce((s, it) => s + (it.quantity || 0), 0) || 0;

  const setManualQty = (pid, warehouse_id, value) => {
    setManual((prev) => {
      const list = (prev[pid] || []).filter((l) => l.warehouse_id !== warehouse_id);
      const v = parseInt(value, 10);
      if (v && v > 0) list.push({ warehouse_id, quantity: v });
      return { ...prev, [pid]: list };
    });
  };

  const submitAuto = async () => {
    setBusy(true);
    try {
      const r = await Api.allocationAuto(order.id, "");
      toast.success(`Order ${r.status.replace("_", " ")}`);
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to allocate");
    } finally { setBusy(false); }
  };

  const submitManual = async () => {
    const lines = [];
    for (const pid of Object.keys(manual)) {
      for (const l of manual[pid]) {
        lines.push({ product_id: pid, warehouse_id: l.warehouse_id, quantity: l.quantity });
      }
    }
    if (lines.length === 0) return toast.error("Add at least one allocation line.");
    setBusy(true);
    try {
      const r = await Api.allocationManual(order.id, lines, "");
      toast.success(`Order ${r.status.replace("_", " ")}`);
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to allocate");
    } finally { setBusy(false); }
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) return toast.error("Reason is required");
    setBusy(true);
    try {
      await Api.allocationReject(order.id, rejectReason);
      toast.success("Order rejected");
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to reject");
    } finally { setBusy(false); }
  };

  const backOrder = async () => {
    setBusy(true);
    try {
      await Api.allocationBackOrder(order.id, "Insufficient inventory across network");
      toast.success("Order moved to back orders");
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to back-order");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex" data-testid="allocation-drawer">
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="w-full max-w-3xl bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-medium text-blue-600">Allocation Decision</div>
              <h2 className="text-xl font-bold text-slate-900 mt-1">Order {order.id.slice(0, 8).toUpperCase()}</h2>
              <div className="mt-2 text-sm text-slate-600 flex items-center gap-3 flex-wrap">
                <span className="inline-flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-slate-400" />{order.distributor_name}</span>
                {order.distributor_city && <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" />{order.distributor_city}</span>}
                <span className="inline-flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-slate-400" />{naira(order.total_value)}</span>
                <span className="inline-flex items-center gap-1.5 text-slate-500"><ClipboardList className="h-3.5 w-3.5" />{num(totalRequested)} units · {order.items?.length || 0} SKUs</span>
              </div>
            </div>
            <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-slate-100">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>

          {/* Mode toggle */}
          <div className="mt-5 inline-flex bg-slate-100 rounded-lg p-0.5 text-sm font-medium">
            {[
              ["auto",   "Automatic",  Sparkles],
              ["manual", "Manual",     Wand2],
            ].map(([k, l, I]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`px-4 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${
                  mode === k ? "bg-white shadow text-slate-900" : "text-slate-600 hover:text-slate-900"
                }`} data-testid={`mode-${k}`}>
                <I className="h-3.5 w-3.5" /> {l}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {!rec ? (
            <div className="text-center text-slate-400 py-10 text-sm">Loading recommendation…</div>
          ) : rec.rows.length === 0 ? (
            <div className="text-center text-slate-400 py-10 text-sm">No product lines on this order.</div>
          ) : (
            rec.rows.map((row) => (
              <ProductRow key={row.product_id} row={row} mode={mode} manual={manual} setManualQty={setManualQty} />
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center gap-3 flex-wrap">
          <Button variant="outline" onClick={backOrder} disabled={busy}
            className="border-amber-200 text-amber-700 hover:bg-amber-50" data-testid="action-backorder">
            <AlertTriangle className="h-4 w-4 mr-1.5" /> Back Order
          </Button>
          <Button variant="outline" onClick={() => setRejecting((v) => !v)} disabled={busy}
            className="border-rose-200 text-rose-700 hover:bg-rose-50" data-testid="action-reject">
            <ShieldX className="h-4 w-4 mr-1.5" /> Reject
          </Button>
          <div className="flex-1" />
          {mode === "auto" ? (
            <Button onClick={submitAuto} disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="action-auto-allocate">
              <Sparkles className="h-4 w-4 mr-1.5" /> Auto-Allocate
            </Button>
          ) : (
            <Button onClick={submitManual} disabled={busy} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="action-manual-allocate">
              <Send className="h-4 w-4 mr-1.5" /> Apply Allocation
            </Button>
          )}
        </div>

        {rejecting && (
          <div className="px-6 py-4 border-t border-rose-100 bg-rose-50/50">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Rejection reason</label>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500"
              placeholder="Why is this order being rejected?" data-testid="reject-reason" />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={() => setRejecting(false)}>Cancel</Button>
              <Button size="sm" onClick={submitReject} disabled={busy} className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="confirm-reject">
                Confirm Rejection
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function ProductRow({ row, mode, manual, setManualQty }) {
  const manualTotal = (manual[row.product_id] || []).reduce((s, l) => s + (l.quantity || 0), 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white" data-testid={`product-row-${row.product_id}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{row.product_name || row.product_id}</div>
          <div className="text-xs text-slate-500 mt-0.5">SKU {row.sku || "—"} · {num(row.requested)} units requested</div>
        </div>
        {mode === "manual" && (
          <div className="text-xs">
            <span className="text-slate-500">Allocated:</span>{" "}
            <span className={`font-semibold ${manualTotal === row.requested ? "text-emerald-600" : manualTotal > row.requested ? "text-rose-600" : "text-amber-600"}`}>
              {num(manualTotal)} / {num(row.requested)}
            </span>
          </div>
        )}
      </div>
      <ul className="divide-y divide-slate-100">
        {row.warehouses.map((w) => {
          const manualLine = (manual[row.product_id] || []).find((l) => l.warehouse_id === w.warehouse_id);
          return (
            <li key={w.warehouse_id} className="px-4 py-3 flex items-center gap-4">
              {w.recommended && (
                <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                  <Sparkles className="h-3 w-3" /> Recommended
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 text-sm">{w.warehouse_name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {w.warehouse_code} {w.region ? `· ${w.region}` : ""} · {num(w.available)} available
                </div>
              </div>
              {mode === "manual" ? (
                <input type="number" min="0" max={w.available}
                  value={manualLine?.quantity || ""}
                  onChange={(e) => setManualQty(row.product_id, w.warehouse_id, e.target.value)}
                  placeholder="0"
                  className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  data-testid={`qty-${row.product_id}-${w.warehouse_id}`} />
              ) : (
                <span className="text-xs text-slate-500 font-mono">score {w.score}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
