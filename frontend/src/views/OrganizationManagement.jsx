/**
 * Organization Management Module.
 *
 * Universal supply-chain hierarchy admin for super_admin + supply chain
 * participants. The page offers two synchronized views:
 *   • List (filterable by type / region / status / search)
 *   • Hierarchy tree (expand / collapse, badges per type)
 *
 * The "Create organization" dialog is gated by the back-end's
 * /organizations/me/permissions endpoint, so the available types and
 * parent options are dictated by the calling user's role in the
 * supply chain rather than hard-coded in the UI.
 */
import { useEffect, useMemo, useState } from "react";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Factory, Warehouse, Truck, Store, ShoppingBag, MapPin,
  Building2, Plus, ChevronDown, ChevronRight, Network, ListChecks,
  Loader2, Sparkles, Search,
} from "lucide-react";
import { toast } from "sonner";

const TYPE_META = {
  manufacturer:      { label: "Manufacturer",      icon: Factory,     chip: "bg-violet-100 text-violet-800" },
  warehouse:         { label: "Warehouse",         icon: Warehouse,   chip: "bg-blue-100 text-blue-800" },
  distributor:       { label: "Distributor",       icon: Truck,       chip: "bg-amber-100 text-amber-800" },
  wholesaler:        { label: "Wholesaler",        icon: ShoppingBag, chip: "bg-fuchsia-100 text-fuchsia-800" },
  retailer:          { label: "Retailer",          icon: Store,       chip: "bg-emerald-100 text-emerald-800" },
  logistics_provider:{ label: "Logistics",         icon: MapPin,      chip: "bg-slate-200 text-slate-800" },
};
const STATUS_META = {
  active:    "bg-emerald-100 text-emerald-800",
  inactive:  "bg-slate-200 text-slate-700",
  suspended: "bg-rose-100 text-rose-800",
};

export default function OrganizationManagement() {
  const [perms, setPerms] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState({ type: "all", status: "all", region: "", q: "" });
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Promise.all([
      Api.myOrgPermissions().catch(() => null),
      Api.organizations({}).catch(() => []),
    ]).then(([p, list]) => {
      if (cancelled) return;
      setPerms(p);
      setOrgs(list || []);
      setLoading(false);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const filtered = useMemo(() => {
    return orgs.filter((o) => {
      if (filters.type !== "all" && o.organization_type !== filters.type) return false;
      if (filters.status !== "all" && o.status !== filters.status) return false;
      if (filters.region && !(o.region || "").toLowerCase().includes(filters.region.toLowerCase())) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (!(`${o.organization_name} ${o.organization_code}`).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [orgs, filters]);

  const counts = useMemo(() => {
    const c = { total: orgs.length };
    for (const o of orgs) {
      c[o.organization_type] = (c[o.organization_type] || 0) + 1;
    }
    return c;
  }, [orgs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="organization-management">
      <div className="px-8 py-7 max-w-[1600px] mx-auto space-y-6">
        <Header counts={counts} perms={perms} onCreate={() => setCreateOpen(true)} />

        <Tabs defaultValue="list">
          <TabsList className="bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 h-auto">
            <TabsTrigger value="list" data-testid="orgs-tab-list"
                         className="rounded-xl px-4 h-10 text-sm font-medium gap-2 data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <ListChecks className="h-4 w-4" /> List
            </TabsTrigger>
            <TabsTrigger value="tree" data-testid="orgs-tab-tree"
                         className="rounded-xl px-4 h-10 text-sm font-medium gap-2 data-[state=active]:bg-slate-900 data-[state=active]:text-white">
              <Network className="h-4 w-4" /> Hierarchy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="mt-5 space-y-4">
            <FiltersBar filters={filters} setFilters={setFilters} />
            <OrgList rows={filtered} onEdit={setEditTarget} perms={perms} />
          </TabsContent>
          <TabsContent value="tree" className="mt-5">
            <HierarchyTree />
          </TabsContent>
        </Tabs>

        {createOpen && (
          <CreateEditDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            perms={perms}
            allOrgs={orgs}
            onSaved={() => { setCreateOpen(false); reload(); }}
          />
        )}
        {editTarget && (
          <CreateEditDialog
            open={!!editTarget}
            target={editTarget}
            onOpenChange={(o) => !o && setEditTarget(null)}
            perms={perms}
            allOrgs={orgs}
            onSaved={() => { setEditTarget(null); reload(); }}
          />
        )}
      </div>
    </div>
  );
}

function Header({ counts, perms, onCreate }) {
  const canCreate = perms?.can_manage && (perms?.can_create_types || []).length > 0;
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-violet-700 font-semibold mb-1">
          <Sparkles className="h-3 w-3" /> Organization Management
        </div>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Supply Chain Network</h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
          {perms?.is_super_admin
            ? "You have full visibility across every organization in the network."
            : <>You manage organizations within <span className="font-medium text-slate-700">{perms?.user_org_name}</span>.</>}
          {" "}{counts.total.toLocaleString()} organizations in scope.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {Object.entries(TYPE_META).map(([k, v]) => (
            <span key={k} className={`inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 font-semibold ${v.chip}`}>
              <v.icon className="h-3 w-3" /> {v.label}: {counts[k] || 0}
            </span>
          ))}
        </div>
      </div>
      {canCreate && (
        <Button onClick={onCreate} className="bg-violet-700 hover:bg-violet-800 text-white shrink-0"
                data-testid="open-create-org">
          <Plus className="h-4 w-4 mr-1.5" /> Create organization
        </Button>
      )}
    </div>
  );
}

function FiltersBar({ filters, setFilters }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200">
      <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Select value={filters.type} onValueChange={(v) => setFilters({ ...filters, type: v })}>
          <SelectTrigger data-testid="filter-org-type"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_META).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
          <SelectTrigger data-testid="filter-org-status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Input
          placeholder="Region filter"
          value={filters.region}
          onChange={(e) => setFilters({ ...filters, region: e.target.value })}
          data-testid="filter-org-region"
        />
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search name or code…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            className="pl-9"
            data-testid="filter-org-search"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function OrgList({ rows, onEdit, perms }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden" data-testid="org-list">
      {rows.length === 0 ? (
        <CardContent className="p-12 text-center text-slate-400">
          <Building2 className="h-8 w-8 mx-auto text-slate-300 mb-2" />
          No organizations match your filters.
        </CardContent>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Code</th>
                <th className="text-left px-5 py-3 font-semibold">Name</th>
                <th className="text-left px-5 py-3 font-semibold">Type</th>
                <th className="text-left px-5 py-3 font-semibold">Region</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-right px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice(0, 500).map((o) => {
                const meta = TYPE_META[o.organization_type] || { icon: Building2, chip: "bg-slate-100", label: o.organization_type };
                const Icon = meta.icon;
                return (
                  <tr key={o.id} className="hover:bg-violet-50/40" data-testid={`org-row-${o.organization_code}`}>
                    <td className="px-5 py-3 font-mono text-slate-500">{o.organization_code}</td>
                    <td className="px-5 py-3 font-medium text-slate-900">{o.organization_name}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 text-[11px] font-semibold ${meta.chip}`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{o.region || "—"}</td>
                    <td className="px-5 py-3">
                      <Badge variant="outline" className={`${STATUS_META[o.status] || ""} border-transparent`}>
                        {o.status || "—"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {perms?.can_manage && (
                        <Button size="sm" variant="outline" onClick={() => onEdit(o)} data-testid={`edit-org-${o.organization_code}`}>
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 500 && (
            <div className="p-3 text-center text-[12px] text-slate-400 bg-slate-50 border-t border-slate-100">
              Showing first 500 of {rows.length} — refine filters to narrow further.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function HierarchyTree() {
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.myOrgNetwork()
      .then((t) => { if (!cancelled) { setTree(t); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  if (loading || !tree) {
    return (
      <Card className="rounded-2xl shadow-sm border-slate-200 p-10 text-center text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
      </Card>
    );
  }
  // Flatten the tree into a render list with depth so we don't need a
  // recursive component (Babel's AST traversal sometimes blows the stack
  // on deeply self-referential JSX).
  const flat = [];
  const walk = (node, depth) => {
    const isOpen = expanded[node.id] ?? depth < 1;
    flat.push({ node, depth, isOpen });
    if (isOpen) {
      for (const c of node.children || []) walk(c, depth + 1);
    }
  };
  walk(tree, 0);
  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !(e[id] ?? false) }));
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200" data-testid="org-tree">
      <CardContent className="p-5">
        {flat.map(({ node, depth, isOpen }) => {
          const children = node.children || [];
          const meta = TYPE_META[node.organization_type] || { icon: Building2, chip: "bg-slate-100", label: node.organization_type || "Group" };
          const Icon = meta.icon;
          return (
            <div
              key={node.id || "__root__"}
              className="flex items-center gap-2 py-1.5 hover:bg-slate-50 rounded-lg px-2 cursor-pointer"
              onClick={() => toggle(node.id)}
              style={{ paddingLeft: depth * 18 + 8 }}
              data-testid={`tree-node-${node.organization_code || "root"}`}
            >
              <span className="h-4 w-4 inline-flex items-center justify-center shrink-0 text-slate-400">
                {children.length > 0 ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="h-3.5 w-3.5" />}
              </span>
              <span className={`inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 text-[11px] font-semibold shrink-0 ${meta.chip}`}>
                <Icon className="h-3 w-3" /> {meta.label}
              </span>
              <span className="font-medium text-slate-900 truncate">{node.organization_name}</span>
              {node.organization_code && (
                <span className="font-mono text-[10px] text-slate-400 ml-2">{node.organization_code}</span>
              )}
              {children.length > 0 && (
                <span className="ml-auto text-[10px] text-slate-400 tabular-nums">{children.length} below</span>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CreateEditDialog({ open, onOpenChange, perms, allOrgs, target, onSaved }) {
  const isEdit = !!target;
  const [type, setType] = useState(target?.organization_type || perms?.can_create_types?.[0] || "");
  const [name, setName] = useState(target?.organization_name || "");
  const [parentId, setParentId] = useState(target?.parent_organization_id || perms?.user_org_id || "");
  const [region, setRegion] = useState(target?.region || "");
  const [state, setState] = useState(target?.state || "");
  const [city, setCity] = useState(target?.city || "");
  const [address, setAddress] = useState(target?.address || "");
  const [email, setEmail] = useState(target?.contact_email || "");
  const [phone, setPhone] = useState(target?.contact_phone || "");
  const [status, setStatus] = useState(target?.status || "active");
  const [saving, setSaving] = useState(false);

  const allowedTypes = perms?.is_super_admin
    ? Object.keys(TYPE_META)
    : (perms?.can_create_types || []);

  // Parent options: organizations whose type allows this child type.
  const PARENT_OF_CHILD = {
    warehouse: "manufacturer",
    distributor: "manufacturer",
    wholesaler: "distributor",
    retailer: "wholesaler",
  };
  const requiredParentType = PARENT_OF_CHILD[type];
  const parentOptions = allOrgs.filter((o) =>
    !requiredParentType || o.organization_type === requiredParentType
  );

  const submit = async () => {
    if (!name || !type) { toast.error("Name and type required"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await Api.updateOrganization(target.id, {
          organization_name: name, region, state, city, address,
          contact_email: email || null, contact_phone: phone || null,
          status, parent_organization_id: parentId || null,
        });
        toast.success("Organization updated");
      } else {
        await Api.createOrganization({
          organization_name: name, organization_type: type,
          parent_organization_id: parentId || null,
          region, state, city, address, status,
          contact_email: email || null, contact_phone: phone || null,
        });
        toast.success("Organization created");
      }
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit organization" : "Create new organization"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update organization details." : "Add a new organization to your network. The supply-chain hierarchy enforces what types you can create."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!isEdit && (
            <div>
              <Label>Organization Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="org-form-type"><SelectValue placeholder="Pick a type" /></SelectTrigger>
                <SelectContent>
                  {allowedTypes.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_META[t]?.label || t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Organization Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="org-form-name" />
          </div>
          {requiredParentType && (
            <div>
              <Label>Parent ({TYPE_META[requiredParentType]?.label})</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger data-testid="org-form-parent"><SelectValue placeholder="Select parent" /></SelectTrigger>
                <SelectContent>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.organization_name} ({o.organization_code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Region</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} data-testid="org-form-region" />
            </div>
            <div>
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} data-testid="org-form-state" />
            </div>
            <div>
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} data-testid="org-form-city" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="org-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="org-form-address" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="org-form-email" />
            </div>
            <div>
              <Label>Contact phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="org-form-phone" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-violet-700 hover:bg-violet-800 text-white"
                  data-testid="org-form-save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
