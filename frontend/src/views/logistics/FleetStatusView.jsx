/**
 * Fleet Status — read-only monitoring tab inside Logistics Command Center.
 *
 * Merges what used to live in /fleet/dashboard and /fleet/command-centre
 * into a single observation surface. Five panels:
 *
 *   1. KPI cube       — drivers, vehicles, open shipments, compliance
 *   2. Vehicle board  — counts by status (no actions)
 *   3. Driver board   — counts by status (no actions)
 *   4. Compliance     — worst-severity summary + deep-link to Compliance
 *   5. Fleet alerts   — in-app notifications (fleet_compliance + logistics);
 *                       ack only — no dispatch mutations
 *
 * Dispatch actions live exclusively in /dispatch. Any "assign / reassign"
 * intent surfaces here as a deep-link to the standalone Dispatch Console.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users, Truck, ClipboardList, ShieldAlert, AlertTriangle, Sparkles,
  RefreshCw, ChevronRight, Bell, Radio, Activity,
} from "lucide-react";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge, StatusPill, FilterChips } from "@/views/fleet/_atoms";

const SHIPMENT_ACTIVE = ["assigned", "loaded", "in_transit", "arrived"];

function statusBar(status) {
  if (["available", "ok", "delivered"].includes(status)) return "bg-emerald-500";
  if (["in_transit", "assigned", "loading", "loaded"].includes(status)) return "bg-sky-500";
  if (["on_trip", "arrived"].includes(status)) return "bg-violet-500";
  if (["maintenance", "warning"].includes(status)) return "bg-amber-500";
  if (["offline", "cancelled", "expired", "critical"].includes(status)) return "bg-rose-500";
  return "bg-slate-400";
}

function Tile({ title, value, icon: Icon, accent, footer, testid }) {
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

function StatusBoard({ title, by_status, testid }) {
  const entries = Object.entries(by_status || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5" data-testid={testid}>
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {!entries.length ? (
        <p className="mt-2 text-sm text-slate-400">No data yet.</p>
      ) : (
        <>
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
                  <span className={`inline-block h-2 w-2 rounded-full ${statusBar(s)}`} />
                  <span className="capitalize text-slate-600">{s.replace(/_/g, " ")}</span>
                </span>
                <span className="font-medium text-slate-900 tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ComplianceCard({ compliance }) {
  if (!compliance) return null;
  const expired = compliance.expired || 0;
  const critical = compliance.critical || 0;
  const warning = compliance.warning || 0;
  const expiring = compliance.expiring_30d || 0;
  const clean = !expired && !critical && !warning && !expiring;
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5"
      data-testid="fleet-status-compliance-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Compliance summary
        </h3>
        <Link
          to="/fleet/compliance"
          data-testid="fleet-status-open-compliance"
          className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1"
        >
          Open Compliance <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {clean ? (
        <div className="mt-3 flex items-center gap-2 text-emerald-700">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">Fleet compliance is clean.</span>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Counter label="Expired" value={expired} tone="rose" />
          <Counter label="Critical" value={critical} tone="rose" />
          <Counter label="Warning" value={warning} tone="amber" />
          <Counter label="Expiring 30d" value={expiring} tone="amber" />
        </div>
      )}
    </div>
  );
}

function Counter({ label, value, tone }) {
  const valueTone =
    tone === "rose" ? "text-rose-700" :
    tone === "amber" ? "text-amber-700" : "text-slate-700";
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold tabular-nums ${valueTone}`}>{value}</span>
    </div>
  );
}

function AlertsCard({ notifications, onAck }) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5"
      data-testid="fleet-status-alerts-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Bell className="h-4 w-4" /> Fleet alerts
        </h3>
        <span className="text-xs text-slate-500 tabular-nums">{notifications.length}</span>
      </div>
      {!notifications.length ? (
        <p className="mt-3 text-sm text-slate-400">No unread alerts.</p>
      ) : (
        <ul className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
          {notifications.slice(0, 25).map((n) => (
            <li
              key={n.id}
              className="rounded-lg border border-slate-200 p-2.5"
              data-testid={`fleet-status-alert-${n.id.slice(0, 8)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {n.severity && <SeverityBadge severity={n.severity} />}
                  <span className="text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                </div>
                <button
                  onClick={() => onAck(n.id)}
                  data-testid={`fleet-status-alert-ack-${n.id.slice(0, 8)}`}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >Mark read</button>
              </div>
              <div className="text-sm font-medium text-slate-900 mt-1">
                {n.title || n.type}
              </div>
              {(n.message || n.body) && (
                <div className="text-xs text-slate-600 mt-0.5 line-clamp-3">
                  {n.message || n.body}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActiveShipmentsCard({ shipments }) {
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5"
      data-testid="fleet-status-shipments-card"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Activity className="h-4 w-4" /> Active shipments
        </h3>
        <Link
          to="/dispatch"
          data-testid="fleet-status-open-dispatch"
          className="text-xs text-indigo-700 hover:underline inline-flex items-center gap-1"
        >
          Open Dispatch <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
      {!shipments.length ? (
        <p className="mt-3 text-sm text-slate-400">No active shipments.</p>
      ) : (
        <ul className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
          {shipments.slice(0, 25).map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-slate-200 p-2.5"
              data-testid={`fleet-status-shipment-${s.id.slice(0, 8)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <StatusPill status={s.status} kind="vehicle" />
                <span className="text-xs text-slate-500">{s.id.slice(0, 8)}</span>
              </div>
              <div className="text-xs text-slate-700 mt-1">
                → {s.to_role} {s.to_id?.slice(0, 6)} · {s.total_units || 0}u
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  } catch { return "—"; }
}

export const FleetStatusView = () => {
  const [data, setData] = useState({
    overview: null, shipments: [], notifications: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchAll = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const statusFetches = SHIPMENT_ACTIVE.map((s) =>
        api.get(`/shipments?status=${s}`).then((r) => r.data || []).catch(() => []),
      );
      const [overview, notifsRes, ...shipmentChunks] = await Promise.all([
        api.get("/fleet/overview"),
        api.get("/notifications/me?limit=30"),
        ...statusFetches,
      ]);
      setData({
        overview: overview.data,
        shipments: shipmentChunks.flat(),
        notifications: (notifsRes.data || []).filter(
          (n) => n.type === "fleet_compliance" || n.type?.startsWith?.("logistics"),
        ),
      });
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to load");
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(() => fetchAll(true), 30000);
    return () => clearInterval(id);
  }, []);

  const ackNotification = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setData((d) => ({ ...d, notifications: d.notifications.filter((n) => n.id !== id) }));
    } catch { /* swallow */ }
  };

  const o = data.overview || {};

  if (loading) {
    return (
      <div className="space-y-4" data-testid="fleet-status-loading">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700" data-testid="fleet-status-error">
        Failed to load Fleet Status: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="fleet-status-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Radio className="h-5 w-5" /> Fleet Status
          </h2>
          <p className="text-sm text-slate-500">
            Read-only fleet monitoring · {o.tenant_id === "global" ? "All tenants" : `Tenant ${o.tenant_id?.slice(0, 8) || ""}`}
            {" · generated "}{o.generated_at ? new Date(o.generated_at).toLocaleTimeString() : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/dispatch"
            data-testid="fleet-status-dispatch-cta"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <ClipboardList className="h-3.5 w-3.5" /> Open Dispatch Console
          </Link>
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            data-testid="fleet-status-refresh"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* KPI cube */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile
          title="Drivers"
          value={o.drivers?.total ?? 0}
          icon={Users}
          accent="bg-indigo-50 text-indigo-600"
          footer={`${o.drivers?.available || 0} available · ${o.drivers?.on_trip || 0} on trip`}
          testid="fleet-status-tile-drivers"
        />
        <Tile
          title="Vehicles"
          value={o.vehicles?.total ?? 0}
          icon={Truck}
          accent="bg-sky-50 text-sky-600"
          footer={`${o.vehicles?.available || 0} available · ${o.vehicles?.in_transit || 0} in transit`}
          testid="fleet-status-tile-vehicles"
        />
        <Tile
          title="Open shipments"
          value={o.shipments?.open ?? 0}
          icon={ClipboardList}
          accent="bg-violet-50 text-violet-600"
          footer={`${o.shipments?.delivered || 0} delivered · ${o.shipments?.cancelled || 0} cancelled`}
          testid="fleet-status-tile-shipments-open"
        />
        <Tile
          title="Compliance issues"
          value={(o.compliance?.critical || 0) + (o.compliance?.warning || 0)}
          icon={ShieldAlert}
          accent={o.compliance?.critical ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}
          footer={`${o.compliance?.expired || 0} expired · ${o.compliance?.expiring_30d || 0} expiring ≤30d`}
          testid="fleet-status-tile-compliance"
        />
      </div>

      {/* Status boards row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatusBoard
          title="Vehicles by status"
          by_status={o.vehicles?.by_status}
          testid="fleet-status-vehicle-board"
        />
        <StatusBoard
          title="Drivers by status"
          by_status={o.drivers?.by_status}
          testid="fleet-status-driver-board"
        />
      </div>

      {/* Compliance + alerts + active shipments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ComplianceCard compliance={o.compliance} />
        <ActiveShipmentsCard shipments={data.shipments} />
        <AlertsCard notifications={data.notifications} onAck={ackNotification} />
      </div>
    </div>
  );
};

export default FleetStatusView;
