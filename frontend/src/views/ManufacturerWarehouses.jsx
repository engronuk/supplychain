// Manufacturer-side Warehouse Management module.
// List + create at /manufacturer/warehouses; per-warehouse drill-down with
// tabs at /manufacturer/warehouses/:id.
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  Plus, Search, Pencil, PowerOff, ArrowLeftRight, Users, Eye, Building2,
  MapPin, ArrowLeft, Box, AlertCircle, Mail, Phone, User, Construction,
  ArrowDownToLine, ArrowUpFromLine, BarChart3, Settings as SettingsIcon,
  Wallet, Truck, ClipboardList, ChevronDown, FileText, UserPlus,
  PackageCheck, PackagePlus, ClipboardCheck, ShieldCheck, Clock,
  CircleDot, CheckCircle2, AlertTriangle,
} from "lucide-react";
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
  { id: "overview",  label: "Overview" },
  { id: "inventory", label: "Inventory" },
  { id: "users",     label: "Users" },
  { id: "inbound",   label: "Inbound" },
  { id: "outbound",  label: "Outbound" },
  { id: "transfers", label: "Transfers" },
  { id: "analytics", label: "Analytics" },
  { id: "settings",  label: "Settings" },
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
  const [editing, setEditing] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const reload = () => {
    Api.organization(id).then(setW).catch(() => {});
    Api.wmsSummary(id).then(setSummary).catch(() => {});
    Api.inventory("warehouse", id).then(setInventory).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
    Api.wmsListGrns(id).then(setGrns).catch(() => {});
    Api.wmsListDispatches(id).then(setDispatches).catch(() => {});
    Api.wmsListAlerts(id).then(setAlerts).catch(() => {});
    Api.wmsListTasks(id).then(setTasks).catch(() => {});
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
  // Pending Transfers — currently approximated by dispatches awaiting/pending until a
  // dedicated transfers collection lands. Falls back to 0 cleanly.
  const pendingTransfers = dispatches.filter((d) => ["pending", "approved", "in_transit"].includes(d.status)).length;

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
          openTasks={openTasks} onEdit={() => setEditing(true)}
          onAction={(action) => handleQuickAction(action, w, navigate)} />
      )}

      {tab === "inventory" && <InventoryTab inventory={inventory} byPid={byPid} />}
      {tab === "users" && <UsersTab w={w} />}
      {tab === "inbound" && <ShipmentList rows={grns} kind="GRN" />}
      {tab === "outbound" && <ShipmentList rows={dispatches} kind="DISPATCH" />}
      {tab === "transfers" && <TransfersTab dispatches={dispatches} />}
      {tab === "analytics" && <AnalyticsTab summary={summary} inventory={inventory} byPid={byPid} />}
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
// Overview tab — 4 sections per spec
// ---------------------------------------------------------------------------
function OverviewTab({ w, alerts, grns, dispatches, inventory, lowStock, pendingTransfers, openTasks, onEdit, onAction }) {
  // Build an activity timeline from real GRNs, dispatches & alerts.
  const activity = useMemo(() => {
    const events = [];
    grns.slice(0, 3).forEach((g) => events.push({
      type: "received",
      title: `Shipment received — ${g.grn_number || "GRN"}`,
      meta: `${g.supplier_name || "Supplier"} · ${g.items?.length || 0} lines`,
      when: g.received_at || g.created_at,
    }));
    dispatches.slice(0, 3).forEach((d) => events.push({
      type: "dispatched",
      title: `Shipment dispatched — ${d.tracking_code || d.id?.slice(0, 8)}`,
      meta: `to ${d.to_role || "destination"} · ${d.items?.length || 0} lines`,
      when: d.created_at,
    }));
    if (lowStock > 0) events.push({
      type: "alert",
      title: "Inventory adjustment required",
      meta: `${lowStock} SKU${lowStock === 1 ? "" : "s"} at or below reorder level`,
      when: new Date().toISOString(),
    });
    if (w.manager_name) events.push({
      type: "user",
      title: `Manager assigned — ${w.manager_name}`,
      meta: "Role · Warehouse Manager",
      when: w.created_at || new Date().toISOString(),
    });
    return events.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0)).slice(0, 6);
  }, [grns, dispatches, lowStock, w]);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* Warehouse Information */}
      <div className="lg:col-span-2">
        <SectionCard title="Warehouse Information"
          testid="section-warehouse-info"
          action={<Button variant="ghost" size="sm" onClick={onEdit} className="text-blue-600 hover:text-blue-700" data-testid="edit-warehouse-info">
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>}>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
            <InfoRow label="Warehouse Name" value={w.organization_name} />
            <InfoRow label="Warehouse Code" value={w.organization_code} mono />
            <InfoRow label="Location" value={[w.address, w.city, w.state, w.country].filter(Boolean).join(", ") || "—"} />
            <InfoRow label="Manager" value={w.manager_name || "—"} />
            <InfoRow label="Contact Phone" value={w.contact_phone || "—"} />
            <InfoRow label="Contact Email" value={w.contact_email || "—"} />
            <InfoRow label="Status" value={
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${w.status === "active" ? "text-emerald-700" : "text-slate-500"}`}>
                <CircleDot className="h-3 w-3" /> {(w.status || "—").toUpperCase()}
              </span>
            } />
            <InfoRow label="Coordinates" value={w.latitude && w.longitude ? `${w.latitude}, ${w.longitude}` : "—"} mono />
          </dl>
        </SectionCard>
      </div>

      {/* Recent Activity Timeline */}
      <SectionCard title="Recent Activity" testid="section-activity"
        action={<Link to="#" onClick={(e) => e.preventDefault()} className="text-xs text-blue-600 hover:underline">View all</Link>}>
        {activity.length === 0 ? (
          <EmptyMini label="No recent activity yet." />
        ) : (
          <ol className="relative ml-2">
            <span className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />
            {activity.map((e, i) => <TimelineRow key={i} event={e} />)}
          </ol>
        )}
      </SectionCard>

      {/* Operational Snapshot */}
      <SectionCard title="Operational Snapshot" testid="section-snapshot">
        <ul className="divide-y divide-slate-100">
          <SnapRow Icon={Box} label="Active Products" value={num(inventory.length)} tint="blue" />
          <SnapRow Icon={ArrowDownToLine} label="Open Inbound Shipments" value={num(grns.filter((g) => g.status !== "received").length)} tint="emerald" />
          <SnapRow Icon={ArrowUpFromLine} label="Open Outbound Shipments" value={num(dispatches.filter((d) => d.status !== "delivered").length)} tint="amber" />
          <SnapRow Icon={ArrowLeftRight} label="Pending Transfers" value={num(pendingTransfers)} tint="indigo" />
          <SnapRow Icon={AlertTriangle} label="Inventory Alerts" value={num((alerts || []).length + lowStock)} tint={(alerts.length + lowStock) > 0 ? "rose" : "slate"} />
        </ul>
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
          <span className="text-slate-500">Open Tasks</span>
          <span className="font-semibold text-slate-900">{num(openTasks)}</span>
        </div>
      </SectionCard>

      {/* Quick Actions */}
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
// Inventory / Inbound / Outbound / Transfers / Users / Analytics / Settings tabs
// ---------------------------------------------------------------------------
function InventoryTab({ inventory, byPid }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid="inventory-table">
      <table className="w-full text-sm">
        <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
          <tr>
            <th className="text-left py-3 px-6 font-medium">Product</th>
            <th className="text-left py-3 font-medium">SKU</th>
            <th className="text-right py-3 font-medium">On hand</th>
            <th className="text-right py-3 font-medium">Reorder</th>
            <th className="text-right py-3 px-6 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map((r) => {
            const p = byPid[r.product_id] || {};
            const low = (r.quantity || 0) <= (r.reorder_level || 0);
            return (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="py-3 px-6 font-medium text-slate-800">{p.name || "—"}</td>
                <td className="py-3 text-slate-600">{p.sku || "—"}</td>
                <td className={`py-3 text-right font-semibold ${low ? "text-rose-600" : "text-emerald-600"}`}>{num(r.quantity)}</td>
                <td className="py-3 text-right text-slate-600">{num(r.reorder_level || 0)}</td>
                <td className="py-3 px-6 text-right font-semibold text-slate-800">{naira((p.unit_price || 0) * (r.quantity || 0))}</td>
              </tr>
            );
          })}
          {inventory.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-12">No inventory recorded for this warehouse.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

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
            <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
              <td className="py-3 px-6 font-medium text-slate-800">{r.grn_number || r.tracking_code || "—"}</td>
              <td className="py-3 text-slate-700 text-xs">{r.supplier_name || r.to_role || "—"}</td>
              <td className="py-3 text-slate-600">{r.items?.length || 0}</td>
              <td className="py-3">
                <StatusPill status={r.status} />
              </td>
              <td className="py-3 px-6 text-right text-slate-500 text-xs">{r.received_at || r.created_at ? new Date(r.received_at || r.created_at).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-12">No records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }) {
  const s = (status || "").toLowerCase();
  const tint = ["received", "delivered", "completed"].includes(s) ? "bg-emerald-100 text-emerald-700"
    : ["in_transit", "approved"].includes(s) ? "bg-blue-100 text-blue-700"
    : ["pending", "draft"].includes(s) ? "bg-amber-100 text-amber-700"
    : "bg-slate-100 text-slate-600";
  return <span className={`text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${tint}`}>{s || "—"}</span>;
}

function TransfersTab({ dispatches }) {
  // Synthesize a Transfers view from outbound dispatches that are warehouse-to-warehouse.
  const transfers = dispatches.filter((d) => (d.to_role || "").toLowerCase() === "warehouse");
  return (
    <div className="space-y-4">
      {transfers.length === 0 ? (
        <ShellEmpty
          title="Stock Transfers"
          copy="Move inventory between your warehouses with full chain-of-custody. Auto-decrement source on dispatch and auto-increment destination on receipt."
          ctaLabel="Create Transfer" Icon={ArrowLeftRight}
          testid="transfers-empty"
        />
      ) : (
        <ShipmentList rows={transfers} kind="DISPATCH" />
      )}
    </div>
  );
}

function UsersTab({ w }) {
  // Display the manager as the seeded user; full assignment workflow ships in next iteration.
  const rows = w.manager_name ? [{
    name: w.manager_name, role: "Warehouse Manager",
    email: w.contact_email, phone: w.contact_phone, status: "active",
  }] : [];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid="users-table">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-900 text-sm">Warehouse Team</div>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="add-user-btn">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add User
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="text-center text-slate-400 py-12 text-sm">No users assigned yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-100">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Name</th>
              <th className="text-left py-3 font-medium">Role</th>
              <th className="text-left py-3 font-medium">Email</th>
              <th className="text-left py-3 font-medium">Phone</th>
              <th className="text-left py-3 px-6 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                <td className="py-3 px-6 font-medium text-slate-800">{u.name}</td>
                <td className="py-3 text-slate-600">{u.role}</td>
                <td className="py-3 text-slate-600">{u.email || "—"}</td>
                <td className="py-3 text-slate-600">{u.phone || "—"}</td>
                <td className="py-3 px-6"><Chip tint="emerald"><CheckCircle2 className="h-3 w-3" /> {u.status}</Chip></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AnalyticsTab({ summary, inventory, byPid }) {
  // Top 5 SKUs by inventory value
  const top = [...inventory]
    .map((r) => ({ p: byPid[r.product_id] || {}, qty: r.quantity || 0 }))
    .map((x) => ({ ...x, value: (x.p.unit_price || 0) * x.qty }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
  const max = Math.max(1, ...top.map((t) => t.value));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="analytics-tab">
      <SectionCard title="Throughput (last 24h)">
        <ul className="space-y-3 text-sm">
          <li className="flex items-center justify-between"><span className="text-slate-600">Inbound</span><span className="font-semibold text-slate-900">{summary?.inbound_today ?? 0}</span></li>
          <li className="flex items-center justify-between"><span className="text-slate-600">Outbound</span><span className="font-semibold text-slate-900">{summary?.outbound_today ?? 0}</span></li>
          <li className="flex items-center justify-between"><span className="text-slate-600">Available units</span><span className="font-semibold text-slate-900">{num(summary?.available_units || 0)}</span></li>
        </ul>
      </SectionCard>
      <div className="lg:col-span-2">
        <SectionCard title="Top SKUs by Inventory Value">
          {top.length === 0 ? <EmptyMini label="No inventory yet." /> : (
            <ul className="space-y-3">
              {top.map((t, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800 truncate">{t.p.name || "—"}</span>
                    <span className="text-slate-700 font-semibold">{naira(t.value)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.value / max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function SettingsTab({ w, onEdit }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-testid="settings-tab">
      <div className="lg:col-span-2">
        <SectionCard title="General"
          action={<Button size="sm" variant="ghost" onClick={onEdit} className="text-blue-600">
            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
          </Button>}>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
            <InfoRow label="Warehouse Name" value={w.organization_name} />
            <InfoRow label="Code" value={w.organization_code} mono />
            <InfoRow label="Address" value={w.address || "—"} />
            <InfoRow label="Region" value={w.region || "—"} />
          </dl>
        </SectionCard>
      </div>
      <SectionCard title="Operations">
        <ul className="space-y-3 text-sm">
          <li className="flex items-center justify-between"><span className="text-slate-600">Default reorder strategy</span><span className="font-semibold text-slate-900">Auto</span></li>
          <li className="flex items-center justify-between"><span className="text-slate-600">Notifications</span><span className="font-semibold text-slate-900">Email + In-app</span></li>
          <li className="flex items-center justify-between"><span className="text-slate-600">Operating hours</span><span className="font-semibold text-slate-900">08:00 – 18:00</span></li>
        </ul>
      </SectionCard>
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
