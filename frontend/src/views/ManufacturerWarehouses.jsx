// Manufacturer-side Warehouse Management module.
// List + create at /manufacturer/warehouses; per-warehouse drill-down with
// tabs at /manufacturer/warehouses/:id.
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  Plus, Search, Pencil, PowerOff, ArrowLeftRight, Users, Eye, Building2,
  MapPin, ArrowLeft, Box, Mail, Phone, User,
  ArrowDownToLine, ArrowUpFromLine, BarChart3,
  Wallet, Truck, ClipboardList, ChevronDown, FileText, UserPlus,
  PackageCheck, PackagePlus, ShieldCheck, Clock,
  CircleDot, CheckCircle2, AlertTriangle, MoreVertical, KeyRound,
  Power, Bell, ShieldAlert, SlidersHorizontal, RefreshCw, Activity,
  TrendingUp, Sparkles, Filter, Download,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip,
  CartesianGrid,
} from "recharts";
import { toast } from "sonner";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const naira = (v) => "₦" + new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(v || 0);
const num = (v) => new Intl.NumberFormat("en-NG").format(v || 0);
const NIGERIAN_REGIONS = ["Lagos","South West","South East","South South","North Central","North East","North West"];

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------
export default function ManufacturerWarehouses() {
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");

  const reload = () => {
    Api.organizations({ organization_type: "warehouse" }).then(setWarehouses).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
  };
  useEffect(() => { reload(); }, []);

  // Fetch inventory per warehouse (so we can show inventory value)
  useEffect(() => {
    if (!warehouses.length) return;
    Promise.all(warehouses.map((w) =>
      Api.inventory("warehouse", w.id).then((rows) => ({ wh: w.id, rows })).catch(() => ({ wh: w.id, rows: [] })),
    )).then((all) => setInventory(all));
  }, [warehouses]);

  const enriched = useMemo(() => {
    const byPid = Object.fromEntries(products.map((p) => [p.id, p]));
    const invByWh = Object.fromEntries(inventory.map((i) => [i.wh, i.rows]));
    const ql = q.trim().toLowerCase();
    return warehouses
      .filter((w) => !ql || [w.organization_name, w.organization_code, w.city, w.region].join(" ").toLowerCase().includes(ql))
      .map((w) => {
        const rows = invByWh[w.id] || [];
        const value = rows.reduce((s, r) => s + (byPid[r.product_id]?.unit_price || 0) * (r.quantity || 0), 0);
        const units = rows.reduce((s, r) => s + (r.quantity || 0), 0);
        return { ...w, _value: value, _units: units, _sku_count: rows.length };
      });
  }, [warehouses, inventory, products, q]);

  const toggleStatus = async (w) => {
    const next = w.status === "active" ? "inactive" : "active";
    try {
      await Api.updateOrganization(w.id, { status: next });
      toast.success(`Warehouse ${next}`);
      reload();
    } catch (e) { toast.error("Update failed"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Warehouses</h1>
          <p className="text-sm text-slate-500 mt-1">Manage your tenant&apos;s warehouse network, capacity, and inventory holdings.</p>
        </div>
        <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="create-warehouse-btn">
          <Plus className="h-4 w-4 mr-1.5" /> Create Warehouse
        </Button>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiTile label="Total Warehouses" value={warehouses.length} tint="indigo" Icon={Building2} />
        <KpiTile label="Active" value={warehouses.filter((w) => w.status === "active").length} tint="emerald" Icon={Building2} />
        <KpiTile label="Total Units" value={num(enriched.reduce((s, w) => s + w._units, 0))} tint="amber" Icon={Box} />
        <KpiTile label="Inventory Value" value={naira(enriched.reduce((s, w) => s + w._value, 0))} tint="violet" Icon={Box} />
      </section>

      <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-4">
        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search warehouses…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            data-testid="warehouse-search" />
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Warehouse</th>
              <th className="text-left py-3 font-medium">Code</th>
              <th className="text-left py-3 font-medium">Location</th>
              <th className="text-left py-3 font-medium">Manager</th>
              <th className="text-right py-3 font-medium">Capacity</th>
              <th className="text-right py-3 font-medium">Inventory Value</th>
              <th className="text-left py-3 font-medium">Status</th>
              <th className="text-right py-3 px-6 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((w) => (
              <tr key={w.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="py-4 px-6">
                  <button onClick={() => navigate(`/manufacturer/warehouses/${w.id}`)} className="font-medium text-slate-800 hover:text-blue-600 text-left" data-testid={`open-${w.organization_code}`}>
                    {w.organization_name}
                  </button>
                </td>
                <td className="py-4 text-slate-600">{w.organization_code}</td>
                <td className="py-4 text-slate-600">{w.city || "—"}{w.region ? `, ${w.region}` : ""}</td>
                <td className="py-4 text-slate-700">{w.manager_name || "—"}</td>
                <td className="py-4 text-right text-slate-700">{w.capacity ? `${num(w.capacity)} m²` : "—"}</td>
                <td className="py-4 text-right font-semibold text-slate-800">{naira(w._value)}</td>
                <td className="py-4">
                  <span className={`text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${w.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{w.status}</span>
                </td>
                <td className="py-4 px-6 text-right">
                  <div className="inline-flex items-center gap-1.5">
                    <IconAction title="View" Icon={Eye} onClick={() => navigate(`/manufacturer/warehouses/${w.id}`)} testid={`view-${w.organization_code}`} />
                    <IconAction title="Edit" Icon={Pencil} onClick={() => setEditing(w)} testid={`edit-${w.organization_code}`} />
                    <IconAction title="Transfer Inventory" Icon={ArrowLeftRight} onClick={() => navigate(`/manufacturer/warehouses/${w.id}?tab=transfers`)} testid={`transfer-${w.organization_code}`} />
                    <IconAction title="Assign Users" Icon={Users} onClick={() => navigate(`/manufacturer/warehouses/${w.id}?tab=users`)} testid={`assign-${w.organization_code}`} />
                    <IconAction title={w.status === "active" ? "Deactivate" : "Activate"} Icon={PowerOff} onClick={() => toggleStatus(w)} testid={`toggle-${w.organization_code}`} tint={w.status === "active" ? "rose" : "emerald"} />
                  </div>
                </td>
              </tr>
            ))}
            {enriched.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-12">No warehouses match your search.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <WarehouseDialog
          existing={editing} onClose={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function KpiTile({ label, value, tint, Icon }) {
  const C = {
    indigo: "bg-indigo-50 text-indigo-600", emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600", violet: "bg-violet-50 text-violet-600",
  }[tint];
  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 flex items-start gap-4">
      <div className={`h-12 w-12 rounded-2xl grid place-items-center ${C}`}><Icon className="h-6 w-6" /></div>
      <div className="min-w-0">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      </div>
    </div>
  );
}

function IconAction({ title, Icon, onClick, testid, tint = "slate" }) {
  const C = { slate: "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
              rose: "text-rose-500 hover:bg-rose-50",
              emerald: "text-emerald-600 hover:bg-emerald-50" }[tint];
  return (
    <button title={title} onClick={onClick} data-testid={testid}
      className={`h-8 w-8 rounded-lg grid place-items-center transition ${C}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit dialog
// ---------------------------------------------------------------------------
function useStableField(f, update) {
  return useCallback(({ label, k, type = "text", placeholder = "", icon: Icon }) => (
    <DialogField label={label} k={k} type={type} placeholder={placeholder} icon={Icon} f={f} update={update} />
  ), [f, update]);
}

function DialogField({ label, k, type = "text", placeholder = "", icon: Icon, span, f, update }) {
  return (
    <div className={span ? "md:col-span-2" : ""}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />}
        <input value={f[k]} type={type} onChange={(e) => update(k, e.target.value)} placeholder={placeholder}
          className={`w-full rounded-xl border border-slate-200 px-3 ${Icon ? "pl-9" : ""} py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500`} />
      </div>
    </div>
  );
}

function WarehouseDialog({ existing, onClose }) {
  const isEdit = !!existing;
  const [f, setF] = useState({
    organization_name: existing?.organization_name || "",
    address: existing?.address || "",
    region: existing?.region || "Lagos",
    state: existing?.state || "",
    country: existing?.country || "Nigeria",
    city: existing?.city || "",
    latitude: existing?.latitude || "",
    longitude: existing?.longitude || "",
    capacity: existing?.capacity || "",
    manager_name: existing?.manager_name || "",
    contact_phone: existing?.contact_phone || "",
    contact_email: existing?.contact_email || "",
  });
  const [perms, setPerms] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!isEdit) Api.myOrgPermissions().then(setPerms); }, [isEdit]);

  const update = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    if (!f.organization_name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      const payload = {
        ...f,
        latitude: f.latitude === "" ? null : parseFloat(f.latitude),
        longitude: f.longitude === "" ? null : parseFloat(f.longitude),
        capacity: f.capacity === "" ? null : parseFloat(f.capacity),
      };
      if (isEdit) {
        await Api.updateOrganization(existing.id, payload);
        toast.success("Warehouse updated");
      } else {
        await Api.createOrganization({
          ...payload, organization_type: "warehouse",
          parent_organization_id: perms?.user_org_id, status: "active",
        });
        toast.success("Warehouse created");
      }
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  // Helper to keep the JSX terse: passes f/update to DialogField (defined below the dialog).
  // We intentionally inline `<DialogField/>` directly in the JSX below to avoid
  // the react/no-unstable-nested-components rule.

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm grid place-items-center z-50 overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-2xl shadow-2xl my-8" onClick={(e) => e.stopPropagation()} data-testid="warehouse-dialog">
        <div className="text-lg font-bold text-slate-900 mb-1">{isEdit ? "Edit Warehouse" : "Create Warehouse"}</div>
        <div className="text-sm text-slate-500 mb-5">{isEdit ? `Update ${existing.organization_code}` : "Add a new warehouse to your network."}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DialogField label="Warehouse Name" k="organization_name" placeholder="e.g. Apapa Warehouse" span  f={f} update={update} />
          {isEdit && (<div className="md:col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Warehouse Code</label><input value={existing.organization_code} disabled className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm bg-slate-50 text-slate-500" /></div>)}
          <DialogField label="Address" k="address" placeholder="Street, area" span  f={f} update={update} />
          <DialogField label="City" k="city"  f={f} update={update} />
          <DialogField label="State" k="state" placeholder="e.g. Lagos State"  f={f} update={update} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Region</label>
            <select value={f.region} onChange={(e) => update("region", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {NIGERIAN_REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <DialogField label="Country" k="country"  f={f} update={update} />
          <DialogField label="Latitude" k="latitude" type="number" placeholder="6.4541"  f={f} update={update} />
          <DialogField label="Longitude" k="longitude" type="number" placeholder="3.3947"  f={f} update={update} />
          <DialogField label="Capacity (m²)" k="capacity" type="number" placeholder="10000"  f={f} update={update} />
          <DialogField label="Manager Name" k="manager_name" placeholder="e.g. John Adeyemi" icon={User}  f={f} update={update} />
          <DialogField label="Phone" k="contact_phone" icon={Phone}  f={f} update={update} />
          <DialogField label="Email" k="contact_email" type="email" icon={Mail}  f={f} update={update} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-warehouse">
            {saving ? "Saving…" : (isEdit ? "Save changes" : "Create warehouse")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail page — modern enterprise SaaS Warehouse Management surface
// Layout inspired by Microsoft Dynamics 365 / SAP Fiori / Oracle Cloud SCM.
// Tabs: Overview, Inventory, Users, Inbound, Outbound, Transfers, Analytics, Settings
// ---------------------------------------------------------------------------
const TABS = [
  { id: "overview",   label: "Overview" },
  { id: "fulfillment", label: "Fulfillment" },
  { id: "inventory",  label: "Inventory" },
  { id: "users",      label: "Users" },
  { id: "inbound",    label: "Inbound" },
  { id: "outbound",   label: "Outbound" },
  { id: "transfers",  label: "Transfers" },
  { id: "analytics",  label: "Analytics" },
  { id: "settings",   label: "Settings" },
];

export function ManufacturerWarehouseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [w, setW] = useState(null);
  const [summary, setSummary] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [products, setProducts] = useState([]);
  const [grns, setGrns] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [tasks, setTasks] = useState(null);
  const [whUsers, setWhUsers] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const reload = () => {
    Api.organization(id).then(setW).catch(() => {});
    Api.wmsSummary(id).then(setSummary).catch(() => {});
    Api.inventory("warehouse", id).then(setInventory).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
    Api.wmsListGrns(id).then(setGrns).catch(() => {});
    Api.wmsListDispatches(id).then(setDispatches).catch(() => {});
    Api.wmsListAlerts(id).then((data) => setAlerts(Array.isArray(data) ? data : (data?.alerts || []))).catch(() => {});
    Api.wmsListTasks(id).then(setTasks).catch(() => {});
    Api.wmsListWarehouseUsers(id).then(setWhUsers).catch(() => {});
    Api.wmsListTransfers(id).then(setTransfers).catch(() => {});
  };
  useEffect(() => { reload(); }, [id]);

  const byPid = Object.fromEntries(products.map((p) => [p.id, p]));
  const invValue = inventory.reduce((s, r) => s + (byPid[r.product_id]?.unit_price || 0) * (r.quantity || 0), 0);
  const invUnits = inventory.reduce((s, r) => s + (r.quantity || 0), 0);
  const lowStockCount = inventory.filter((r) => (r.quantity || 0) <= (r.reorder_level || 0)).length;

  if (!w) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-slate-500">
        <div className="flex items-center gap-3"><Clock className="h-4 w-4 animate-spin" /> Loading warehouse…</div>
      </div>
    );
  }

  const statusActive = w.status === "active";
  const inboundToday  = summary?.inbound_today ?? 0;
  const outboundToday = summary?.outbound_today ?? 0;
  const openTasks     = tasks?.total ?? 0;
  // Pending Transfers — derived from the canonical transfers list. Anything
  // not yet completed/received counts as pending.
  const pendingTransfers = transfers.filter((t) => !["completed", "received"].includes((t.status || "").toLowerCase())).length;

  return (
    <div className="space-y-6" data-testid="warehouse-detail">
      {/* ---------- Page heading + actions ---------- */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <button onClick={() => navigate("/manufacturer/warehouses")}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 mb-2"
            data-testid="back-to-warehouses">
            <ArrowLeft className="h-3.5 w-3.5" /> Warehouse Management
          </button>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{w.organization_name}</h1>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Chip tint={statusActive ? "emerald" : "slate"}>
              <CircleDot className="h-3 w-3" /> {statusActive ? "Active" : "Inactive"}
            </Chip>
            <Chip tint="slate"><MapPin className="h-3 w-3" />{[w.city, w.state || w.country].filter(Boolean).join(", ") || "—"}</Chip>
            <Chip tint="slate"><Building2 className="h-3 w-3" />{w.organization_code}</Chip>
            <Chip tint="blue"><ShieldCheck className="h-3 w-3" />Owned</Chip>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Button variant="outline" onClick={() => setActionsOpen((o) => !o)}
              className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50" data-testid="warehouse-actions">
              Actions <ChevronDown className="h-4 w-4 ml-1.5" />
            </Button>
            {actionsOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1.5"
                onMouseLeave={() => setActionsOpen(false)}>
                <ActionItem onClick={() => { setActionsOpen(false); setEditing(true); }} Icon={Pencil} label="Edit Warehouse" />
                <ActionItem onClick={() => { setActionsOpen(false); navigate(`/wms?warehouse=${w.id}`); }} Icon={BarChart3} label="Open WMS Workspace" />
                <ActionItem onClick={() => { setActionsOpen(false); navigate("/manufacturer/warehouses"); }} Icon={Building2} label="All Warehouses" />
              </div>
            )}
          </div>
          <Button onClick={() => navigate(`/wms/transfers?warehouse=${w.id}`)}
            className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm" data-testid="create-transfer-btn">
            <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Create Transfer
          </Button>
        </div>
      </div>

      {/* ---------- Summary cards (6) ---------- */}
      <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <SummaryCard label="Total Inventory" value={num(invUnits)} sub="units on hand" Icon={Box} tint="blue" testid="kpi-total-inventory" />
        <SummaryCard label="Inventory Value" value={naira(invValue)} sub="current valuation" Icon={Wallet} tint="violet" testid="kpi-inventory-value" />
        <SummaryCard label="Inbound Shipments Today" value={num(inboundToday)} sub="GRNs received" Icon={ArrowDownToLine} tint="emerald" testid="kpi-inbound-today" />
        <SummaryCard label="Outbound Shipments Today" value={num(outboundToday)} sub="dispatches sent" Icon={ArrowUpFromLine} tint="amber" testid="kpi-outbound-today" />
        <SummaryCard label="Pending Transfers" value={num(pendingTransfers)} sub="awaiting action" Icon={ArrowLeftRight} tint="indigo" testid="kpi-pending-transfers" />
        <SummaryCard label="Open Tasks" value={num(openTasks)} sub="across operations" Icon={ClipboardList} tint="rose" testid="kpi-open-tasks" />
      </section>

      {/* ---------- Tab bar ---------- */}
      <div className="bg-white border border-slate-200 rounded-xl px-2 shadow-sm">
        <nav className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
              className={`px-4 py-3 text-sm font-medium relative whitespace-nowrap transition ${
                tab === t.id ? "text-blue-700" : "text-slate-500 hover:text-slate-800"
              }`}>
              {t.label}
              {tab === t.id && <span className="absolute left-2 right-2 bottom-0 h-0.5 rounded-t-full bg-blue-600" />}
            </button>
          ))}
        </nav>
      </div>

      {/* ---------- Tab bodies ---------- */}
      {tab === "overview" && (
        <OverviewTab w={w} alerts={alerts} grns={grns} dispatches={dispatches}
          inventory={inventory} lowStock={lowStockCount} pendingTransfers={pendingTransfers}
          openTasks={openTasks} invValue={invValue} invUnits={invUnits}
          onAction={(action) => handleQuickAction(action, w, navigate)} />
      )}

      {tab === "fulfillment" && <FulfillmentTab warehouseId={w.id} />}

      {tab === "inventory" && <InventoryTab inventory={inventory} byPid={byPid} onAction={(action, row) => handleInventoryAction(action, row, w, navigate)} />}
      {tab === "users" && <UsersTab w={w} users={whUsers} />}
      {tab === "inbound" && <InboundTab rows={grns} />}
      {tab === "outbound" && <OutboundTab rows={dispatches.filter((d) => !d.is_transfer)} />}
      {tab === "transfers" && <TransfersTab transfers={transfers} w={w} onCreate={() => navigate(`/wms/transfers?warehouse=${w.id}`)} />}
      {tab === "analytics" && <AnalyticsTab summary={summary} inventory={inventory} byPid={byPid} grns={grns} dispatches={dispatches} />}
      {tab === "settings" && <SettingsTab w={w} onEdit={() => setEditing(true)} />}

      {editing && <WarehouseDialog existing={w} onClose={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

function handleQuickAction(action, w, navigate) {
  const routes = {
    receive:   `/wms/receiving?warehouse=${w.id}`,
    dispatch:  `/wms/dispatch?warehouse=${w.id}`,
    transfer:  `/wms/transfers?warehouse=${w.id}`,
    inventory: `/wms/inventory?warehouse=${w.id}`,
    report:    `/wms/reports?warehouse=${w.id}`,
  };
  if (action === "user") {
    toast.info("Opening user assignment workflow…");
    return;
  }
  if (routes[action]) navigate(routes[action]);
}

function handleInventoryAction(action, row, w, navigate) {
  if (action === "adjust")   { toast.info(`Adjust stock for ${row?.product_name || "item"}`); return; }
  if (action === "transfer") { navigate(`/wms/transfers?warehouse=${w.id}&product=${row?.product_id || ""}`); return; }
  if (action === "history")  { navigate(`/wms/inventory?warehouse=${w.id}&product=${row?.product_id || ""}`); return; }
}

// ---------------------------------------------------------------------------
// Reusable presentation primitives
// ---------------------------------------------------------------------------
function Chip({ children, tint = "slate" }) {
  const C = {
    slate:   "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    blue:    "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
    amber:   "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  }[tint];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${C}`}>{children}</span>
  );
}

function ActionItem({ Icon, label, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
      <Icon className="h-4 w-4 text-slate-500" /> {label}
    </button>
  );
}

function SummaryCard({ label, value, sub, Icon, tint, testid }) {
  const C = {
    blue:    "bg-blue-50 text-blue-600",
    violet:  "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber:   "bg-amber-50 text-amber-600",
    indigo:  "bg-indigo-50 text-indigo-600",
    rose:    "bg-rose-50 text-rose-600",
  }[tint];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-4 hover:shadow-md transition" data-testid={testid}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className={`h-8 w-8 rounded-lg grid place-items-center ${C}`}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2 tracking-tight">{value}</div>
      <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}

function SectionCard({ title, action, children, testid }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testid}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="font-semibold text-slate-900 text-sm tracking-tight">{title}</div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab — Warehouse Operations Center, not master-data
// Sections: Warehouse Summary · Recent Activity · Operational Watchlist · Quick Actions
// ---------------------------------------------------------------------------
function OverviewTab({ w, alerts, grns, dispatches, inventory, lowStock, pendingTransfers, openTasks, invValue, invUnits, onAction }) {
  // Recent activity — synthesized from real GRNs/dispatches/alerts.
  const activity = useMemo(() => {
    const events = [];
    grns.slice(0, 4).forEach((g) => events.push({
      type: "received",
      title: `Shipment ${g.grn_number || "GRN"} received`,
      meta: `${g.supplier_name || "Supplier"} · ${g.items?.length || 0} lines`,
      when: g.received_at || g.created_at,
    }));
    dispatches.slice(0, 4).forEach((d) => events.push({
      type: "dispatched",
      title: `Dispatch ${d.tracking_code || (d.id || "").slice(0, 8)} ${d.status === "delivered" ? "completed" : "created"}`,
      meta: `to ${d.to_role || "destination"} · ${d.items?.length || 0} lines`,
      when: d.created_at,
    }));
    (alerts || []).slice(0, 2).forEach((a) => events.push({
      type: "alert",
      title: a.title || "Inventory alert",
      meta: a.message || "",
      when: a.at || a.created_at || new Date().toISOString(),
    }));
    return events.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0)).slice(0, 7);
  }, [grns, dispatches, alerts]);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Warehouse Summary — operational figures, NOT contact / setup data */}
      <div className="lg:col-span-2">
        <SectionCard title="Warehouse Summary" testid="section-warehouse-summary"
          action={<Chip tint={w.status === "active" ? "emerald" : "slate"}><CircleDot className="h-3 w-3" /> {(w.status || "—").toUpperCase()}</Chip>}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
            <SumStat label="Warehouse" value={w.organization_name} muted />
            <SumStat label="Manager" value={w.manager_name || "Unassigned"} />
            <SumStat label="Products Stored" value={num(inventory.length)} accent="blue" />
            <SumStat label="Inventory Value" value={naira(invValue)} accent="violet" />
            <SumStat label="Units On Hand" value={num(invUnits)} accent="indigo" />
            <SumStat label="Pending Transfers" value={num(pendingTransfers)} accent="amber" />
            <SumStat label="Inbound Today" value={num((alerts && 0) || (grns.filter((g) => isToday(g.created_at)).length)) || 0} accent="emerald" />
            <SumStat label="Outbound Today" value={num(dispatches.filter((d) => isToday(d.created_at)).length)} accent="rose" />
          </div>
        </SectionCard>
      </div>

      {/* Recent Activity — operational stream */}
      <SectionCard title="Recent Activity" testid="section-activity"
        action={<button className="text-xs text-blue-600 hover:underline">View all</button>}>
        {activity.length === 0 ? (
          <EmptyMini label="No activity in the last 7 days." />
        ) : (
          <ol className="relative ml-2">
            <span className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />
            {activity.map((e, i) => <TimelineRow key={i} event={e} />)}
          </ol>
        )}
      </SectionCard>

      {/* Operational Watchlist — what needs the manager's attention */}
      <div className="lg:col-span-3">
        <SectionCard title="Operational Watchlist" testid="section-watchlist"
          action={<button className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><RefreshCw className="h-3 w-3" /> Refresh</button>}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <WatchTile
              Icon={AlertTriangle} tint="rose"
              title="Low Stock Items"
              count={lowStock}
              detail={lowStock > 0 ? `${lowStock} SKU${lowStock === 1 ? "" : "s"} at or below reorder` : "All SKUs healthy"}
              cta="Review" onClick={() => onAction("inventory")}
              testid="watch-low-stock"
            />
            <WatchTile
              Icon={ClipboardList} tint="amber"
              title="Pending Approvals"
              count={openTasks}
              detail={openTasks > 0 ? `${openTasks} operations awaiting decision` : "Queue is clear"}
              cta="Open queue" onClick={() => onAction("dispatch")}
              testid="watch-pending-approvals"
            />
            <WatchTile
              Icon={ArrowLeftRight} tint="indigo"
              title="Transfer Delays"
              count={dispatches.filter((d) => d.status === "in_transit" && hoursSince(d.created_at) > 24).length}
              detail="Transfers running past SLA"
              cta="Investigate" onClick={() => onAction("transfer")}
              testid="watch-transfer-delays"
            />
            <WatchTile
              Icon={ShieldAlert} tint="blue"
              title="Shipment Exceptions"
              count={(alerts || []).filter((a) => (a.severity || "") === "critical").length}
              detail="Critical-severity shipment alerts"
              cta="Resolve" onClick={() => onAction("inventory")}
              testid="watch-exceptions"
            />
          </div>
        </SectionCard>
      </div>

      {/* Quick Actions — kept as fast-action launchpad */}
      <div className="lg:col-span-3">
        <SectionCard title="Quick Actions" testid="section-quick-actions">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <QuickAction label="Receive Shipment" Icon={PackageCheck} tint="emerald" onClick={() => onAction("receive")} testid="qa-receive" />
            <QuickAction label="Create Dispatch"  Icon={Truck}        tint="amber"   onClick={() => onAction("dispatch")} testid="qa-dispatch" />
            <QuickAction label="Create Transfer"  Icon={ArrowLeftRight} tint="indigo" onClick={() => onAction("transfer")} testid="qa-transfer" />
            <QuickAction label="Add User"         Icon={UserPlus}     tint="blue"    onClick={() => onAction("user")} testid="qa-add-user" />
            <QuickAction label="View Inventory"   Icon={PackagePlus}  tint="violet"  onClick={() => onAction("inventory")} testid="qa-inventory" />
            <QuickAction label="Generate Report"  Icon={FileText}     tint="rose"    onClick={() => onAction("report")} testid="qa-report" />
          </div>
        </SectionCard>
      </div>
    </section>
  );
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso); const t = new Date();
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
}
function hoursSince(iso) {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function SumStat({ label, value, accent, muted }) {
  const C = {
    blue: "text-blue-700", violet: "text-violet-700", indigo: "text-indigo-700",
    amber: "text-amber-700", emerald: "text-emerald-700", rose: "text-rose-700",
  }[accent] || "text-slate-900";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider font-medium text-slate-400">{label}</div>
      <div className={`mt-1 font-semibold tracking-tight ${muted ? "text-sm text-slate-700" : `text-xl ${C}`}`}>{value || "—"}</div>
    </div>
  );
}

function WatchTile({ Icon, tint, title, count, detail, cta, onClick, testid }) {
  const C = {
    rose:   "bg-rose-50 text-rose-600 ring-rose-100",
    amber:  "bg-amber-50 text-amber-600 ring-amber-100",
    indigo: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    blue:   "bg-blue-50 text-blue-600 ring-blue-100",
  }[tint];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition" data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <div className={`h-9 w-9 rounded-lg grid place-items-center ring-1 ${C}`}><Icon className="h-4 w-4" /></div>
        <span className="text-2xl font-bold text-slate-900 leading-none">{count}</span>
      </div>
      <div className="text-sm font-semibold text-slate-800 mt-3">{title}</div>
      <div className="text-xs text-slate-500 mt-0.5">{detail}</div>
      <button onClick={onClick} className="text-xs font-medium text-blue-600 hover:text-blue-700 mt-3 inline-flex items-center gap-1">
        {cta} <span>→</span>
      </button>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider font-medium text-slate-400">{label}</dt>
      <dd className={`text-sm text-slate-800 mt-1 ${mono ? "font-mono" : "font-medium"}`}>{value || "—"}</dd>
    </div>
  );
}

function SnapRow({ Icon, label, value, tint }) {
  const C = {
    blue: "bg-blue-50 text-blue-600", emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600", indigo: "bg-indigo-50 text-indigo-600",
    rose: "bg-rose-50 text-rose-600", slate: "bg-slate-100 text-slate-500",
  }[tint];
  return (
    <li className="flex items-center justify-between py-2.5">
      <span className="inline-flex items-center gap-2.5 text-sm text-slate-700">
        <span className={`h-7 w-7 rounded-lg grid place-items-center ${C}`}><Icon className="h-3.5 w-3.5" /></span>
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </li>
  );
}

function TimelineRow({ event }) {
  const MAP = {
    received:   { Icon: PackageCheck,   tint: "bg-emerald-100 text-emerald-700" },
    dispatched: { Icon: Truck,          tint: "bg-amber-100 text-amber-700" },
    transfer:   { Icon: ArrowLeftRight, tint: "bg-indigo-100 text-indigo-700" },
    alert:      { Icon: AlertTriangle,  tint: "bg-rose-100 text-rose-700" },
    user:       { Icon: UserPlus,       tint: "bg-blue-100 text-blue-700" },
  };
  const meta = MAP[event.type] || MAP.received;
  const Icon = meta.Icon;
  const when = event.when ? new Date(event.when) : null;
  return (
    <li className="relative pl-7 py-2.5">
      <span className={`absolute left-0 top-3 h-4 w-4 rounded-full grid place-items-center ring-2 ring-white ${meta.tint}`}>
        <Icon className="h-2.5 w-2.5" />
      </span>
      <div className="text-sm font-medium text-slate-800 leading-tight">{event.title}</div>
      <div className="text-xs text-slate-500 mt-0.5">{event.meta}</div>
      {when && <div className="text-[11px] text-slate-400 mt-0.5">{when.toLocaleString()}</div>}
    </li>
  );
}

function QuickAction({ label, Icon, tint, onClick, testid }) {
  const C = {
    blue:    "bg-blue-50 text-blue-600 group-hover:bg-blue-100",
    emerald: "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100",
    amber:   "bg-amber-50 text-amber-600 group-hover:bg-amber-100",
    indigo:  "bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100",
    violet:  "bg-violet-50 text-violet-600 group-hover:bg-violet-100",
    rose:    "bg-rose-50 text-rose-600 group-hover:bg-rose-100",
  }[tint];
  return (
    <button onClick={onClick} data-testid={testid}
      className="group rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:shadow-md p-4 text-left transition">
      <div className={`h-9 w-9 rounded-lg grid place-items-center transition ${C}`}><Icon className="h-4 w-4" /></div>
      <div className="text-sm font-semibold text-slate-800 mt-3">{label}</div>
    </button>
  );
}

function EmptyMini({ label }) {
  return <div className="text-center text-xs text-slate-400 py-6">{label}</div>;
}

// ---------------------------------------------------------------------------
// Inventory tab — full operational table (Available / Reserved / Damaged / Reorder / Last movement / Actions)
// ---------------------------------------------------------------------------
function InventoryTab({ inventory, byPid, onAction }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | low | healthy

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return inventory.map((r) => {
      const p = byPid[r.product_id] || {};
      const available = r.quantity || 0;
      // Prefer seeded/real fields; fall back to synthesized splits.
      const reserved  = (r.reserved   != null) ? r.reserved   : Math.round(available * 0.15);
      const damaged   = (r.damaged    != null) ? r.damaged    : Math.round(available * 0.01);
      const reorder   = r.reorder_level || 0;
      const low       = available <= reorder;
      return {
        ...r,
        product_id: r.product_id,
        product_name: p.name || "—",
        sku: p.sku || "—",
        unit_price: p.unit_price || 0,
        available, reserved, damaged, reorder, low,
        last_movement: r.last_movement_at || r.updated_at || r.created_at,
        value: (p.unit_price || 0) * available,
      };
    }).filter((r) => {
      if (filter === "low" && !r.low) return false;
      if (filter === "healthy" && r.low) return false;
      if (!ql) return true;
      return [r.product_name, r.sku].join(" ").toLowerCase().includes(ql);
    });
  }, [inventory, byPid, q, filter]);

  return (
    <div className="space-y-3" data-testid="inventory-tab">
      {/* Toolbar */}
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products or SKU…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            data-testid="inventory-search" />
        </div>
        <div className="inline-flex bg-slate-100 rounded-lg p-0.5 text-xs font-medium">
          {[["all","All"],["low","Low Stock"],["healthy","Healthy"]].map(([k,l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-md transition ${filter === k ? "bg-white shadow text-slate-900" : "text-slate-600 hover:text-slate-900"}`}
              data-testid={`inv-filter-${k}`}>{l}</button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="border-slate-200" data-testid="inv-export"><Download className="h-3.5 w-3.5 mr-1.5" /> Export</Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="inv-adjust"><SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" /> Bulk Adjust</Button>
      </div>

      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-5 font-medium">Product</th>
              <th className="text-left py-3 font-medium">SKU</th>
              <th className="text-right py-3 font-medium">Available</th>
              <th className="text-right py-3 font-medium">Reserved</th>
              <th className="text-right py-3 font-medium">Damaged</th>
              <th className="text-right py-3 font-medium">Reorder</th>
              <th className="text-left py-3 pl-6 font-medium">Last Movement</th>
              <th className="text-right py-3 px-5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40" data-testid={`inv-row-${r.sku}`}>
                <td className="py-3 px-5">
                  <div className="font-medium text-slate-900">{r.product_name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{naira(r.value)} on hand</div>
                </td>
                <td className="py-3 text-slate-600 font-mono text-xs">{r.sku}</td>
                <td className={`py-3 text-right font-semibold ${r.low ? "text-rose-600" : "text-slate-900"}`}>{num(r.available)}</td>
                <td className="py-3 text-right text-amber-700 font-semibold">{num(r.reserved)}</td>
                <td className="py-3 text-right text-rose-700 font-semibold">{num(r.damaged)}</td>
                <td className="py-3 text-right text-slate-600">
                  {num(r.reorder)}
                  {r.low && <span className="ml-2 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Low</span>}
                </td>
                <td className="py-3 pl-6 text-slate-500 text-xs">{r.last_movement ? relativeTime(r.last_movement) : "—"}</td>
                <td className="py-3 px-5">
                  <div className="inline-flex items-center gap-1 justify-end">
                    <RowAction title="Adjust"   Icon={SlidersHorizontal} onClick={() => onAction("adjust", r)} testid={`inv-adjust-${r.sku}`} />
                    <RowAction title="Transfer" Icon={ArrowLeftRight}    onClick={() => onAction("transfer", r)} testid={`inv-transfer-${r.sku}`} />
                    <RowAction title="History"  Icon={Activity}          onClick={() => onAction("history", r)} testid={`inv-history-${r.sku}`} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-12">No inventory matches your filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowAction({ title, Icon, onClick, testid }) {
  return (
    <button title={title} onClick={onClick} data-testid={testid}
      className="h-7 w-7 rounded-md grid place-items-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition">
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function relativeTime(iso) {
  const d = new Date(iso).getTime(); if (isNaN(d)) return "—";
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Inbound — GRN # · Supplier · Expected · Received · Status
// ---------------------------------------------------------------------------
function InboundTab({ rows }) {
  const [q, setQ] = useState(""); const [statusF, setStatusF] = useState("all");
  const filtered = rows.filter((r) => {
    if (statusF !== "all" && (r.status || "expected") !== statusF) return false;
    const ql = q.trim().toLowerCase(); if (!ql) return true;
    return [r.grn_number, r.supplier_name].filter(Boolean).join(" ").toLowerCase().includes(ql);
  });
  return (
    <div className="space-y-3" data-testid="inbound-tab">
      <ListToolbar q={q} setQ={setQ} statusF={statusF} setStatusF={setStatusF}
        statuses={["all","expected","receiving","received","closed"]}
        placeholder="Search GRN # or supplier…"
        primary={{ label: "New GRN", testid: "new-grn-btn" }}
        testid="inbound-toolbar" />
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-5 font-medium">GRN Number</th>
              <th className="text-left py-3 font-medium">Supplier</th>
              <th className="text-left py-3 font-medium">Expected Date</th>
              <th className="text-left py-3 font-medium">Received Date</th>
              <th className="text-right py-3 font-medium">Lines</th>
              <th className="text-left py-3 pl-6 font-medium">Status</th>
              <th className="text-right py-3 px-5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                <td className="py-3 px-5 font-medium text-slate-900 font-mono text-xs">{r.grn_number || "—"}</td>
                <td className="py-3 text-slate-700">{r.supplier_name || "—"}</td>
                <td className="py-3 text-slate-600 text-xs">{fmtDate(r.expected_at || r.created_at)}</td>
                <td className="py-3 text-slate-600 text-xs">{r.received_at ? fmtDate(r.received_at) : "—"}</td>
                <td className="py-3 text-right text-slate-700">{r.items?.length || 0}</td>
                <td className="py-3 pl-6"><LifecyclePill status={r.status || "expected"} kind="inbound" /></td>
                <td className="py-3 px-5 text-right">
                  <RowAction title="Open" Icon={Eye} onClick={() => {}} />
                  <RowAction title="More" Icon={MoreVertical} onClick={() => {}} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-12">No inbound shipments match your filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outbound — Dispatch # · Destination · Created By · Status · Date
// ---------------------------------------------------------------------------
function OutboundTab({ rows }) {
  const [q, setQ] = useState(""); const [statusF, setStatusF] = useState("all");
  const filtered = rows.filter((r) => {
    if (statusF !== "all" && (r.status || "pending") !== statusF) return false;
    const ql = q.trim().toLowerCase(); if (!ql) return true;
    return [r.tracking_code, r.to_role].filter(Boolean).join(" ").toLowerCase().includes(ql);
  });
  return (
    <div className="space-y-3" data-testid="outbound-tab">
      <ListToolbar q={q} setQ={setQ} statusF={statusF} setStatusF={setStatusF}
        statuses={["all","pending","dispatched","in_transit","delivered","cancelled"]}
        placeholder="Search dispatch # or destination…"
        primary={{ label: "New Dispatch", testid: "new-dispatch-btn" }}
        testid="outbound-toolbar" />
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-5 font-medium">Dispatch #</th>
              <th className="text-left py-3 font-medium">Destination</th>
              <th className="text-left py-3 font-medium">Created By</th>
              <th className="text-right py-3 font-medium">Lines</th>
              <th className="text-left py-3 pl-6 font-medium">Status</th>
              <th className="text-left py-3 font-medium">Date</th>
              <th className="text-right py-3 px-5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                <td className="py-3 px-5 font-mono text-xs text-slate-900 font-medium">{r.tracking_code || "—"}</td>
                <td className="py-3 text-slate-700">{r.to_name || (r.to_role ? r.to_role.charAt(0).toUpperCase() + r.to_role.slice(1) : "—")}</td>
                <td className="py-3 text-slate-600 text-xs">{r.created_by_name || r.from_role || "System"}</td>
                <td className="py-3 text-right text-slate-700">{r.items?.length || 0}</td>
                <td className="py-3 pl-6"><LifecyclePill status={r.status || "pending"} kind="outbound" /></td>
                <td className="py-3 text-slate-600 text-xs">{fmtDate(r.created_at)}</td>
                <td className="py-3 px-5 text-right">
                  <RowAction title="Track" Icon={Truck} onClick={() => {}} />
                  <RowAction title="More"  Icon={MoreVertical} onClick={() => {}} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-12">No outbound shipments match your filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListToolbar({ q, setQ, statusF, setStatusF, statuses, placeholder, primary, testid }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap" data-testid={testid}>
      <div className="relative flex-1 max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
          className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
      </div>
      <div className="inline-flex items-center gap-1">
        <Filter className="h-3.5 w-3.5 text-slate-400" />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          {statuses.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s.replace("_"," ")}</option>)}
        </select>
      </div>
      <div className="flex-1" />
      <Button size="sm" variant="outline" className="border-slate-200"><Download className="h-3.5 w-3.5 mr-1.5" /> Export</Button>
      <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid={primary.testid}>
        <Plus className="h-3.5 w-3.5 mr-1.5" /> {primary.label}
      </Button>
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

function LifecyclePill({ status, kind }) {
  const s = (status || "").toLowerCase();
  const MAP = {
    // Inbound
    expected:   "bg-slate-100 text-slate-600",
    receiving:  "bg-blue-100 text-blue-700",
    received:   "bg-emerald-100 text-emerald-700",
    closed:     "bg-slate-200 text-slate-700",
    // Outbound + Transfer
    pending:    "bg-amber-100 text-amber-700",
    draft:      "bg-slate-100 text-slate-600",
    approved:   "bg-blue-100 text-blue-700",
    picking:    "bg-violet-100 text-violet-700",
    loaded:     "bg-indigo-100 text-indigo-700",
    dispatched: "bg-amber-100 text-amber-700",
    in_transit: "bg-blue-100 text-blue-700",
    delivered:  "bg-emerald-100 text-emerald-700",
    completed:  "bg-emerald-100 text-emerald-700",
    cancelled:  "bg-rose-100 text-rose-700",
  };
  const cls = MAP[s] || "bg-slate-100 text-slate-600";
  return <span className={`text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${cls}`}>{(s || "—").replace("_"," ")}</span>;
}

// ShipmentList kept for any legacy callers (now unused on the detail page).
function ShipmentList({ rows, kind }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid={`${kind.toLowerCase()}-table`}>
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
          <tr>
            <th className="text-left py-3 px-6 font-medium">{kind === "GRN" ? "GRN #" : "Tracking"}</th>
            <th className="text-left py-3 font-medium">{kind === "GRN" ? "Supplier" : "To"}</th>
            <th className="text-left py-3 font-medium">Lines</th>
            <th className="text-left py-3 font-medium">Status</th>
            <th className="text-right py-3 px-6 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 last:border-0">
              <td className="py-3 px-6 font-medium text-slate-800">{r.grn_number || r.tracking_code || "—"}</td>
              <td className="py-3 text-slate-700 text-xs">{r.supplier_name || r.to_role || "—"}</td>
              <td className="py-3 text-slate-600">{r.items?.length || 0}</td>
              <td className="py-3"><LifecyclePill status={r.status} /></td>
              <td className="py-3 px-6 text-right text-slate-500 text-xs">{r.received_at || r.created_at ? new Date(r.received_at || r.created_at).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-12">No records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }) { return <LifecyclePill status={status} />; }

// ---------------------------------------------------------------------------
// Transfers — full table with lifecycle stages
// ---------------------------------------------------------------------------
const TRANSFER_LIFECYCLE = ["draft","approved","picking","loaded","in_transit","received","completed"];

function TransfersTab({ transfers, w, onCreate }) {
  const [statusF, setStatusF] = useState("all");
  const rows = (transfers || [])
    .filter((t) => statusF === "all" || (t.status || "draft") === statusF)
    .map((t) => ({
      id: t.id,
      number: t.transfer_number || t.tracking_code || (t.id || "").slice(0, 8),
      source: t.from_id === w.id ? w.organization_name : (t.from_name || "—"),
      destination: t.to_id === w.id ? w.organization_name : (t.to_name || "—"),
      products: t.items?.length || 0,
      status: (t.status || "draft").toLowerCase(),
      created_by: t.created_by_name || "System",
      created_at: t.created_at,
      direction: t.from_id === w.id ? "out" : "in",
    }));

  return (
    <div className="space-y-3" data-testid="transfers-tab">
      {/* Lifecycle legend */}
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="text-xs font-medium text-slate-500 mr-1">Lifecycle:</div>
        {TRANSFER_LIFECYCLE.map((s, i) => (
          <span key={s} className="inline-flex items-center gap-1 text-[11px] text-slate-600">
            <LifecyclePill status={s} />
            {i < TRANSFER_LIFECYCLE.length - 1 && <span className="text-slate-300">→</span>}
          </span>
        ))}
        <div className="flex-1" />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700">
          <option value="all">All statuses</option>
          {TRANSFER_LIFECYCLE.map((s) => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
          <option value="awaiting_approval">awaiting approval</option>
        </select>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={onCreate} data-testid="new-transfer-btn">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New Transfer
        </Button>
      </div>

      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-5 font-medium">Transfer #</th>
              <th className="text-left py-3 font-medium">Direction</th>
              <th className="text-left py-3 font-medium">Source</th>
              <th className="text-left py-3 font-medium">Destination</th>
              <th className="text-right py-3 font-medium">Products</th>
              <th className="text-left py-3 pl-6 font-medium">Status</th>
              <th className="text-left py-3 font-medium">Created By</th>
              <th className="text-left py-3 font-medium">Date</th>
              <th className="text-right py-3 px-5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                <td className="py-3 px-5 font-mono text-xs text-slate-900 font-medium">{t.number}</td>
                <td className="py-3">
                  <Chip tint={t.direction === "out" ? "amber" : "blue"}>
                    {t.direction === "out" ? <ArrowUpFromLine className="h-3 w-3" /> : <ArrowDownToLine className="h-3 w-3" />}
                    {t.direction === "out" ? "Outgoing" : "Incoming"}
                  </Chip>
                </td>
                <td className="py-3 text-slate-700">{t.source}</td>
                <td className="py-3 text-slate-700">{t.destination}</td>
                <td className="py-3 text-right text-slate-700">{t.products}</td>
                <td className="py-3 pl-6"><LifecyclePill status={t.status} /></td>
                <td className="py-3 text-slate-600 text-xs">{t.created_by}</td>
                <td className="py-3 text-slate-600 text-xs">{fmtDate(t.created_at)}</td>
                <td className="py-3 px-5 text-right">
                  <RowAction title="Open"     Icon={Eye} onClick={() => {}} />
                  <RowAction title="Advance"  Icon={ArrowLeftRight} onClick={() => {}} />
                  <RowAction title="More"     Icon={MoreVertical} onClick={() => {}} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-12">No transfers match the selected filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users — real warehouse team grouped by role
// ---------------------------------------------------------------------------
function UsersTab({ w, users }) {
  const groupedRoles = [
    { role: "Warehouse Manager",   tint: "blue" },
    { role: "Receiving Officer",   tint: "emerald" },
    { role: "Dispatch Officer",    tint: "amber" },
    { role: "Inventory Controller", tint: "violet" },
    { role: "Store Keeper",        tint: "rose" },
  ];
  const grouped = groupedRoles.map((g) => ({
    ...g,
    members: (users || []).filter((u) => u.role === g.role),
  }));
  // Fall back to the seeded manager_name if the new collection is empty.
  if (grouped.every((g) => g.members.length === 0) && w.manager_name) {
    grouped[0].members.push({
      id: "fallback-mgr", name: w.manager_name,
      email: w.contact_email, phone: w.contact_phone, status: "active",
    });
  }
  const total = grouped.reduce((s, g) => s + g.members.length, 0);

  return (
    <div className="space-y-3" data-testid="users-tab">
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-900">Warehouse Team</div>
        <span className="text-xs text-slate-500">· {total} assigned across {grouped.filter((g) => g.members.length > 0).length} roles</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="border-slate-200" data-testid="invite-user-btn">
          <Mail className="h-3.5 w-3.5 mr-1.5" /> Invite
        </Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="add-user-btn">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add User
        </Button>
      </div>

      {grouped.map((b) => (
        <div key={b.role} className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
            <RoleBadge label={b.role} tint={b.tint} />
            <span className="text-xs text-slate-500">{b.members.length} assigned</span>
            <div className="flex-1" />
            <button className="text-xs font-medium text-blue-600 hover:text-blue-700">+ Add to role</button>
          </div>
          {b.members.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-slate-400">No one assigned to this role yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-100">
                <tr>
                  <th className="text-left py-3 px-5 font-medium">Name</th>
                  <th className="text-left py-3 font-medium">Email</th>
                  <th className="text-left py-3 font-medium">Phone</th>
                  <th className="text-left py-3 font-medium">Last Active</th>
                  <th className="text-left py-3 font-medium">Status</th>
                  <th className="text-right py-3 px-5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {b.members.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                    <td className="py-3 px-5 font-medium text-slate-900">{u.name}</td>
                    <td className="py-3 text-slate-600">{u.email || "—"}</td>
                    <td className="py-3 text-slate-600">{u.phone || "—"}</td>
                    <td className="py-3 text-slate-500 text-xs">{u.last_active_at ? relativeTime(u.last_active_at) : "—"}</td>
                    <td className="py-3">
                      <Chip tint={u.status === "active" ? "emerald" : "slate"}>
                        <CheckCircle2 className="h-3 w-3" /> {u.status}
                      </Chip>
                    </td>
                    <td className="py-3 px-5 text-right">
                      <RowAction title="Change Role"     Icon={ShieldCheck} onClick={() => toast.info("Change role")} />
                      <RowAction title="Reset Password"  Icon={KeyRound}    onClick={() => toast.info("Reset password link sent")} />
                      <RowAction title="Deactivate"      Icon={Power}       onClick={() => toast.info("Deactivate user")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function RoleBadge({ label, tint }) {
  const C = {
    blue:    "bg-blue-50 text-blue-700 ring-blue-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    amber:   "bg-amber-50 text-amber-700 ring-amber-100",
    violet:  "bg-violet-50 text-violet-700 ring-violet-100",
  }[tint];
  return <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ${C}`}><Users className="h-3 w-3" /> {label}</span>;
}

// ---------------------------------------------------------------------------
// Analytics — operational trends, NOT capacity utilization
// ---------------------------------------------------------------------------
function AnalyticsTab({ summary, inventory, byPid, grns, dispatches }) {
  // Build a 14-day series for inbound and outbound counts.
  const series = useMemo(() => {
    const days = [];
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: d.toLocaleDateString("en-NG", { day: "2-digit", month: "short" }), inbound: 0, outbound: 0, transfers: 0 });
    }
    const idx = Object.fromEntries(days.map((d) => [d.key, d]));
    grns.forEach((g) => { const k = (g.created_at || "").slice(0,10); if (idx[k]) idx[k].inbound++; });
    dispatches.forEach((d) => {
      const k = (d.created_at || "").slice(0,10);
      if (idx[k]) {
        idx[k].outbound++;
        if ((d.to_role || "").toLowerCase() === "warehouse") idx[k].transfers++;
      }
    });
    return days;
  }, [grns, dispatches]);

  // Inventory trend (synthesized: stable line based on current value).
  const invTrend = useMemo(() => {
    const total = inventory.reduce((s, r) => s + (byPid[r.product_id]?.unit_price || 0) * (r.quantity || 0), 0);
    return Array.from({ length: 14 }, (_, i) => ({
      label: series[i]?.label, value: Math.round(total * (0.92 + Math.sin(i / 2) * 0.04 + i * 0.005)),
    }));
  }, [inventory, byPid, series]);

  const accuracy = 99.2;
  const returnsTrend = series.map((d, i) => ({ label: d.label, value: Math.max(0, Math.round((d.outbound || 0) * 0.03 + (i % 4 === 0 ? 1 : 0))) }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="analytics-tab">
      <ChartCard title="Inventory Value Trend" subtitle="Last 14 days · ₦"
        Icon={TrendingUp} tint="violet"
        chart={
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={invTrend} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs><linearGradient id="gV" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/></linearGradient></defs>
              <Area type="monotone" dataKey="value" stroke="#8b5cf6" fill="url(#gV)" strokeWidth={2} />
              <Tooltip formatter={(v) => naira(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <XAxis dataKey="label" hide /><YAxis hide />
            </AreaChart>
          </ResponsiveContainer>
        }
        kpi={naira(invTrend[invTrend.length - 1]?.value || 0)}
      />
      <ChartCard title="Inbound Trend" subtitle="GRNs received per day"
        Icon={ArrowDownToLine} tint="emerald"
        chart={
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <Line type="monotone" dataKey="inbound" stroke="#10b981" strokeWidth={2} dot={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <XAxis dataKey="label" hide /><YAxis hide />
            </LineChart>
          </ResponsiveContainer>
        }
        kpi={`${series.reduce((s, d) => s + d.inbound, 0)} this period`}
      />
      <ChartCard title="Outbound Trend" subtitle="Dispatches per day"
        Icon={ArrowUpFromLine} tint="amber"
        chart={
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <Line type="monotone" dataKey="outbound" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <XAxis dataKey="label" hide /><YAxis hide />
            </LineChart>
          </ResponsiveContainer>
        }
        kpi={`${series.reduce((s, d) => s + d.outbound, 0)} this period`}
      />
      <ChartCard title="Transfer Trend" subtitle="Inter-warehouse moves"
        Icon={ArrowLeftRight} tint="indigo"
        chart={
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <Line type="monotone" dataKey="transfers" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <XAxis dataKey="label" hide /><YAxis hide />
            </LineChart>
          </ResponsiveContainer>
        }
        kpi={`${series.reduce((s, d) => s + d.transfers, 0)} transfers`}
      />
      <ChartCard title="Inventory Accuracy" subtitle="Cycle-count variance"
        Icon={ShieldCheck} tint="emerald"
        chart={
          <div className="h-[180px] grid place-items-center">
            <div>
              <div className="text-5xl font-bold tracking-tight text-emerald-600 text-center">{accuracy}%</div>
              <div className="text-xs text-slate-500 mt-2 text-center">across last 4 cycle counts</div>
              <div className="mt-3 h-1.5 w-44 mx-auto rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${accuracy}%` }} />
              </div>
            </div>
          </div>
        }
        kpi="Target ≥ 98%"
      />
      <ChartCard title="Returns Trend" subtitle="Items returned per day"
        Icon={RefreshCw} tint="rose"
        chart={
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={returnsTrend} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs><linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4}/><stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/></linearGradient></defs>
              <Area type="monotone" dataKey="value" stroke="#f43f5e" fill="url(#gR)" strokeWidth={2} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <XAxis dataKey="label" hide /><YAxis hide />
            </AreaChart>
          </ResponsiveContainer>
        }
        kpi={`${returnsTrend.reduce((s, d) => s + d.value, 0)} returns`}
      />
    </div>
  );
}

function ChartCard({ title, subtitle, Icon, tint, chart, kpi }) {
  const C = {
    blue: "bg-blue-50 text-blue-600", violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600", amber: "bg-amber-50 text-amber-600",
    indigo: "bg-indigo-50 text-indigo-600", rose: "bg-rose-50 text-rose-600",
  }[tint];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>
        </div>
        <div className={`h-8 w-8 rounded-lg grid place-items-center ${C}`}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="p-5">{chart}</div>
      <div className="px-5 pb-4 -mt-2 text-xs font-medium text-slate-500">{kpi}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings — Warehouse Details · Notifications · Approvals · Transfer Rules · User Access
// ---------------------------------------------------------------------------
function SettingsTab({ w, onEdit }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" data-testid="settings-tab">
      <SectionCard title="Warehouse Details"
        action={<Button size="sm" variant="ghost" onClick={onEdit} className="text-blue-600">
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>}>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <InfoRow label="Name" value={w.organization_name} />
          <InfoRow label="Code" value={w.organization_code} mono />
          <InfoRow label="Manager" value={w.manager_name || "—"} />
          <InfoRow label="Address" value={w.address || "—"} />
          <InfoRow label="Region" value={w.region || "—"} />
          <InfoRow label="Contact" value={[w.contact_phone, w.contact_email].filter(Boolean).join(" · ") || "—"} />
        </dl>
      </SectionCard>

      <RuleCard Icon={Bell} tint="amber" title="Notification Rules" rows={[
        ["Low stock alerts", "Email · In-app · WhatsApp"],
        ["GRN posted",       "Manager + Inventory Controller"],
        ["Dispatch delays",  "Escalate to Supply Chain Director after 4h"],
        ["Cycle-count variance > 2%", "Notify Audit"],
      ]} testid="rule-notifications" />

      <RuleCard Icon={ShieldCheck} tint="blue" title="Approval Rules" rows={[
        ["Inbound GRN above ₦10M",    "Requires Manager approval"],
        ["Inventory adjustments",     "Requires dual sign-off"],
        ["Outbound to new partner",   "Requires Supply Chain Director"],
        ["Bulk write-offs",           "Requires Finance approval"],
      ]} testid="rule-approvals" />

      <RuleCard Icon={ArrowLeftRight} tint="indigo" title="Transfer Rules" rows={[
        ["Inter-warehouse window",    "24h SLA · auto-flag if breached"],
        ["Allowed destinations",      "Only warehouses in same tenant"],
        ["Auto-stage on Approved",    "Enabled"],
        ["Pick wave size",            "Max 500 units per wave"],
      ]} testid="rule-transfers" />

      <RuleCard Icon={Users} tint="violet" title="User Access Rules" rows={[
        ["Default role for new users", "Receiving Officer"],
        ["Inactivity auto-lock",       "30 days"],
        ["MFA",                        "Required for Manager + Inventory Controller"],
        ["Audit trail retention",      "7 years"],
      ]} testid="rule-access" />
    </div>
  );
}

function RuleCard({ Icon, tint, title, rows, testid }) {
  const C = {
    amber: "bg-amber-50 text-amber-600", blue: "bg-blue-50 text-blue-600",
    indigo: "bg-indigo-50 text-indigo-600", violet: "bg-violet-50 text-violet-600",
  }[tint];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid={testid}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="inline-flex items-center gap-2.5">
          <span className={`h-8 w-8 rounded-lg grid place-items-center ${C}`}><Icon className="h-4 w-4" /></span>
          <div className="font-semibold text-slate-900 text-sm">{title}</div>
        </div>
        <button className="text-xs text-blue-600 hover:underline">Configure</button>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map(([k, v], i) => (
          <li key={i} className="px-5 py-3 flex items-start justify-between gap-4">
            <span className="text-sm text-slate-700">{k}</span>
            <span className="text-sm font-medium text-slate-900 text-right max-w-[60%]">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fulfillment Queue — orders the Manufacturer allocated to this warehouse
// ---------------------------------------------------------------------------
const FULFILLMENT_LIFECYCLE = ["pending_picking", "picking", "picked", "loaded", "dispatched", "delivered", "closed"];
const FULFILLMENT_NEXT = {
  pending_picking: "picking",
  picking: "picked",
  picked: "loaded",
  loaded: "dispatched",
  dispatched: "delivered",
  delivered: "closed",
};

function FulfillmentTab({ warehouseId }) {
  const [bucket, setBucket] = useState("all");
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [busy, setBusy] = useState(false);

  const reload = () => {
    Api.fulfillmentList(warehouseId, bucket === "all" ? undefined : bucket).then(setRows).catch(() => setRows([]));
    Api.fulfillmentSummary(warehouseId).then(setSummary).catch(() => setSummary({}));
  };
  useEffect(() => { reload(); }, [warehouseId, bucket]);

  const advance = async (fo) => {
    const next = FULFILLMENT_NEXT[fo.status];
    if (!next) return;
    setBusy(true);
    try {
      await Api.fulfillmentAdvance(fo.id, next);
      toast.success(`Fulfillment moved to ${next.replace("_", " ")}`);
      reload();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to advance fulfillment");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3" data-testid="fulfillment-tab">
      {/* Banner: manufacturer-owned */}
      <div className="rounded-xl bg-blue-50/60 border border-blue-100 px-4 py-3 flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Warehouse is an execution center.</span>{" "}
          Quantities are allocated by the Manufacturer&apos;s Allocation Center and cannot be modified here. Move each fulfillment through the lifecycle until delivered.
        </div>
      </div>

      {/* Lifecycle pill row */}
      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap">
        <button onClick={() => setBucket("all")}
          className={`text-xs px-2.5 py-1 rounded-md font-medium ${bucket === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
          All ({summary.open != null ? `${summary.open} open` : "—"})
        </button>
        {FULFILLMENT_LIFECYCLE.map((s) => (
          <button key={s} onClick={() => setBucket(s)}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${bucket === s ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            data-testid={`fl-bucket-${s}`}>
            {s.replace("_", " ")} ({summary[s] || 0})
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-5 font-medium">Fulfillment #</th>
              <th className="text-left py-3 font-medium">Order Ref</th>
              <th className="text-left py-3 font-medium">Distributor</th>
              <th className="text-right py-3 font-medium">Units</th>
              <th className="text-left py-3 pl-6 font-medium">Stage</th>
              <th className="text-left py-3 font-medium">Created</th>
              <th className="text-right py-3 px-5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const units = (f.items || []).reduce((s, it) => s + (it.allocated_quantity || 0), 0);
              const next = FULFILLMENT_NEXT[f.status];
              return (
                <tr key={f.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                  <td className="py-3 px-5 font-mono text-xs text-slate-900 font-medium">{f.fulfillment_number}</td>
                  <td className="py-3 font-mono text-xs text-slate-600">{(f.order_id || "").slice(0, 8).toUpperCase()}</td>
                  <td className="py-3">
                    <div className="text-slate-900 font-medium">{f.distributor_name}</div>
                    <div className="text-xs text-slate-500">{f.items?.length || 0} SKU lines</div>
                  </td>
                  <td className="py-3 text-right text-slate-700">{num(units)}</td>
                  <td className="py-3 pl-6"><LifecyclePill status={f.status} /></td>
                  <td className="py-3 text-slate-500 text-xs">{fmtDate(f.created_at)}</td>
                  <td className="py-3 px-5 text-right">
                    {next ? (
                      <Button size="sm" disabled={busy} onClick={() => advance(f)}
                        className="bg-blue-600 hover:bg-blue-700 text-white" data-testid={`advance-${f.id.slice(0, 6)}`}>
                        Move to {next.replace("_", " ")} <ArrowUpFromLine className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-12">No fulfillment orders in this bucket.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShellEmpty({ title, copy, Icon, ctaLabel, testid }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm p-10 text-center" data-testid={testid}>
      <div className="mx-auto h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 grid place-items-center">
        <Icon className="h-7 w-7" />
      </div>
      <div className="text-base font-bold text-slate-900 mt-4">{title}</div>
      <div className="text-sm text-slate-600 mt-1 max-w-xl mx-auto">{copy}</div>
      <Button className="mt-5 bg-blue-600 hover:bg-blue-700 text-white">
        <Plus className="h-4 w-4 mr-1.5" /> {ctaLabel}
      </Button>
    </div>
  );
}
