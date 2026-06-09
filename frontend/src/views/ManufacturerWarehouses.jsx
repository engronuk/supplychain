// Manufacturer-side Warehouse Management module.
// List + create at /manufacturer/warehouses; per-warehouse drill-down with
// tabs at /manufacturer/warehouses/:id.
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import {
  Plus, Search, Pencil, PowerOff, ArrowLeftRight, Users, Eye, Building2,
  MapPin, ArrowLeft, Box, AlertCircle, Mail, Phone, User, Construction,
  ArrowDownToLine, ArrowUpFromLine, BarChart3, Settings as SettingsIcon,
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
// Detail page (tabs: Overview, Inventory, Users, Inbound, Outbound, Transfers, Analytics, Settings)
// ---------------------------------------------------------------------------
const TABS = [
  { id: "overview",  label: "Overview",  Icon: Eye },
  { id: "inventory", label: "Inventory", Icon: Box },
  { id: "users",     label: "Users",     Icon: Users },
  { id: "inbound",   label: "Inbound Shipments",  Icon: ArrowDownToLine },
  { id: "outbound",  label: "Outbound Shipments", Icon: ArrowUpFromLine },
  { id: "transfers", label: "Transfers", Icon: ArrowLeftRight },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "settings",  label: "Settings",  Icon: SettingsIcon },
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
  const [editing, setEditing] = useState(false);

  const reload = () => {
    Api.organization(id).then(setW).catch(() => {});
    Api.wmsSummary(id).then(setSummary).catch(() => {});
    Api.inventory("warehouse", id).then(setInventory).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
    Api.wmsListGrns(id).then(setGrns).catch(() => {});
    Api.wmsListDispatches(id).then(setDispatches).catch(() => {});
  };
  useEffect(() => { reload(); }, [id]);

  const byPid = Object.fromEntries(products.map((p) => [p.id, p]));
  const invValue = inventory.reduce((s, r) => s + (byPid[r.product_id]?.unit_price || 0) * (r.quantity || 0), 0);

  if (!w) return <div className="text-slate-500">Loading warehouse…</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate("/manufacturer/warehouses")} className="rounded-xl border border-slate-200 bg-white p-2" data-testid="back-to-warehouses">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="text-xs text-slate-500 uppercase tracking-wider">{w.organization_code}</div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{w.organization_name}</h1>
          <div className="text-sm text-slate-500 mt-1 flex items-center gap-4 flex-wrap">
            <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{[w.city, w.state, w.country].filter(Boolean).join(", ") || "—"}</span>
            <span>·</span>
            <span>Status <span className={`ml-1 font-semibold ${w.status === "active" ? "text-emerald-600" : "text-slate-500"}`}>{w.status}</span></span>
          </div>
        </div>
        <Button onClick={() => setEditing(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="edit-warehouse">
          <Pencil className="h-4 w-4 mr-1.5" /> Edit
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition flex items-center gap-1.5 whitespace-nowrap ${
              tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}>
            <t.Icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Tab bodies */}
      {tab === "overview" && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5 lg:col-span-2">
            <h3 className="font-bold text-slate-900 mb-4">Warehouse details</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <Field label="Manager" value={w.manager_name} />
              <Field label="Phone" value={w.contact_phone} />
              <Field label="Email" value={w.contact_email} />
              <Field label="Capacity" value={w.capacity ? `${num(w.capacity)} m²` : null} />
              <Field label="Latitude" value={w.latitude} />
              <Field label="Longitude" value={w.longitude} />
              <Field label="Address" value={w.address} span />
            </dl>
          </div>
          <div className="space-y-4">
            <KpiTile label="Total Units" value={num(summary?.total_units || 0)} tint="indigo" Icon={Box} />
            <KpiTile label="Inventory Value" value={naira(invValue)} tint="violet" Icon={Box} />
            <KpiTile label="SKUs Stocked" value={inventory.length} tint="emerald" Icon={Box} />
          </div>
        </section>
      )}

      {tab === "inventory" && (
        <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
              <tr>
                <th className="text-left py-3 px-6 font-medium">Product</th>
                <th className="text-left py-3 font-medium">SKU</th>
                <th className="text-right py-3 font-medium">Quantity</th>
                <th className="text-right py-3 font-medium">Reorder</th>
                <th className="text-right py-3 px-6 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((r) => {
                const p = byPid[r.product_id] || {};
                return (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="py-3 px-6 font-medium text-slate-800">{p.name || "—"}</td>
                    <td className="py-3 text-slate-600">{p.sku || "—"}</td>
                    <td className="py-3 text-right text-emerald-600 font-semibold">{num(r.quantity)}</td>
                    <td className="py-3 text-right text-slate-600">{num(r.reorder_level || 0)}</td>
                    <td className="py-3 px-6 text-right font-semibold text-slate-800">{naira((p.unit_price || 0) * (r.quantity || 0))}</td>
                  </tr>
                );
              })}
              {inventory.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-12">No inventory recorded for this warehouse.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "inbound" && <ShipmentList rows={grns} kind="GRN" />}
      {tab === "outbound" && <ShipmentList rows={dispatches} kind="DISPATCH" />}

      {(tab === "users" || tab === "transfers" || tab === "analytics" || tab === "settings") && (
        <Shell tab={tab} />
      )}

      {editing && <WarehouseDialog existing={w} onClose={() => { setEditing(false); reload(); }} />}
    </div>
  );
}

function Field({ label, value, span }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <dt className="text-xs uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800 mt-1">{value ?? "—"}</dd>
    </div>
  );
}

function ShipmentList({ rows, kind }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
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
              <td className="py-3 px-6 font-medium text-slate-800">{r.grn_number || r.tracking_code}</td>
              <td className="py-3 text-slate-700 text-xs">{r.supplier_name || `${r.to_role || ""}`}</td>
              <td className="py-3 text-slate-600">{r.items?.length || 0}</td>
              <td className="py-3"><span className="text-[11px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">{r.status}</span></td>
              <td className="py-3 px-6 text-right text-slate-500 text-xs">{r.received_at || r.created_at ? new Date(r.received_at || r.created_at).toLocaleString() : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-12">No records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Shell({ tab }) {
  const COPY = {
    users:     ["Users assigned to this warehouse", "Invite or remove warehouse staff; assign roles (Manager / Receiver / Picker)."],
    transfers: ["Stock Transfers", "Move stock between warehouses with full audit trail. Auto-decrement source on dispatch; auto-increment destination on receipt."],
    analytics: ["Warehouse Analytics", "Throughput, turnover, ageing, accuracy & utilisation trend lines."],
    settings:  ["Warehouse Settings", "Operating hours, notification channels, default reorder strategy."],
  }[tab];
  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-8">
      <div className="flex items-start gap-5">
        <div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 grid place-items-center shrink-0">
          <Construction className="h-7 w-7" />
        </div>
        <div className="flex-1">
          <div className="text-base font-bold text-slate-900">{COPY[0]}</div>
          <div className="text-sm text-slate-600 mt-1">{COPY[1]}</div>
          <div className="mt-5 inline-flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
            <AlertCircle className="h-3.5 w-3.5" /> This tab is wired into navigation; data model + CRUD will be activated in the next iteration.
          </div>
        </div>
      </div>
    </div>
  );
}
