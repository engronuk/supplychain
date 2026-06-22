/**
 * Driver Roster — Phase 2 / B4
 *
 * `/fleet/drivers`        → list view
 * `/fleet/drivers/:id`    → detail drawer overlaid on the list
 *
 * Backed by:
 *   GET    /api/drivers
 *   GET    /api/drivers/workload
 *   POST   /api/drivers
 *   PATCH  /api/drivers/:id
 *   POST   /api/drivers/:id/deactivate / reactivate
 *   GET    /api/drivers/:id/assignment-history
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { UserPlus, Search, Filter, MoreVertical, Phone, Calendar, Activity } from "lucide-react";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, Tabs, SeverityBadge, StatusPill, FilterChips, KeyValue, ConfirmDialog } from "./_atoms";

const STATUS_FILTERS = ["all", "available", "assigned", "on_trip", "offline"];

function CreateDriverDrawer({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", email: "",
    licence_number: "", licence_class: "C",
    licence_expiry: "", employee_number: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const change = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const res = await api.post("/drivers", form);
      setResult(res.data);
      onCreated?.(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally { setSaving(false); }
  };

  if (result) {
    return (
      <Drawer
        open={open}
        onClose={() => { setResult(null); onClose(); }}
        title="Driver invited"
        subtitle={`${result.full_name || result.first_name} · ${result.employee_number}`}
        data-testid="driver-invite-success"
        footer={
          <button onClick={() => { setResult(null); onClose(); }} data-testid="invite-done" className="ml-auto inline-flex rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800">Done</button>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-emerald-700 font-medium">Driver record created. They&apos;ll claim their account via the link below.</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs break-all" data-testid="invite-link">
            {result.invite_url || `${window.location.origin}/claim?email=${encodeURIComponent(result.email || "")}`}
          </div>
          <KeyValue label="Employee #" value={result.employee_number} />
          <KeyValue label="Email" value={result.email} />
          <KeyValue label="Status" value={<StatusPill status={result.status} />} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Invite driver"
      subtitle="Creates the driver record and a parallel User account ready to claim."
      data-testid="driver-create-drawer"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-slate-200 px-4 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="driver-create-submit" className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? "Inviting…" : "Send invite"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="driver-create-error">{String(error)}</div>}
        {[
          ["first_name", "First name"],
          ["last_name", "Last name"],
          ["phone", "Phone"],
          ["email", "Email"],
          ["employee_number", "Employee # (auto if blank)"],
          ["licence_number", "Driver licence #"],
          ["licence_expiry", "Licence expiry (YYYY-MM-DD)"],
        ].map(([k, label]) => (
          <label key={k} className="block">
            <span className="text-xs font-medium text-slate-600">{label}</span>
            <input
              data-testid={`driver-field-${k}`}
              value={form[k]}
              onChange={change(k)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
        ))}
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Licence class</span>
          <select
            data-testid="driver-field-licence_class"
            value={form.licence_class}
            onChange={change("licence_class")}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {["A", "B", "C", "D", "E", "F"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
    </Drawer>
  );
}

function DriverDetailDrawer({ driverId, onClose, onMutate }) {
  const [driver, setDriver] = useState(null);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (!driverId) return;
    setLoading(true);
    (async () => {
      try {
        const [d, h] = await Promise.all([
          api.get(`/drivers/${driverId}`),
          api.get(`/drivers/${driverId}/assignment-history?limit=50`),
        ]);
        setDriver(d.data);
        setHistory(h.data || []);
      } finally { setLoading(false); }
    })();
  }, [driverId]);

  const deactivate = async () => {
    await api.post(`/drivers/${driverId}/deactivate`, { reason: "Dispatcher action" });
    const fresh = await api.get(`/drivers/${driverId}`);
    setDriver(fresh.data);
    setConfirm(null);
    onMutate?.();
  };
  const reactivate = async () => {
    await api.post(`/drivers/${driverId}/reactivate`);
    const fresh = await api.get(`/drivers/${driverId}`);
    setDriver(fresh.data);
    onMutate?.();
  };

  return (
    <Drawer
      open={!!driverId}
      onClose={onClose}
      title={loading ? "Loading…" : driver?.full_name}
      subtitle={driver?.employee_number}
      data-testid="driver-detail-drawer"
      footer={
        driver && (
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Joined {driver.invited_at ? new Date(driver.invited_at).toLocaleDateString() : "—"}
            </div>
            <div className="flex gap-2">
              {driver.is_active ? (
                <button
                  onClick={() => setConfirm("deactivate")}
                  data-testid="driver-deactivate"
                  className="rounded-full border border-rose-200 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50"
                >Deactivate</button>
              ) : (
                <button
                  onClick={reactivate}
                  data-testid="driver-reactivate"
                  className="rounded-full bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700"
                >Reactivate</button>
              )}
            </div>
          </div>
        )
      }
    >
      {loading ? <Skeleton className="h-40 w-full" /> : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Overview" },
              { value: "assignments", label: "Assignments" },
              { value: "performance", label: "Performance" },
              { value: "compliance", label: "Compliance" },
            ]}
          />
          {tab === "overview" && (
            <div data-testid="tab-overview-content">
              <KeyValue label="Status" value={<StatusPill status={driver?.status} />} />
              <KeyValue label="Phone" value={driver?.phone} />
              <KeyValue label="Email" value={driver?.email} />
              <KeyValue label="Employer" value={driver?.employer_org_id?.slice(0, 8)} />
              <KeyValue label="Home warehouse" value={driver?.home_warehouse_id?.slice(0, 8) || "—"} />
              <KeyValue label="Licence #" value={driver?.licence_number} />
              <KeyValue label="Licence class" value={driver?.licence_class} />
              <KeyValue label="Licence expiry" value={driver?.licence_expiry} />
              <KeyValue label="Last login" value={driver?.last_login_at?.slice(0, 16).replace("T", " ")} />
              <KeyValue label="Last seen" value={driver?.last_seen_at?.slice(0, 16).replace("T", " ")} />
              <KeyValue label="Active shipment" value={driver?.assigned_shipment_id?.slice(0, 8) || "—"} />
              <KeyValue label="Active vehicle" value={driver?.assigned_vehicle_id?.slice(0, 8) || "—"} />
            </div>
          )}
          {tab === "assignments" && (
            <div data-testid="tab-assignments-content">
              {history.length === 0
                ? <p className="text-sm text-slate-400">No assignments yet.</p>
                : (
                  <ul className="divide-y divide-slate-100">
                    {history.map((e, i) => (
                      <li key={i} className="py-2.5 text-sm" data-testid={`history-row-${i}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium capitalize">{e.event_type?.replace(/_/g, " ") || e.to_status}</span>
                          <span className="text-xs text-slate-500">{e.at?.slice(0, 16).replace("T", " ")}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {e.from_status} → {e.to_status} · ship {e.shipment_id?.slice(0, 8)}
                          {e.vehicle_id && ` · veh ${e.vehicle_id.slice(0, 8)}`}
                        </div>
                        {e.notes && <div className="text-xs text-slate-600 mt-0.5 italic">&ldquo;{e.notes}&rdquo;</div>}
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          )}
          {tab === "performance" && (
            <div data-testid="tab-performance-content" className="grid grid-cols-2 gap-3">
              {[
                ["Deliveries (30d)", driver?.deliveries_30d ?? 0],
                ["On-time % (30d)", driver?.on_time_pct_30d == null ? "—" : `${driver.on_time_pct_30d}%`],
                ["Avg PoD time (min)", driver?.avg_pod_time_min ?? "—"],
                ["Failed deliveries (30d)", driver?.failed_delivery_count ?? 0],
                ["Active trips", driver?.active_trip_count ?? 0],
              ].map(([label, val]) => (
                <div key={label} className="rounded-xl border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">{label}</div>
                  <div className="text-xl font-semibold text-slate-900 tabular-nums">{val}</div>
                </div>
              ))}
              <div className="col-span-2 text-xs text-slate-500">
                KPIs refreshed {driver?.kpis_updated_at?.slice(0, 16).replace("T", " ") || "never"}
              </div>
            </div>
          )}
          {tab === "compliance" && (
            <div data-testid="tab-compliance-content">
              {driver?.compliance ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={driver.compliance.severity} />
                    <span className="text-sm text-slate-500">Evaluated {driver.compliance.evaluated_at?.slice(0, 10)}</span>
                  </div>
                  {(driver.compliance.checks || []).map((c, i) => (
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
        open={confirm === "deactivate"}
        onClose={() => setConfirm(null)}
        onConfirm={deactivate}
        title="Deactivate driver?"
        message="The driver will not be able to log in and will be hidden from the active roster."
        confirmLabel="Deactivate"
        danger
      />
    </Drawer>
  );
}

export default function DriverRoster() {
  const { driverId } = useParams();
  const nav = useNavigate();
  const [drivers, setDrivers] = useState([]);
  const [workload, setWorkload] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [d, w] = await Promise.all([
        api.get("/drivers"),
        api.get("/drivers/workload"),
      ]);
      setDrivers(d.data || []);
      const idx = {};
      (w.data || []).forEach((r) => { idx[r.driver_id] = r; });
      setWorkload(idx);
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return drivers.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!term) return true;
      return [d.full_name, d.employee_number, d.phone, d.email]
        .filter(Boolean).some((v) => v.toLowerCase().includes(term));
    });
  }, [drivers, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const m = { all: drivers.length };
    drivers.forEach((d) => { m[d.status] = (m[d.status] || 0) + 1; });
    return m;
  }, [drivers]);

  return (
    <div className="space-y-5" data-testid="driver-roster">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Drivers</h1>
          <p className="text-sm text-slate-500">{drivers.length} drivers · scoped to your fleet</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          data-testid="driver-invite-btn"
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          <UserPlus className="h-4 w-4" /> Invite driver
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            data-testid="driver-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, employee #, phone, email…"
            className="rounded-full border border-slate-200 bg-white pl-9 pr-4 py-1.5 text-sm w-80 focus:border-slate-400 focus:outline-none"
          />
        </div>
        <FilterChips
          chips={STATUS_FILTERS.map((s) => ({
            id: s,
            label: s.replace(/_/g, " "),
            count: statusCounts[s],
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
                <th className="px-4 py-3">Driver</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Delivered (30d)</th>
                <th className="px-4 py-3">On-time</th>
                <th className="px-4 py-3">Compliance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">No drivers match your filters.</td></tr>
              )}
              {filtered.map((d) => {
                const w = workload[d.id] || {};
                return (
                  <tr
                    key={d.id}
                    onClick={() => nav(`/fleet/drivers/${d.id}`)}
                    data-testid={`driver-row-${d.employee_number}`}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{d.full_name}</div>
                      <div className="text-xs text-slate-500">{d.employee_number}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{d.phone || "—"}</td>
                    <td className="px-4 py-3"><StatusPill status={d.status} /></td>
                    <td className="px-4 py-3 tabular-nums">{w.active_shipments ?? 0}</td>
                    <td className="px-4 py-3 tabular-nums">{d.deliveries_30d ?? w.deliveries_30d ?? 0}</td>
                    <td className="px-4 py-3 tabular-nums">{d.on_time_pct_30d != null ? `${d.on_time_pct_30d}%` : (w.on_time_pct_7d != null ? `${w.on_time_pct_7d}%*` : "—")}</td>
                    <td className="px-4 py-3"><SeverityBadge severity={d.compliance_severity} /></td>
                    <td className="px-4 py-3 text-slate-400"><MoreVertical className="h-4 w-4" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateDriverDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => fetchAll()}
      />
      <DriverDetailDrawer
        driverId={driverId}
        onClose={() => nav("/fleet/drivers")}
        onMutate={fetchAll}
      />
    </div>
  );
}
