/**
 * Dispatch Console — Phase 4 / B6
 *
 * Three-pane operator workspace:
 *   left   = unassigned queue + available drivers + available vehicles
 *   centre = active trips (with reassign + cancel actions)
 *   right  = assignment form (driver + vehicle picker)
 *
 * Backed by:
 *   GET    /api/shipments                  (queue + active)
 *   GET    /api/drivers?status=available
 *   GET    /api/vehicles?status=available
 *   POST   /api/shipments/:id/assign
 *   POST   /api/shipments/:id/reassign-driver
 *   POST   /api/shipments/:id/reassign-vehicle
 *   POST   /api/shipments/:id/cancel       (optional)
 */
import { useEffect, useMemo, useState } from "react";
import { Truck, Users, Package, RefreshCw, AlertCircle, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, SeverityBadge, StatusPill } from "./_atoms";

const STATUSES_OPEN = ["assigned", "loaded", "in_transit", "arrived"];

function ReassignDrawer({ open, mode, shipment, options, onClose, onSubmit }) {
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setPick(""); setReason(""); setError(null); }, [open, mode]);

  const submit = async () => {
    if (!pick) { setError("Pick a replacement"); return; }
    if (reason.trim().length < 10) { setError("Reason must be at least 10 characters."); return; }
    setSaving(true); setError(null);
    try { await onSubmit(pick, reason); }
    catch (e) { setError(e?.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={mode === "driver" ? "Reassign driver" : mode === "vehicle" ? "Reassign vehicle" : "Reassign"}
      subtitle={shipment ? `Shipment ${shipment.id?.slice(0,8)} · status ${shipment.status}` : undefined}
      data-testid="reassign-drawer"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-slate-200 px-4 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="reassign-submit" className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? "Saving…" : "Reassign"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="reassign-error">{String(error)}</div>}
        <label className="block">
          <span className="text-xs font-medium text-slate-600">{mode === "driver" ? "New driver" : "New vehicle"}</span>
          <select
            data-testid="reassign-picker"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {mode === "driver"
                  ? `${o.full_name} (${o.employee_number})`
                  : `${o.vehicle_code} · ${o.registration_number} · ${o.capacity_units}u`}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Reason (≥10 chars, audited)</span>
          <textarea
            data-testid="reassign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y"
          />
        </label>
      </div>
    </Drawer>
  );
}

export default function DispatchConsole() {
  const [data, setData] = useState({
    queue: [], active: [], drivers: [], vehicles: [],
  });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // shipment_id from queue
  const [form, setForm] = useState({ driver: "", vehicle: "" });
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [reassign, setReassign] = useState(null); // {mode, shipment}

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [queue, active, drivers, vehicles] = await Promise.all([
        api.get("/shipments?status=ready_for_dispatch"),
        api.get("/shipments?status=assigned"),
        api.get("/drivers?status=available"),
        api.get("/vehicles?status=available"),
      ]);
      // Active trips spans 4 statuses; merge results
      const [loadedR, transitR, arrivedR] = await Promise.all([
        api.get("/shipments?status=loaded"),
        api.get("/shipments?status=in_transit"),
        api.get("/shipments?status=arrived"),
      ]);
      setData({
        queue: queue.data || [],
        active: [
          ...(active.data || []), ...(loadedR.data || []),
          ...(transitR.data || []), ...(arrivedR.data || []),
        ],
        drivers: drivers.data || [],
        vehicles: vehicles.data || [],
      });
    } finally { setLoading(false); }
  };
  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 30000);
    return () => clearInterval(id);
  }, []);

  const selectedShipment = useMemo(
    () => data.queue.find((s) => s.id === selected) || null,
    [selected, data.queue],
  );

  const eligibleVehicles = useMemo(() => {
    if (!selectedShipment) return data.vehicles;
    const units = selectedShipment.total_units || 0;
    return data.vehicles.filter((v) => (v.capacity_units || 0) >= units);
  }, [selectedShipment, data.vehicles]);

  const assign = async () => {
    if (!selected || !form.driver || !form.vehicle) return;
    setAssigning(true); setError(null);
    try {
      await api.post(`/shipments/${selected}/assign`, {
        driver_id: form.driver, vehicle_id: form.vehicle,
      });
      setToast({ tone: "ok", message: "Shipment dispatched ✓" });
      setSelected(null); setForm({ driver: "", vehicle: "" });
      fetchAll();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
      if (e?.response?.status === 409) fetchAll();
    } finally { setAssigning(false); }
  };

  const doReassign = async (newId, reason) => {
    const mode = reassign.mode;
    const sid = reassign.shipment.id;
    const path = mode === "driver" ? "reassign-driver" : "reassign-vehicle";
    const body = mode === "driver" ? { driver_id: newId, reason } : { vehicle_id: newId, reason };
    await api.post(`/shipments/${sid}/${path}`, body);
    setReassign(null);
    setToast({ tone: "ok", message: `${mode === "driver" ? "Driver" : "Vehicle"} reassigned ✓` });
    fetchAll();
  };

  if (loading) {
    return (
      <div className="grid grid-cols-12 gap-4" data-testid="dispatch-loading">
        <Skeleton className="col-span-3 h-96 rounded-2xl" />
        <Skeleton className="col-span-6 h-96 rounded-2xl" />
        <Skeleton className="col-span-3 h-96 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="dispatch-console">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dispatch Console</h1>
          <p className="text-sm text-slate-500">{data.queue.length} awaiting · {data.active.length} active trips</p>
        </div>
        <button
          onClick={fetchAll}
          data-testid="dispatch-refresh"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {toast && (
        <div className={`rounded-xl border px-4 py-2 text-sm ${toast.tone === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"}`} data-testid="dispatch-toast">
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* LEFT — unassigned queue + driver/vehicle panels */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          <Panel title="Unassigned" icon={Package} count={data.queue.length} testid="panel-queue">
            {data.queue.length === 0 ? (
              <Empty label="No shipments awaiting dispatch" />
            ) : data.queue.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                data-testid={`queue-card-${s.id.slice(0,8)}`}
                className={[
                  "w-full text-left rounded-lg border p-2.5 transition-colors",
                  selected === s.id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50",
                ].join(" ")}
              >
                <div className="text-sm font-medium text-slate-900">→ {s.to_role} {s.to_id?.slice(0, 6)}</div>
                <div className="text-xs text-slate-500">{s.total_units || 0} units · ₦{(s.total_value || 0).toLocaleString()}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.id.slice(0,8)} · {s.created_at?.slice(0,10)}</div>
              </button>
            ))}
          </Panel>

          <Panel title="Drivers available" icon={Users} count={data.drivers.length} testid="panel-drivers">
            {data.drivers.length === 0
              ? <Empty label="No drivers available" />
              : data.drivers.map((d) => (
                <div key={d.id} className="rounded-lg border border-slate-200 p-2 text-sm" data-testid={`driver-chip-${d.employee_number}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{d.full_name}</span>
                    <StatusPill status={d.status} />
                  </div>
                  <div className="text-xs text-slate-500">{d.employee_number}</div>
                </div>
              ))}
          </Panel>

          <Panel title="Vehicles available" icon={Truck} count={data.vehicles.length} testid="panel-vehicles">
            {data.vehicles.length === 0
              ? <Empty label="No vehicles available" />
              : data.vehicles.map((v) => (
                <div key={v.id} className="rounded-lg border border-slate-200 p-2 text-sm" data-testid={`vehicle-chip-${v.vehicle_code}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{v.vehicle_code}</span>
                    <StatusPill status={v.status} kind="vehicle" />
                  </div>
                  <div className="text-xs text-slate-500">{v.registration_number} · {v.capacity_units || 0}u</div>
                </div>
              ))}
          </Panel>
        </div>

        {/* CENTRE — active trips */}
        <div className="col-span-12 lg:col-span-6">
          <Panel title="Active trips" icon={Truck} count={data.active.length} testid="panel-active">
            {data.active.length === 0 ? (
              <Empty label="No active trips" />
            ) : (
              <ul className="space-y-2">
                {data.active.map((s) => (
                  <li key={s.id} className="rounded-lg border border-slate-200 p-3" data-testid={`active-row-${s.id.slice(0,8)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusPill status={s.status} kind="vehicle" />
                        <span className="text-sm font-medium text-slate-900">→ {s.to_role} {s.to_id?.slice(0,6)}</span>
                        <span className="text-xs text-slate-400">{s.id.slice(0,8)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setReassign({ mode: "driver", shipment: s })}
                          data-testid={`reassign-driver-${s.id.slice(0,8)}`}
                          className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                        >Reassign driver</button>
                        <button
                          onClick={() => setReassign({ mode: "vehicle", shipment: s })}
                          data-testid={`reassign-vehicle-${s.id.slice(0,8)}`}
                          className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                        >Reassign vehicle</button>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Driver {s.driver_id?.slice(0,8) || "—"} · Vehicle {s.vehicle_id?.slice(0,8) || "—"} · {s.total_units || 0} units
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* RIGHT — assignment form */}
        <div className="col-span-12 lg:col-span-3">
          <Panel title="Assign" icon={ChevronRight} testid="panel-form">
            {!selectedShipment ? (
              <Empty label="Select a shipment from the Unassigned queue to begin." />
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="font-medium text-slate-900">{selectedShipment.id.slice(0,8)}</div>
                  <div className="text-xs text-slate-500">{selectedShipment.total_units} units · ₦{(selectedShipment.total_value || 0).toLocaleString()}</div>
                </div>
                {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="assign-error">{String(error)}</div>}
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Driver</span>
                  <select
                    data-testid="assign-driver-picker"
                    value={form.driver}
                    onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">— Select —</option>
                    {data.drivers.map((d) => (
                      <option key={d.id} value={d.id}>{d.full_name} · {d.employee_number}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">
                    Vehicle <span className="text-slate-400">({eligibleVehicles.length} fit)</span>
                  </span>
                  <select
                    data-testid="assign-vehicle-picker"
                    value={form.vehicle}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">— Select —</option>
                    {eligibleVehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.vehicle_code} · {v.capacity_units}u</option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={assign}
                  disabled={!form.driver || !form.vehicle || assigning}
                  data-testid="assign-submit"
                  className="w-full rounded-full bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {assigning ? "Dispatching…" : "Assign & dispatch"}
                </button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <ReassignDrawer
        open={!!reassign}
        mode={reassign?.mode}
        shipment={reassign?.shipment}
        options={reassign?.mode === "driver" ? data.drivers : eligibleVehicles}
        onClose={() => setReassign(null)}
        onSubmit={doReassign}
      />
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

function Empty({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-400 px-2 py-4">
      <AlertCircle className="h-4 w-4" /> {label}
    </div>
  );
}
