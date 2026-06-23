/**
 * Command Centre v2 — Phase 6
 *
 * Observation-only workspace. No master-data CRUD here; everything
 * mutating lives in Dispatch / Registries / Compliance (architecture
 * §6.8). Three panes:
 *
 *   LEFT   — Active shipments stream + Fleet status panel + Compliance summary
 *   CENTRE — Position list (Track A union with optional simulator overlay)
 *   RIGHT  — Alert centre (in-app notifications: fleet_compliance + logistics)
 *
 * Backed by:
 *   GET /api/fleet/overview                  (compliance + fleet status cube)
 *   GET /api/vehicles?include_simulator=…    (union view via source toggle)
 *   GET /api/shipments?status=…              (active stream)
 *   GET /api/notifications                   (alert centre)
 *   PATCH /api/notifications/:id/read        (acknowledge an alert)
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Radio, Bell, Truck, Activity, RefreshCw, ChevronRight, Sparkles } from "lucide-react";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge, StatusPill, FilterChips } from "./_atoms";

const SHIPMENT_ACTIVE = ["assigned", "loaded", "in_transit", "arrived"];

export default function CommandCentre() {
  const [data, setData] = useState({
    overview: null, vehicles: [], shipments: [], notifications: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState("track_a"); // track_a | simulator | all
  const [focus, setFocus] = useState(null); // selected vehicle id for side popover

  const fetchAll = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      // active shipments union (4 statuses, in parallel)
      const statusFetches = SHIPMENT_ACTIVE.map((s) =>
        api.get(`/shipments?status=${s}`).then((r) => r.data || []).catch(() => []),
      );
      const includeSimulator =
        source === "simulator" || source === "all" ? "true" : "false";
      const [overview, vehiclesRes, notifsRes, ...shipmentChunks] = await Promise.all([
        api.get("/fleet/overview"),
        api.get(`/vehicles?include_simulator=${includeSimulator}`),
        api.get("/notifications/me?limit=30"),
        ...statusFetches,
      ]);
      let vehicles = vehiclesRes.data || [];
      if (source === "track_a") {
        vehicles = vehicles.filter((v) => ["manual", "seed"].includes(v.source));
      } else if (source === "simulator") {
        vehicles = vehicles.filter((v) => v.source === "simulator");
      }
      setData({
        overview: overview.data,
        vehicles,
        shipments: shipmentChunks.flat(),
        notifications: notifsRes.data || [],
      });
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(() => fetchAll(true), 15000);
    return () => clearInterval(id);
  }, [source]);

  const focusedVehicle = useMemo(
    () => data.vehicles.find((v) => v.id === focus) || null,
    [focus, data.vehicles],
  );

  const ackNotification = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setData((d) => ({
        ...d,
        notifications: d.notifications.filter((n) => n.id !== id),
      }));
    } catch { /* swallow */ }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-12 gap-4" data-testid="command-loading">
        <Skeleton className="col-span-3 h-96 rounded-2xl" />
        <Skeleton className="col-span-6 h-96 rounded-2xl" />
        <Skeleton className="col-span-3 h-96 rounded-2xl" />
      </div>
    );
  }

  const o = data.overview || {};
  return (
    <div className="space-y-4" data-testid="command-centre">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <Radio className="h-6 w-6" /> Command Centre
          </h1>
          <p className="text-sm text-slate-500">Live observation · {data.vehicles.length} vehicles · {data.shipments.length} active shipments</p>
        </div>
        <div className="flex items-center gap-3">
          <FilterChips
            chips={[
              { id: "track_a",   label: "Track A",   active: source === "track_a",   onClick: () => setSource("track_a"),   testid: "source-track-a" },
              { id: "simulator", label: "Simulator", active: source === "simulator", onClick: () => setSource("simulator"), testid: "source-simulator" },
              { id: "all",       label: "All",       active: source === "all",       onClick: () => setSource("all"),       testid: "source-all" },
            ]}
          />
          <button
            onClick={() => fetchAll(true)}
            disabled={refreshing}
            data-testid="command-refresh"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT — active shipments + fleet status + compliance */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <Panel title="Active shipments" icon={Activity} count={data.shipments.length} testid="panel-active-shipments">
            {data.shipments.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-3">No active shipments.</p>
            ) : data.shipments.slice(0, 20).map((s) => (
              <Link
                to={`/fleet/dispatch`}
                key={s.id}
                data-testid={`stream-shipment-${s.id.slice(0,8)}`}
                className="block rounded-lg border border-slate-200 p-2 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusPill status={s.status} kind="vehicle" />
                  <span className="text-xs text-slate-500">{s.id.slice(0,8)}</span>
                </div>
                <div className="text-xs text-slate-700 mt-1">→ {s.to_role} {s.to_id?.slice(0, 6)} · {s.total_units || 0}u</div>
              </Link>
            ))}
          </Panel>

          <Panel title="Fleet status" icon={Truck} testid="panel-fleet-status">
            <StatusMini label="Drivers" by={o.drivers?.by_status} testid="fleet-drivers-mini" />
            <StatusMini label="Vehicles" by={o.vehicles?.by_status} testid="fleet-vehicles-mini" />
          </Panel>

          <Panel title="Compliance" icon={Sparkles} testid="panel-compliance-summary">
            {o.compliance ? (
              <div className="space-y-1.5 text-sm" data-testid="command-compliance">
                <Row label="Expired" value={o.compliance.expired || 0} tone="rose" />
                <Row label="Critical" value={o.compliance.critical || 0} tone="rose" />
                <Row label="Warning" value={o.compliance.warning || 0} tone="amber" />
                <Row label="Expiring 30d" value={o.compliance.expiring_30d || 0} tone="amber" />
                <Link to="/fleet/compliance" className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline" data-testid="open-compliance-link">
                  Open Compliance <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            ) : <p className="text-xs text-slate-400">No data.</p>}
          </Panel>
        </div>

        {/* CENTRE — vehicle position list (a map-substitute until B7 stretch) */}
        <div className="col-span-12 lg:col-span-6">
          <Panel
            title={`Vehicles (${source})`}
            icon={Truck}
            count={data.vehicles.length}
            testid="panel-vehicles-stream"
          >
            {data.vehicles.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-3">No vehicles in scope.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.vehicles.slice(0, 80).map((v) => (
                  <li
                    key={v.id}
                    onClick={() => setFocus(v.id)}
                    data-testid={`vehicle-stream-${(v.vehicle_code || v.code || v.id).slice(0,12)}`}
                    className={[
                      "cursor-pointer rounded-lg border p-2 transition-colors",
                      focus === v.id
                        ? "border-slate-900 bg-slate-50"
                        : "border-slate-200 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {v.vehicle_code || v.code || v.id.slice(0,8)}
                        </span>
                        <StatusPill status={v.status} kind="vehicle" />
                        {v.source && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                              v.source === "simulator" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {v.source}
                          </span>
                        )}
                      </div>
                      <SeverityBadge severity={v.compliance_severity} />
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {v.registration_number || "—"}
                      {v.last_lat != null && v.last_lng != null && (
                        <> · {v.last_lat.toFixed(3)}, {v.last_lng.toFixed(3)}</>
                      )}
                      {v.last_position_at && (
                        <> · {timeAgo(v.last_position_at)}</>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* RIGHT — alert centre + focused vehicle popover */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          {focusedVehicle && (
            <Panel title="Vehicle" icon={Truck} testid="panel-vehicle-focus">
              <div className="text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{focusedVehicle.vehicle_code || focusedVehicle.code}</span>
                  <Link
                    to={`/fleet/vehicles/${focusedVehicle.id}`}
                    data-testid="focused-vehicle-open"
                    className="text-xs text-indigo-700 hover:underline"
                  >
                    Open registry →
                  </Link>
                </div>
                <div className="text-xs text-slate-500">{focusedVehicle.registration_number}</div>
                <div className="pt-2 text-xs">
                  Status: <StatusPill status={focusedVehicle.status} kind="vehicle" />
                </div>
                {focusedVehicle.current_driver_id && (
                  <div className="text-xs">Driver: {focusedVehicle.current_driver_id.slice(0,8)}</div>
                )}
                {focusedVehicle.current_shipment_id && (
                  <div className="text-xs">Shipment: {focusedVehicle.current_shipment_id.slice(0,8)}</div>
                )}
                {focusedVehicle.compliance?.severity && (
                  <div className="text-xs">Compliance: <SeverityBadge severity={focusedVehicle.compliance.severity} /></div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Alerts" icon={Bell} count={data.notifications.length} testid="panel-alerts">
            {data.notifications.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-3">No new alerts.</p>
            ) : (
              <ul className="space-y-2">
                {data.notifications.slice(0, 15).map((n) => (
                  <li
                    key={n.id}
                    className="rounded-lg border border-slate-200 p-2.5"
                    data-testid={`alert-${n.id.slice(0,8)}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {n.severity && <SeverityBadge severity={n.severity} />}
                        <span className="text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                      </div>
                      <button
                        onClick={() => ackNotification(n.id)}
                        data-testid={`alert-ack-${n.id.slice(0,8)}`}
                        className="text-xs text-slate-500 hover:text-slate-900"
                      >Mark read</button>
                    </div>
                    <div className="text-sm font-medium text-slate-900 mt-1">{n.title || n.type}</div>
                    {(n.message || n.body) && (
                      <div className="text-xs text-slate-600 mt-0.5 line-clamp-3">{n.message || n.body}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, icon: Icon, count, children, testid }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white" data-testid={testid}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {Icon && <Icon className="h-4 w-4" />}{title}
        </div>
        {count != null && <span className="text-xs text-slate-500 tabular-nums">{count}</span>}
      </div>
      <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">{children}</div>
    </div>
  );
}

function StatusMini({ label, by, testid }) {
  const entries = Object.entries(by || {});
  if (!entries.length) return (
    <div className="text-xs text-slate-400" data-testid={testid}>{label}: no data</div>
  );
  return (
    <div data-testid={testid}>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {entries.map(([s, n]) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
          >
            <span className="capitalize">{s.replace(/_/g, " ")}</span>
            <span className="font-medium tabular-nums">{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, tone }) {
  const valueTone = tone === "rose"
    ? "text-rose-700"
    : tone === "amber" ? "text-amber-700" : "text-slate-700";
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={`font-medium tabular-nums ${valueTone}`}>{value}</span>
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  } catch { return "—"; }
}
