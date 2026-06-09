// Warehouses (manufacturer-side CRUD) + Alerts + simple shells for the rest.
import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { Plus, AlertTriangle, Building2, Construction } from "lucide-react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Card, PageHeader, EmptyState } from "./ui";

// ---------------------------------------------------------------------------
// Warehouses (manufacturer-side)
// ---------------------------------------------------------------------------
export function WarehousesPage() {
  const [orgs, setOrgs] = useState([]);
  const [creating, setCreating] = useState(false);
  const [perms, setPerms] = useState(null);

  const reload = () => Api.organizations({ organization_type: "warehouse" }).then(setOrgs).catch(() => {});
  useEffect(() => {
    reload();
    Api.myOrgPermissions().then(setPerms).catch(() => {});
  }, []);

  const canCreate = (perms?.can_create_types || []).includes("warehouse");
  return (
    <div className="space-y-5">
      <PageHeader title="Warehouses" subtitle="Manage your tenant's warehouse network"
        actions={canCreate && <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="new-warehouse-btn"><Plus className="h-4 w-4 mr-1" /> New Warehouse</Button>} />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orgs.map((w) => (
          <Card key={w.id} className="p-5 hover:shadow-md transition cursor-pointer" data-testid={`wh-card-${w.organization_code}`}>
            <div className="flex items-start justify-between">
              <div className="h-12 w-12 rounded-xl bg-blue-50 text-blue-600 grid place-items-center"><Building2 className="h-6 w-6" /></div>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md uppercase">{w.status}</span>
            </div>
            <div className="mt-4">
              <div className="text-base font-bold text-slate-900">{w.organization_name}</div>
              <div className="text-xs text-slate-500 mt-0.5">{w.organization_code} · {w.region}{w.city ? ` · ${w.city}` : ""}</div>
            </div>
          </Card>
        ))}
        {orgs.length === 0 && (
          <div className="col-span-full">
            <EmptyState title="No warehouses yet" description="Add a regional warehouse to start tracking inventory positions." />
          </div>
        )}
      </div>
      {creating && <NewWarehouseDialog perms={perms} onClose={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function NewWarehouseDialog({ perms, onClose }) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("Lagos");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      await Api.createOrganization({
        organization_name: name, organization_type: "warehouse",
        parent_organization_id: perms?.user_org_id, region, city,
        status: "active",
      });
      toast.success("Warehouse created");
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Create failed");
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm grid place-items-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="new-wh-dialog">
        <div className="text-lg font-bold text-slate-900 mb-1">New Warehouse</div>
        <div className="text-sm text-slate-500 mb-5">Add a warehouse to your tenant network.</div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-3" />
        <label className="block text-xs font-medium text-slate-600 mb-1">Region</label>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-3">
          {["Lagos","South West","South East","South South","North Central","North East","North West"].map((r) => <option key={r}>{r}</option>)}
        </select>
        <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
        <input value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-6" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-wh">{saving ? "Saving…" : "Create warehouse"}</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export function AlertsPage() {
  const { warehouseId } = useOutletContext();
  const [alerts, setAlerts] = useState([]);
  const [params] = useSearchParams();
  const focusId = params.get("id");

  useEffect(() => {
    if (!warehouseId) return;
    Api.wmsListAlerts(warehouseId).then((d) => setAlerts(d.alerts || [])).catch(() => {});
  }, [warehouseId]);

  const TINT = {
    high: "bg-rose-50 text-rose-600 border-rose-200",
    medium: "bg-amber-50 text-amber-600 border-amber-200",
    low: "bg-blue-50 text-blue-600 border-blue-200",
  };
  return (
    <div className="space-y-5">
      <PageHeader title="Alerts" subtitle={`${alerts.length} active alerts requiring your attention`} />
      <ul className="space-y-3">
        {alerts.map((a) => (
          <Card key={a.id} className={`p-4 flex items-start gap-4 ${focusId === a.id ? "ring-2 ring-blue-500/40" : ""}`} data-testid={`alert-${a.id}`}>
            <div className={`h-12 w-12 rounded-xl grid place-items-center border ${TINT[a.severity] || TINT.low}`}>
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-bold text-slate-900">{a.title}</div>
                <div className="text-[11px] text-slate-400 shrink-0">{a.at ? new Date(a.at).toLocaleString() : ""}</div>
              </div>
              <div className="text-sm text-slate-600 mt-1 leading-snug">{a.message}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{a.kind}</span>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md ${a.severity === "high" ? "bg-rose-100 text-rose-700" : a.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{a.severity || "low"}</span>
              </div>
            </div>
          </Card>
        ))}
        {alerts.length === 0 && (
          <EmptyState title="No alerts" description="Your warehouse is operating within thresholds. New alerts will appear here automatically." />
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Functional shells for low-priority pages
// ---------------------------------------------------------------------------
function Shell({ title, subtitle, points }) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="p-8">
        <div className="flex items-start gap-5">
          <div className="h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 grid place-items-center shrink-0">
            <Construction className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <div className="text-base font-bold text-slate-900">Module under construction</div>
            <div className="text-sm text-slate-600 mt-1">{subtitle}</div>
            {points && (
              <ul className="mt-4 space-y-2 text-sm text-slate-700 list-disc list-inside">
                {points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
            <div className="mt-5 text-xs text-slate-500">This page is fully wired into the WMS navigation. The data model and CRUD endpoints will be activated in the next iteration.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export const TransfersPage = () => <Shell title="Transfers" subtitle="Move stock between warehouses"
  points={["Create warehouse-to-warehouse transfer", "Track in-transit quantities", "Auto-decrement source on dispatch, increment destination on receipt"]} />;
export const ReturnsPage = () => <Shell title="Returns" subtitle="Manage inbound returns from distributors and retailers"
  points={["RMA workflow", "Restock vs scrap decisions", "Refund tracking"]} />;
export const CycleCountsPage = () => <Shell title="Cycle Counts" subtitle="Plan and reconcile physical inventory counts"
  points={["Schedule count cycles by zone", "Capture counted quantities on a tablet", "Compare vs system, flag variances above threshold"]} />;
export const ReportsPage = () => <Shell title="Reports" subtitle="Operational and analytical reports"
  points={["Inventory ageing report", "Receiving / dispatch throughput", "Cycle count accuracy", "Export to CSV / XLSX"]} />;
export const LocationsPage = () => <Shell title="Locations" subtitle="Bin-level storage map for this warehouse"
  points={["Aisle / Rack / Bin hierarchy", "Drag-and-drop assignment", "Capacity per bin", "Pick-path optimisation"]} />;
export const UsersPage = () => <Shell title="Users & Roles" subtitle="Manage who can access this warehouse"
  points={["Invite warehouse staff", "Assign roles (Manager / Receiver / Picker)", "Audit log of edits"]} />;
export const ProductsPage = () => <Shell title="Products" subtitle="Product master for this tenant"
  points={["Read-only view of master products", "Filter by category, brand", "Drill into per-warehouse inventory"]} />;
export const SettingsPage = () => <Shell title="Settings" subtitle="Configure this warehouse"
  points={["Capacity (m² / pallets)", "Operating hours", "Default reorder strategy", "Notifications channels"]} />;
