import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PageHeader, StatusBadge, fmtCurrency, fmtNumber, EmptyState, KpiCard,
} from "./wholesaler/ui";
import {
  ShoppingCart, Plus, RefreshCw, ChevronRight, Truck, Sparkles,
} from "lucide-react";

const PROGRESS_STEPS = [
  "draft", "submitted", "approved", "allocated", "shipped", "delivered",
];

const ACTION_LABELS = {
  submit:   "Submit",
  approve:  "Approve",
  reject:   "Reject",
  allocate: "Allocate",
  ship:     "Ship",
  deliver:  "Deliver",
  cancel:   "Cancel",
};

const ACTIONS_BY_STATUS = {
  draft:      ["submit", "cancel"],
  submitted:  ["approve", "reject", "cancel"],
  approved:   ["allocate", "cancel"],
  allocated:  ["ship"],
  shipped:    ["deliver"],
  delivered:  [],
  rejected:   [],
  cancelled:  [],
};

export default function WholesalerProcurement({ embedded = false }) {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [pos, setPos] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState(null);

  const refresh = () => {
    if (!wid) return;
    setLoading(true);
    Promise.all([
      WholesalerApi.purchaseOrders(wid),
      WholesalerApi.suppliers(wid),
      WholesalerApi.catalog(wid),
    ])
      .then(([p, s, c]) => { setPos(p); setSuppliers(s); setCatalog(c); })
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [wid]);

  const summary = useMemo(() => {
    const acc = { draft: 0, submitted: 0, approved: 0, allocated: 0, shipped: 0, delivered: 0, total_value: 0 };
    for (const p of pos) {
      acc[p.status] = (acc[p.status] || 0) + 1;
      acc.total_value += Number(p.total_amount || 0);
    }
    return acc;
  }, [pos]);

  return (
    <div className={embedded ? "space-y-6" : "p-6 md:p-8 space-y-6"} data-testid="wholesaler-procurement">
      {!embedded && (
        <PageHeader
          title="Procurement Workspace"
          subtitle="Replenish your hub from distributors (primary) or factory/warehouses (legacy / key-account)."
          action={
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refresh} data-testid="po-refresh">
                <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
              </Button>
              <Button size="sm" onClick={() => setCreating(true)} data-testid="po-new-btn">
                <Plus className="h-4 w-4 mr-1.5" /> New Purchase Order
              </Button>
            </div>
          }
        />
      )}
      {embedded && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={refresh} data-testid="po-refresh">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating(true)} data-testid="po-new-btn">
            <Plus className="h-4 w-4 mr-1.5" /> New Purchase Order
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          testid="po-summary-pending"
          icon={ShoppingCart}
          label="Pending POs"
          value={fmtNumber((summary.draft || 0) + (summary.submitted || 0) + (summary.approved || 0))}
          tone="warning"
        />
        <KpiCard
          testid="po-summary-in-transit"
          icon={Truck}
          label="Allocated / Shipped"
          value={fmtNumber((summary.allocated || 0) + (summary.shipped || 0))}
        />
        <KpiCard
          testid="po-summary-delivered"
          icon={Truck}
          label="Delivered (Cycle)"
          value={fmtNumber(summary.delivered || 0)}
        />
        <KpiCard
          testid="po-summary-total-value"
          icon={Sparkles}
          label="Total PO Value"
          value={fmtCurrency(summary.total_value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-sm text-slate-500">Loading purchase orders…</div>
          ) : pos.length === 0 ? (
            <EmptyState
              title="No purchase orders yet"
              body="Create your first PO to start replenishing your hub."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4 mr-1.5" /> New Purchase Order
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {pos.map((po) => (
                <POCard key={po.id} po={po} onOpen={() => setActive(po)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreatePOModal
        open={creating}
        onClose={() => setCreating(false)}
        wid={wid}
        suppliers={suppliers}
        catalog={catalog}
        onSuccess={() => { setCreating(false); refresh(); }}
      />

      <PODetailModal
        po={active}
        onClose={() => setActive(null)}
        wid={wid}
        onSuccess={() => { setActive(null); refresh(); }}
      />
    </div>
  );
}

function POCard({ po, onOpen }) {
  const stepIdx = PROGRESS_STEPS.indexOf(po.status);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left p-4 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all"
      data-testid={`po-card-${po.po_number}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{po.po_number}</span>
            <StatusBadge status={po.status} />
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {po.supplier_type} · {po.supplier_name || po.supplier_code || "—"} ·
            {" "}{new Date(po.created_at).toLocaleDateString()}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-800">
            {fmtCurrency(po.total_amount)}
          </div>
          <div className="text-xs text-slate-500">
            {fmtNumber(po.total_units)} units · {(po.items || []).length} lines
          </div>
        </div>
      </div>

      {/* Progress strip (only show if active) */}
      {!["cancelled", "rejected"].includes(po.status) && (
        <div className="mt-3 flex items-center gap-1">
          {PROGRESS_STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-violet-500" : "bg-slate-100"}`}
              title={s}
            />
          ))}
        </div>
      )}
      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-slate-400">
        {PROGRESS_STEPS.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </button>
  );
}

function CreatePOModal({ open, onClose, wid, suppliers, catalog, onSuccess }) {
  const [supplierId, setSupplierId] = useState("");
  const [items, setItems] = useState([{ product_id: "", quantity: 100, unit_cost: 0 }]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSupplierId(suppliers[0]?.id || "");
      setItems([{ product_id: catalog[0]?.id || "", quantity: 100, unit_cost: catalog[0]?.unit_price ? Math.round(catalog[0].unit_price * 0.8) : 0 }]);
      setNote("");
    }
  }, [open, suppliers, catalog]);

  const supplier = suppliers.find((s) => s.id === supplierId);
  const total = items.reduce((acc, it) =>
    acc + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0);

  const updateItem = (idx, key, val) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, { product_id: "", quantity: 100, unit_cost: 0 }]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!supplier || items.length === 0) return;
    setSaving(true);
    try {
      const cleanItems = items
        .filter((it) => it.product_id && Number(it.quantity) > 0)
        .map((it) => ({
          product_id: it.product_id,
          quantity: Number(it.quantity),
          unit_cost: Number(it.unit_cost) || 0,
        }));
      if (cleanItems.length === 0) {
        toast.error("Add at least one line item");
        setSaving(false);
        return;
      }
      const po = await WholesalerApi.createPO(wid, {
        supplier_id: supplier.id,
        supplier_type: supplier.type,
        items: cleanItems,
        note: note || undefined,
      });
      // Auto-submit the PO (skip "draft" stage to keep the UX tight)
      await WholesalerApi.transitionPO(wid, po.id, {
        action: "submit", actor: "wholesaler", note: "Submitted via PO wizard",
      });
      toast.success(`PO ${po.po_number} submitted`);
      onSuccess();
    } catch (e) {
      toast.error("Failed to create PO");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="create-po-modal">
        <DialogHeader>
          <DialogTitle>New Purchase Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger data-testid="po-supplier"><SelectValue placeholder="Pick supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.type === "distributor" ? "🚛" : s.type === "manufacturer" ? "🏭" : "🏬"}{" "}
                    {s.name} ({s.code})
                    {s.is_primary ? " · primary" : s.note ? ` · ${s.note}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Line Items</Label>
              <Button variant="ghost" size="sm" onClick={addItem} data-testid="po-add-line">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2 rounded-lg border border-slate-100" data-testid={`po-line-${idx}`}>
                  <Select
                    value={it.product_id}
                    onValueChange={(v) => {
                      const prod = catalog.find((p) => p.id === v);
                      updateItem(idx, "product_id", v);
                      if (prod?.unit_price) updateItem(idx, "unit_cost", Math.round(prod.unit_price * 0.8));
                    }}
                  >
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Pick product" /></SelectTrigger>
                    <SelectContent>
                      {catalog.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} · {p.sku} (on-hand {p.on_hand})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-24"
                    type="number" min={1}
                    placeholder="Qty"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                  />
                  <Input
                    className="w-28"
                    type="number" min={0}
                    placeholder="Unit cost"
                    value={it.unit_cost}
                    onChange={(e) => updateItem(idx, "unit_cost", e.target.value)}
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeItem(idx)} disabled={items.length === 1}>×</Button>
                </div>
              ))}
            </div>
            <div className="text-right text-sm font-medium text-slate-700 mt-2">
              Total: {fmtCurrency(total)}
            </div>
          </div>

          <div>
            <Label htmlFor="po-note">Note (optional)</Label>
            <Textarea id="po-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !supplier} data-testid="po-submit">
            {saving ? "Submitting…" : "Submit PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PODetailModal({ po, onClose, wid, onSuccess }) {
  const [saving, setSaving] = useState(false);
  if (!po) return null;

  const actions = ACTIONS_BY_STATUS[po.status] || [];

  const doAction = async (action) => {
    setSaving(true);
    try {
      await WholesalerApi.transitionPO(wid, po.id, { action, actor: "wholesaler" });
      toast.success(`PO ${ACTION_LABELS[action].toLowerCase()}d`);
      onSuccess();
    } catch (e) {
      const detail = e?.response?.data?.detail || "Action failed";
      toast.error(detail);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!po} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="po-detail-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {po.po_number} <StatusBadge status={po.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Supplier</div>
              <div className="font-medium">{po.supplier_name} ({po.supplier_type})</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Created</div>
              <div className="font-medium">{new Date(po.created_at).toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Total Units</div>
              <div className="font-medium">{fmtNumber(po.total_units)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider">Total Amount</div>
              <div className="font-medium">{fmtCurrency(po.total_amount)}</div>
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Line Items</div>
            <div className="rounded-lg border border-slate-100 divide-y divide-slate-100">
              {(po.items || []).map((it, idx) => (
                <div key={idx} className="px-3 py-2 flex justify-between text-sm">
                  <span>{it.product_name || it.product_id} {it.sku ? `· ${it.sku}` : ""}</span>
                  <span className="text-slate-600">
                    {fmtNumber(it.quantity)} × {fmtCurrency(it.unit_cost)} = {fmtCurrency(it.line_total)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {po.status_history?.length > 0 && (
            <div>
              <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Timeline</div>
              <div className="space-y-1.5">
                {po.status_history.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                    <ChevronRight className="h-3 w-3 text-slate-400" />
                    <StatusBadge status={ev.status} />
                    <span className="text-slate-400">{new Date(ev.at).toLocaleString()}</span>
                    {ev.note && <span className="text-slate-500">— {ev.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === "reject" || a === "cancel" ? "outline" : "default"}
              onClick={() => doAction(a)}
              disabled={saving}
              data-testid={`po-action-${a}`}
              className={
                a === "reject" || a === "cancel"
                  ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                  : ""
              }
            >
              {ACTION_LABELS[a]}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
