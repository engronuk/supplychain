/**
 * Vehicle Registry — Phase 3 / B5
 *
 * `/fleet/vehicles`     → list view
 * `/fleet/vehicles/:id` → detail drawer
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TruckIcon, Search, Plus } from "lucide-react";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, Tabs, SeverityBadge, StatusPill, FilterChips, KeyValue, ConfirmDialog } from "./_atoms";

const STATUS_FILTERS = ["all", "available", "loading", "in_transit", "maintenance", "offline"];

function CreateVehicleDrawer({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    registration_number: "", vehicle_type: "truck",
    make: "", model: "", year: 2024, colour: "",
    capacity_units: 1000, capacity_weight_kg: 10000,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const change = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const payload = {
        ...form,
        year: Number(form.year),
        capacity_units: Number(form.capacity_units),
        capacity_weight_kg: Number(form.capacity_weight_kg),
      };
      const res = await api.post("/vehicles", payload);
      onCreated?.(res.data);
      onClose();
    } catch (e) { setError(e?.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add vehicle"
      subtitle="Adds a truck/van/trailer to your fleet registry."
      data-testid="vehicle-create-drawer"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-slate-200 px-4 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="vehicle-create-submit" className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? "Saving…" : "Add vehicle"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="vehicle-create-error">{String(error)}</div>}
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Registration number</span>
          <input data-testid="vehicle-field-registration_number" value={form.registration_number} onChange={change("registration_number")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Vehicle type</span>
          <select data-testid="vehicle-field-vehicle_type" value={form.vehicle_type} onChange={change("vehicle_type")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {["truck","van","pickup","trailer","motorcycle"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs font-medium text-slate-600">Make</span>
            <input data-testid="vehicle-field-make" value={form.make} onChange={change("make")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Model</span>
            <input data-testid="vehicle-field-model" value={form.model} onChange={change("model")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Year</span>
            <input type="number" data-testid="vehicle-field-year" value={form.year} onChange={change("year")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Colour</span>
            <input data-testid="vehicle-field-colour" value={form.colour} onChange={change("colour")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Capacity (units)</span>
            <input type="number" data-testid="vehicle-field-capacity_units" value={form.capacity_units} onChange={change("capacity_units")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
          <label className="block"><span className="text-xs font-medium text-slate-600">Capacity (kg)</span>
            <input type="number" data-testid="vehicle-field-capacity_weight_kg" value={form.capacity_weight_kg} onChange={change("capacity_weight_kg")} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </label>
        </div>
      </div>
    </Drawer>
  );
}

function VehicleDetailDrawer({ vehicleId, onClose, onMutate }) {
  const [veh, setVeh] = useState(null);
  const [history, setHistory] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (!vehicleId) return;
    setLoading(true);
    (async () => {
      try {
        const [v, h, d] = await Promise.all([
          api.get(`/vehicles/${vehicleId}`),
          api.get(`/vehicles/${vehicleId}/assignment-history?limit=50`),
          api.get("/drivers?status=available"),
        ]);
        setVeh(v.data);
        setHistory(h.data || []);
        setDrivers(d.data || []);
      } finally { setLoading(false); }
    })();
  }, [vehicleId]);

  const lifecycle = async (action) => {
    const map = {
      "set-maintenance": "/set-maintenance",
      "complete-service": "/complete-service",
      "set-offline": "/set-offline",
      "set-online": "/set-online",
      "decommission": "/decommission",
    };
    await api.post(`/vehicles/${vehicleId}${map[action]}`);
    const fresh = await api.get(`/vehicles/${vehicleId}`);
    setVeh(fresh.data);
    setConfirm(null);
    onMutate?.();
  };
  const pair = async (driverId) => {
    if (!driverId) { await api.post(`/vehicles/${vehicleId}/clear-default-driver`); }
    else { await api.post(`/vehicles/${vehicleId}/assign-default-driver`, { driver_id: driverId }); }
    const fresh = await api.get(`/vehicles/${vehicleId}`);
    setVeh(fresh.data);
    onMutate?.();
  };

  return (
    <Drawer
      open={!!vehicleId}
      onClose={onClose}
      title={loading ? "Loading…" : veh?.vehicle_code}
      subtitle={veh && `${veh.registration_number} · ${veh.make || ""} ${veh.model || ""}`}
      data-testid="vehicle-detail-drawer"
      footer={veh && (
        <div className="flex items-center justify-end gap-2">
          {veh.status === "available" && (
            <button onClick={() => lifecycle("set-maintenance")} data-testid="vehicle-set-maintenance" className="rounded-full border border-amber-200 px-3 py-1 text-sm text-amber-700 hover:bg-amber-50">Set maintenance</button>
          )}
          {veh.status === "maintenance" && (
            <button onClick={() => lifecycle("complete-service")} data-testid="vehicle-complete-service" className="rounded-full border border-emerald-200 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50">Complete service</button>
          )}
          {veh.status === "offline" ? (
            <button onClick={() => lifecycle("set-online")} data-testid="vehicle-set-online" className="rounded-full border border-emerald-200 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50">Set online</button>
          ) : (
            <button onClick={() => lifecycle("set-offline")} data-testid="vehicle-set-offline" className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-50">Set offline</button>
          )}
          {veh.is_active && (
            <button onClick={() => setConfirm("decommission")} data-testid="vehicle-decommission" className="rounded-full border border-rose-200 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50">Decommission</button>
          )}
        </div>
      )}
    >
      {loading ? <Skeleton className="h-40 w-full" /> : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "assignments", label: "Assignments" },
              { value: "utilization", label: "Utilization" },
              { value: "compliance", label: "Compliance" },
            ]}
          />
          {tab === "overview" && (
            <div data-testid="tab-overview-content">
              <KeyValue label="Status" value={<StatusPill status={veh?.status} kind="vehicle" />} />
              <KeyValue label="Type" value={veh?.vehicle_type} />
              <KeyValue label="Make / Model" value={`${veh?.make || ""} ${veh?.model || ""}`} />
              <KeyValue label="Year" value={veh?.year} />
              <KeyValue label="Capacity" value={`${veh?.capacity_units || "—"} units · ${veh?.capacity_weight_kg || "—"} kg`} />
              <KeyValue label="Odometer" value={veh?.odometer_km != null ? `${veh.odometer_km} km` : "—"} />
              <KeyValue label="Last position" value={veh?.last_position_at?.slice(0, 16).replace("T", " ") || "—"} />
              <KeyValue label="Active driver" value={veh?.current_driver_id?.slice(0, 8) || "—"} />
              <KeyValue label="Active shipment" value={veh?.current_shipment_id?.slice(0, 8) || "—"} />
              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-medium text-slate-600 mb-1">Default driver pairing</div>
                <div className="flex items-center gap-2">
                  <select
                    data-testid="vehicle-default-driver-picker"
                    value={veh?.assigned_driver_id || ""}
                    onChange={(e) => pair(e.target.value || null)}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">— No default driver —</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name} ({d.employee_number})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
          {tab === "assignments" && (
            <div data-testid="tab-assignments-content">
              {history.length === 0 ? (
                <p className="text-sm text-slate-400">No assignments yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {history.map((e, i) => (
                    <li key={i} className="py-2.5 text-sm" data-testid={`history-row-${i}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">{e.event_type?.replace(/_/g, " ") || e.to_status}</span>
                        <span className="text-xs text-slate-500">{e.at?.slice(0, 16).replace("T", " ")}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {e.from_status} → {e.to_status} · ship {e.shipment_id?.slice(0, 8)}
                        {e.driver_id && ` · drv ${e.driver_id.slice(0, 8)}`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {tab === "utilization" && (
            <div data-testid="tab-utilization-content" className="grid grid-cols-2 gap-3">
              {[
                ["Trips (30d)", veh?.trips_30d ?? 0],
                ["Utilization %", veh?.utilization_pct != null ? `${veh.utilization_pct}%` : "—"],
                ["Idle %", veh?.idle_pct != null ? `${veh.idle_pct}%` : "—"],
                ["Distance (30d)", veh?.distance_km_30d != null ? `${veh.distance_km_30d} km` : "—"],
                ["On-time delivery %", veh?.on_time_delivery_pct != null ? `${veh.on_time_delivery_pct}%` : "—"],
              ].map(([label, val]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">{label}</div>
                  <div className="text-xl font-semibold text-slate-900 tabular-nums">{val}</div>
                </div>
              ))}
              <div className="col-span-2 text-xs text-slate-500">
                KPIs refreshed {veh?.kpis_updated_at?.slice(0, 16).replace("T", " ") || "never"}
              </div>
            </div>
          )}
          {tab === "compliance" && (
            <div data-testid="tab-compliance-content">
              {veh?.compliance ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={veh.compliance.severity} />
                    <span className="text-sm text-slate-500">Evaluated {veh.compliance.evaluated_at?.slice(0, 10)}</span>
                  </div>
                  {(veh.compliance.checks || []).map((c, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm" data-testid={`compliance-check-${c.kind}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">{c.kind.replace(/_/g, " ")}</span>
                        <SeverityBadge severity={c.severity} />
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Expires {c.expires_at || "—"} · {c.days_remaining == null ? "n/a" : `${c.days_remaining} days remaining`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400">Compliance has not been evaluated yet.</p>}
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirm === "decommission"}
        onClose={() => setConfirm(null)}
        onConfirm={() => lifecycle("decommission")}
        title="Decommission vehicle?"
        message="The vehicle will be permanently retired from the fleet. This cannot be undone."
        confirmLabel="Decommission"
        danger
      />
    </Drawer>
  );
}

export default function VehicleRegistry() {
  const { vehicleId } = useParams();
  const nav = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [util, setUtil] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [v, u] = await Promise.all([
        api.get("/vehicles"),
        api.get("/vehicles/utilization"),
      ]);
      setVehicles(v.data || []);
      const idx = {};
      (u.data || []).forEach((r) => { idx[r.vehicle_id] = r; });
      setUtil(idx);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (!term) return true;
      return [v.vehicle_code, v.registration_number, v.make, v.model]
        .filter(Boolean).some((x) => x.toLowerCase().includes(term));
    });
  }, [vehicles, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const m = { all: vehicles.length };
    vehicles.forEach((v) => { m[v.status] = (m[v.status] || 0) + 1; });
    return m;
  }, [vehicles]);

  return (
    <div className="space-y-5" data-testid="vehicle-registry">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Vehicles</h1>
          <p className="text-sm text-slate-500">{vehicles.length} vehicles · scoped to your fleet</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          data-testid="vehicle-add-btn"
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" /> Add vehicle
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            data-testid="vehicle-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, plate, make, model…"
            className="rounded-full border border-slate-200 bg-white pl-9 pr-4 py-1.5 text-sm w-80 focus:border-slate-400 focus:outline-none"
          />
        </div>
        <FilterChips
          chips={STATUS_FILTERS.map((s) => ({
            id: s, label: s.replace(/_/g, " "), count: statusCounts[s],
            active: statusFilter === s,
            onClick: () => setStatusFilter(s),
            testid: `filter-${s}`,
          }))}
        />
      </div>

      {loading ? (
        <Skeleton className="h-80 w-full rounded-2xl" />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Capacity</th>
                <th className="px-4 py-3">Trips (30d)</th>
                <th className="px-4 py-3">Utilization</th>
                <th className="px-4 py-3">Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">No vehicles match your filters.</td></tr>
              )}
              {filtered.map((v) => {
                const u = util[v.id] || {};
                return (
                  <tr
                    key={v.id}
                    onClick={() => nav(`/fleet/vehicles/${v.id}`)}
                    data-testid={`vehicle-row-${v.vehicle_code}`}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{v.vehicle_code}</div>
                      <div className="text-xs text-slate-500">{v.registration_number} · {v.make} {v.model}</div>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-700">{v.vehicle_type}</td>
                    <td className="px-4 py-3"><StatusPill status={v.status} kind="vehicle" /></td>
                    <td className="px-4 py-3 text-slate-700 tabular-nums">{v.capacity_units ?? "—"} u</td>
                    <td className="px-4 py-3 tabular-nums">{v.trips_30d ?? u.trips ?? 0}</td>
                    <td className="px-4 py-3 tabular-nums">{v.utilization_pct != null ? `${v.utilization_pct}%` : "—"}</td>
                    <td className="px-4 py-3"><SeverityBadge severity={v.compliance_severity} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateVehicleDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => fetchAll()}
      />
      <VehicleDetailDrawer
        vehicleId={vehicleId}
        onClose={() => nav("/fleet/vehicles")}
        onMutate={fetchAll}
      />
    </div>
  );
}
