/**
 * Fleet Dashboard — Phase B4
 *
 * Tenant cockpit. Six KPI tiles + compliance banner + top-5 drivers/vehicles.
 * Single backend call to `/api/fleet/overview` covers everything; the rest
 * of the page is pure render.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import {
  Users, Truck, ClipboardList, ShieldAlert, AlertTriangle, Sparkles,
  RefreshCw, ChevronRight,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const SEVERITY_STYLES = {
  expired:  "bg-rose-100 text-rose-700 border-rose-200",
  critical: "bg-rose-50 text-rose-600 border-rose-200",
  high:     "bg-amber-100 text-amber-800 border-amber-200",
  warning:  "bg-amber-50 text-amber-700 border-amber-200",
  info:     "bg-sky-50 text-sky-700 border-sky-200",
  ok:       "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function StatusBadge({ severity }) {
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.ok;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${style}`}
      data-testid={`severity-badge-${severity}`}
    >
      {severity}
    </span>
  );
}

function Tile({ title, value, accent, icon: Icon, footer, testid }) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
      data-testid={testid}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
        </div>
        <div className={`rounded-xl p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {footer && <div className="mt-3 text-xs text-slate-500">{footer}</div>}
    </div>
  );
}

function ComplianceBanner({ compliance }) {
  if (!compliance) return null;
  const expired = compliance.expired || 0;
  const critical = compliance.critical || 0;
  const warning = compliance.warning || 0;
  const expiring = compliance.expiring_30d || 0;
  const danger = expired + critical;
  if (danger === 0 && warning === 0 && expiring === 0) {
    return (
      <div
        className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-700"
        data-testid="compliance-banner-clean"
      >
        <Sparkles className="h-5 w-5" />
        <span className="font-medium">Fleet compliance is clean — no expiries in the next 90 days.</span>
      </div>
    );
  }
  const tone = danger > 0 ? "rose" : "amber";
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-${tone}-50 border-${tone}-200 px-5 py-4`}
      data-testid="compliance-banner"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className={`h-5 w-5 text-${tone}-600`} />
        <div className={`text-${tone}-800`}>
          <div className="font-semibold">Fleet compliance attention required</div>
          <div className="text-sm">
            {expired > 0 && <span className="mr-3"><strong>{expired}</strong> expired</span>}
            {critical > 0 && <span className="mr-3"><strong>{critical}</strong> critical (≤7d)</span>}
            {warning > 0 && <span className="mr-3"><strong>{warning}</strong> warning</span>}
            {expiring > 0 && <span><strong>{expiring}</strong> expiring within 30 days</span>}
          </div>
        </div>
      </div>
      <Link
        to="/fleet/compliance"
        data-testid="compliance-banner-cta"
        className={`inline-flex items-center gap-1 rounded-full bg-${tone}-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-${tone}-700`}
      >
        Open Compliance <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function StatusBreakdown({ title, by_status, testid }) {
  const entries = Object.entries(by_status || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid={testid}>
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <p className="mt-2 text-sm text-slate-400">No data yet.</p>
      </div>
    );
  }
  const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid={testid}>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
        {entries.map(([s, n]) => (
          <div
            key={s}
            className={`h-full ${statusBar(s)}`}
            style={{ width: `${(n / total) * 100}%` }}
            title={`${s}: ${n}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {entries.map(([s, n]) => (
          <li key={s} className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${statusDot(s)}`} />
              <span className="capitalize text-slate-600">{s.replace(/_/g, " ")}</span>
            </span>
            <span className="font-medium text-slate-900 tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function statusBar(status) {
  if (["available", "ok", "delivered"].includes(status)) return "bg-emerald-500";
  if (["in_transit", "assigned", "loading", "loaded"].includes(status)) return "bg-sky-500";
  if (["on_trip", "arrived"].includes(status)) return "bg-violet-500";
  if (["maintenance", "warning"].includes(status)) return "bg-amber-500";
  if (["offline", "cancelled", "expired", "critical"].includes(status)) return "bg-rose-500";
  return "bg-slate-400";
}
function statusDot(status) {
  return statusBar(status);
}

function TopList({ title, items, render, emptyLabel, testid }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid={testid}>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {items?.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((it, i) => (
            <li key={it.id || i} className="py-2.5">
              {render(it, i)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">{emptyLabel}</p>
      )}
    </div>
  );
}

export default function FleetDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const res = await api.get("/fleet/overview");
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(() => fetchData(true), 60000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4" data-testid="fleet-dashboard-loading">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700" data-testid="fleet-dashboard-error">
        Failed to load Fleet overview: {error}
      </div>
    );
  }

  const d = data || {};
  return (
    <div className="space-y-6" data-testid="fleet-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900" data-testid="fleet-dashboard-title">
            Fleet Dashboard
          </h1>
          <p className="text-sm text-slate-500">
            {d.scope === "global" ? "All tenants" : `Tenant ${d.tenant_id?.slice(0, 8) || ""}`}
            {" · "}
            generated {d.generated_at ? new Date(d.generated_at).toLocaleTimeString() : "—"}
          </p>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          data-testid="fleet-dashboard-refresh"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <ComplianceBanner compliance={d.compliance} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          title="Drivers"
          value={d.drivers?.total ?? 0}
          icon={Users}
          accent="bg-indigo-50 text-indigo-600"
          footer={`${d.drivers?.available || 0} available · ${d.drivers?.on_trip || 0} on trip`}
          testid="tile-drivers"
        />
        <Tile
          title="Vehicles"
          value={d.vehicles?.total ?? 0}
          icon={Truck}
          accent="bg-sky-50 text-sky-600"
          footer={`${d.vehicles?.available || 0} available · ${d.vehicles?.in_transit || 0} in transit`}
          testid="tile-vehicles"
        />
        <Tile
          title="Open shipments"
          value={d.shipments?.open ?? 0}
          icon={ClipboardList}
          accent="bg-violet-50 text-violet-600"
          footer={`${d.shipments?.delivered || 0} delivered · ${d.shipments?.cancelled || 0} cancelled`}
          testid="tile-shipments-open"
        />
        <Tile
          title="Compliance issues"
          value={(d.compliance?.critical || 0) + (d.compliance?.warning || 0)}
          icon={ShieldAlert}
          accent={d.compliance?.critical ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}
          footer={`${d.compliance?.expired || 0} expired · ${d.compliance?.expiring_30d || 0} expiring ≤30d`}
          testid="tile-compliance"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatusBreakdown
          title="Drivers by status"
          by_status={d.drivers?.by_status}
          testid="breakdown-drivers"
        />
        <StatusBreakdown
          title="Vehicles by status"
          by_status={d.vehicles?.by_status}
          testid="breakdown-vehicles"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopList
          title="Busiest drivers"
          items={d.top_drivers}
          emptyLabel="No active drivers yet."
          testid="top-drivers"
          render={(drv) => (
            <Link
              to={`/fleet/drivers/${drv.id}`}
              className="flex items-center justify-between gap-3 hover:text-indigo-700"
              data-testid={`top-driver-${drv.employee_number}`}
            >
              <div>
                <div className="font-medium text-slate-800">{drv.full_name}</div>
                <div className="text-xs text-slate-500">{drv.employee_number}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge severity={drv.status === "on_trip" ? "info" : "ok"} />
                <span className="text-sm tabular-nums text-slate-700">{drv.active_shipments} active</span>
              </div>
            </Link>
          )}
        />
        <TopList
          title="Most utilised vehicles (30d)"
          items={d.top_vehicles}
          emptyLabel="No active vehicles yet."
          testid="top-vehicles"
          render={(v) => (
            <Link
              to={`/fleet/vehicles/${v.id}`}
              className="flex items-center justify-between gap-3 hover:text-indigo-700"
              data-testid={`top-vehicle-${v.vehicle_code}`}
            >
              <div>
                <div className="font-medium text-slate-800">{v.vehicle_code}</div>
                <div className="text-xs text-slate-500">{v.registration_number}</div>
              </div>
              <div className="text-sm tabular-nums text-slate-700">
                {v.trips_30d} trips · {v.units_30d} units
              </div>
            </Link>
          )}
        />
      </div>
    </div>
  );
}
