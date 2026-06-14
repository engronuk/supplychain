// Wholesaler network surface on the distributor dashboard. Per the
// canonical chain (Distributor → Wholesaler → Retailer), this is the
// distributor's primary downstream relationship. Cards expand into a
// drill-down view at /distributor/wholesaler/:wid.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronRight, MapPin, ShoppingBag, TrendingUp, TrendingDown,
  Activity, AlertTriangle,
} from "lucide-react";
import { Api } from "@/lib/api";

const fmtMoney = (n) => "₦" + Math.round(Number(n) || 0).toLocaleString();
const fmtNum   = (n) => Number(n || 0).toLocaleString();
const fmtPct   = (n) => {
  const v = Number(n) || 0;
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
};

const STATUS_TONE = {
  healthy:   { tile: "bg-emerald-50",  text: "text-emerald-700", ring: "ring-emerald-200" },
  attention: { tile: "bg-amber-50",    text: "text-amber-700",   ring: "ring-amber-200" },
  critical:  { tile: "bg-rose-50",     text: "text-rose-700",    ring: "ring-rose-200" },
};

export default function WholesalerNetworkSection({ distributorId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!distributorId) return;
    setLoading(true);
    Api.distributorWholesalerNetwork(distributorId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [distributorId]);

  if (loading || !data) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 text-sm text-slate-400" data-testid="wholesaler-network-loading">
        Loading wholesaler network…
      </div>
    );
  }

  const k = data.kpis || {};
  const ws = data.wholesalers || [];

  return (
    <section className="space-y-4" data-testid="wholesaler-network-section">
      {/* KPI band */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5 md:p-6">
        <div className="flex items-start justify-between mb-4 gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400 font-semibold">Distributor → Wholesaler → Retailer</div>
            <h2 className="text-xl font-semibold text-slate-900 mt-0.5">Wholesaler Network</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              The wholesalers you serve directly. Each one fans out to its own retailer base — click any card to drill in.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="Wholesalers" value={fmtNum(k.total_wholesalers)} sub={`${k.active_wholesalers_30d ?? 0} active 30d`} tone="violet" Icon={ShoppingBag} />
          <Kpi label="Retailers (visibility)" value={fmtNum(k.total_retailers_in_network)} sub={`${k.active_retailers_30d ?? 0} active 30d · owned by wholesalers`} tone="blue" Icon={Activity} />
          <Kpi label="Network Revenue · 90d" value={fmtMoney(k.revenue_90d)} sub="across all wholesalers" tone="emerald" Icon={TrendingUp} />
          <Kpi label="Coverage tier" value="Tier-2 ←→ Tier-3" sub="Distributor → Wholesaler" tone="slate" Icon={MapPin} />
        </div>
      </div>

      {/* Wholesaler cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="wholesaler-cards">
        {ws.length === 0 ? (
          <div className="col-span-full text-sm text-slate-400 py-10 text-center bg-white border border-dashed border-slate-200 rounded-2xl">
            No wholesalers assigned yet.
          </div>
        ) : ws.map((w) => <WholesalerCard key={w.id} w={w} distributorId={distributorId} />)}
      </div>
    </section>
  );
}

function WholesalerCard({ w, distributorId }) {
  const t = STATUS_TONE[w.status] || STATUS_TONE.healthy;
  const up = (w.growth_pct ?? 0) >= 0;
  return (
    <Link
      to={`/distributor/${distributorId}/wholesaler/${w.id}`}
      data-testid={`wholesaler-card-${w.id}`}
      className={`group rounded-2xl bg-white border border-slate-200 hover:border-violet-300 hover:shadow-md transition-all p-4 ring-1 ring-transparent ${
        w.status === "critical" ? "hover:ring-rose-200" : w.status === "attention" ? "hover:ring-amber-200" : "hover:ring-emerald-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-lg ${t.tile} flex items-center justify-center font-bold text-sm ${t.text} shrink-0`}>
          {String(w.name || "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{w.name}</div>
          <div className="text-[11px] text-slate-500 truncate flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {w.city || "—"} · {w.region || "—"}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-violet-500 group-hover:translate-x-0.5 transition-all" />
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        <Mini label="Retailers" value={fmtNum(w.retailer_count)} sub={`${w.active_retailers_30d || 0} active`} />
        <Mini label="Revenue 90d" value={fmtMoney(w.revenue_90d)} sub={
          <span className={up ? "text-emerald-600" : "text-rose-600"}>
            {up ? <TrendingUp className="h-2.5 w-2.5 inline" /> : <TrendingDown className="h-2.5 w-2.5 inline" />} {fmtPct(w.growth_pct)}
          </span>
        } />
        <Mini label="Pending POs" value={fmtNum(w.pending_orders)} sub={w.pending_orders > 0 ? "to approve" : "—"} />
      </div>

      {w.status !== "healthy" && (
        <div className={`mt-3 rounded-lg ${t.tile} ${t.text} px-2.5 py-1.5 text-[11px] font-medium flex items-center gap-1.5`}>
          <AlertTriangle className="h-3 w-3" />
          {w.status === "critical" ? "No retailer activity in 30d" : "Revenue trending down — investigate"}
        </div>
      )}
    </Link>
  );
}

function Kpi({ label, value, sub, Icon, tone = "slate" }) {
  const tones = {
    violet:  "bg-violet-50 text-violet-700",
    blue:    "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber:   "bg-amber-50 text-amber-700",
    slate:   "bg-slate-50 text-slate-700",
  };
  return (
    <div className="rounded-xl border border-slate-100 p-3.5">
      <div className="flex items-center gap-2">
        <div className={`h-7 w-7 rounded-lg ${tones[tone] || tones.slate} grid place-items-center`}>
          {Icon && <Icon className="h-3.5 w-3.5" />}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      </div>
      <div className="text-lg font-bold text-slate-900 mt-1.5 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
      <div className="text-sm font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}
