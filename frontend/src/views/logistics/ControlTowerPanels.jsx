// Control Tower panels — KPI strip, 5-tier inventory flow and digital twin.
import { Fragment } from "react";
import {
  AlertTriangle, BellRing, Boxes, Building2, ChevronRight, Clock4, Gauge,
  Radar, ShoppingBag, Store, Truck, Warehouse, Wrench,
} from "lucide-react";

const num = (n) => (Number(n) || 0).toLocaleString();
export const unitsCompact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return num(v);
};

// ===========================================================================
export const KpiStrip = ({ kpis: k }) => (
  <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5" data-testid="tower-kpi-strip">
    <TowerKpi testId="tower-kpi-active" label="Active Shipments" value={num(k.active_shipments)} Icon={Truck} accent="text-emerald-400" />
    <TowerKpi testId="tower-kpi-units" label="Units In Transit" value={unitsCompact(k.in_transit_units)} Icon={Boxes} accent="text-sky-400" />
    <TowerKpi testId="tower-kpi-ontime" label="On-Time (30d)" value={k.on_time_pct != null ? `${k.on_time_pct}%` : "—"} Icon={Gauge} accent="text-emerald-400" />
    <TowerKpi testId="tower-kpi-delayed" label="Delayed" value={num(k.delayed)} Icon={Clock4}
              accent={k.delayed ? "text-amber-400" : "text-slate-600"}
              valueClass={k.delayed ? "text-amber-300" : "text-white"} />
    <TowerKpi testId="tower-kpi-exceptions" label="Route Exceptions" value={num((k.deviations_active || 0) + (k.unauthorized_stops || 0))}
              Icon={AlertTriangle}
              accent={(k.deviations_active || 0) + (k.unauthorized_stops || 0) ? "text-orange-400" : "text-slate-600"}
              valueClass={(k.deviations_active || 0) + (k.unauthorized_stops || 0) ? "text-orange-300" : "text-white"} />
    <TowerKpi testId="tower-kpi-breakdowns" label="Breakdowns" value={num(k.breakdowns_active)} Icon={Wrench}
              accent={k.breakdowns_active ? "text-rose-400" : "text-slate-600"}
              valueClass={k.breakdowns_active ? "text-rose-300" : "text-white"} />
    <TowerKpi testId="tower-kpi-geofence" label="Geofence Events" value={num(k.geofence_events_today)} sub="today" Icon={Radar} accent="text-cyan-400" />
    <TowerKpi testId="tower-kpi-critical" label="Critical Unacked" value={num(k.unacked_critical)} Icon={BellRing}
              accent={k.unacked_critical ? "text-rose-400" : "text-slate-600"}
              valueClass={k.unacked_critical ? "text-rose-300" : "text-white"} />
  </div>
);

function TowerKpi({ label, value, sub, Icon, accent, valueClass = "text-white", testId }) {
  return (
    <div data-testid={testId} className="rounded-xl bg-slate-900/70 border border-slate-800 px-3 py-2.5 transition-colors hover:border-slate-700">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold truncate">{label}</span>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${accent}`} />
      </div>
      <div className={`text-lg font-bold mt-1 tabular-nums tracking-tight ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ===========================================================================
const TIERS = [
  { id: "warehouse", label: "Warehouses", Icon: Warehouse, tint: "text-sky-400" },
  { id: "in_transit", label: "In Transit", Icon: Truck, tint: "text-emerald-400", live: true },
  { id: "distributor", label: "Distributors", Icon: Building2, tint: "text-indigo-400" },
  { id: "wholesaler", label: "Wholesalers", Icon: Store, tint: "text-violet-400" },
  { id: "retailer", label: "Retailers", Icon: ShoppingBag, tint: "text-amber-400" },
];

export const TierFlow = ({ tiers = {} }) => {
  const total = TIERS.reduce((a, t) => a + (Number(tiers[t.id]) || 0), 0) || 1;
  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3" data-testid="tier-flow">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold mb-2 px-1">
        Inventory across the network — factory gate → retail shelf
      </div>
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5">
        {TIERS.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 && <div className="self-center text-slate-700 shrink-0"><ChevronRight className="h-4 w-4" /></div>}
            <div
              data-testid={`tier-node-${t.id}`}
              className={`flex-1 min-w-[118px] rounded-lg px-3 py-2 border ${
                t.live ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-800 bg-slate-900/70"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <t.Icon className={`h-3.5 w-3.5 ${t.tint}`} />
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide truncate">{t.label}</span>
                {t.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse ml-auto shrink-0" />}
              </div>
              <div className="text-base font-bold text-white mt-1 tabular-nums">{unitsCompact(tiers[t.id])}</div>
              <div className="text-[10px] text-slate-500">{(((Number(tiers[t.id]) || 0) / total) * 100).toFixed(1)}% of network</div>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
};

// ===========================================================================
export const DigitalTwinPanel = ({ twin = {}, onShowPending }) => {
  const warehouses = twin.warehouses || [];
  const distributors = twin.distributors || [];
  const wholesalers = (twin.wholesalers || []).slice()
    .sort((a, b) => (b.orders_pending || 0) - (a.orders_pending || 0) || (b.units || 0) - (a.units || 0));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="digital-twin-panel">
      <TwinCard title="Warehouses" Icon={Warehouse} sub={`${warehouses.length} facilities · geofenced`} testId="twin-warehouses">
        {warehouses.map((w) => {
          const pct = Number(w.utilization_pct) || 0;
          const bar = pct > 85 ? "bg-rose-500" : pct > 65 ? "bg-amber-400" : "bg-emerald-500";
          return (
            <div key={w.id} className="px-3 py-2 border-b border-slate-800/70 last:border-0">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-slate-200 truncate">{w.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{w.city}{w.region ? ` · ${w.region}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[12px] font-bold text-white tabular-nums">{unitsCompact(w.units)}</div>
                  <div className="text-[10px] text-slate-500">{pct}% util</div>
                </div>
              </div>
              <div className="h-1 rounded-full bg-slate-800 mt-1.5">
                <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          );
        })}
      </TwinCard>

      <TwinCard
        title="Distributors" Icon={Building2}
        sub={`${twin.distributors_total || distributors.length} nodes · ${twin.distributors_at_risk || 0} at risk`}
        testId="twin-distributors"
      >
        {distributors.map((d) => (
          <div key={d.id} className="px-3 py-2 border-b border-slate-800/70 last:border-0 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-slate-200 truncate">{d.name}</div>
              <div className="text-[10px] text-slate-500 truncate">
                {d.city || d.region || "—"} · {unitsCompact(d.units)} units
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-slate-400 tabular-nums">
                {d.stock_cover_days != null ? `${d.stock_cover_days}d` : "—"}
              </span>
              <RiskPill risk={d.risk} />
            </div>
          </div>
        ))}
      </TwinCard>

      <TwinCard title="Wholesalers" Icon={Store} sub={`${wholesalers.length} hubs`} testId="twin-wholesalers">
        {wholesalers.map((w) => (
          <div key={w.id} className="px-3 py-2 border-b border-slate-800/70 last:border-0 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-slate-200 truncate">{w.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{w.city || w.region || "—"} · {unitsCompact(w.units)} units</div>
            </div>
            <button
              type="button"
              onClick={() => w.orders_pending && onShowPending?.(w)}
              data-testid="wholesaler-pending-chip"
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 transition-colors ${
                w.orders_pending
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/25 cursor-pointer"
                  : "bg-slate-800/60 border-slate-700 text-slate-500 cursor-default"
              }`}
              title={w.orders_pending ? "View pending orders" : "No pending orders"}
            >
              {w.orders_pending || 0} pending{w.orders_pending ? " →" : ""}
            </button>
          </div>
        ))}
      </TwinCard>
    </div>
  );
};

function TwinCard({ title, Icon, sub, children, testId }) {
  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden min-w-0" data-testid={testId}>
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span className="ml-auto text-[10px] text-slate-500">{sub}</span>
      </div>
      <div className="max-h-64 overflow-y-auto">{children}</div>
    </div>
  );
}

function RiskPill({ risk }) {
  const styles = {
    high: "bg-rose-500/10 border-rose-500/30 text-rose-300",
    medium: "bg-amber-500/10 border-amber-500/30 text-amber-300",
    low: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
    unknown: "bg-slate-800/60 border-slate-700 text-slate-500",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${styles[risk] || styles.unknown}`}>
      {risk || "—"}
    </span>
  );
}
