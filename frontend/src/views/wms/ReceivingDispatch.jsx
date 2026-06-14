// Receiving (GRN list + create) and Dispatch (list + create + status).
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { Plus, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Card, PageHeader, StatusBadge, num, naira, EmptyState } from "./ui";

// -- shared item-builder ------------------------------------------------
function ItemBuilder({ products, items, setItems }) {
  const addItem = () => setItems([...items, { product_id: products[0]?.id || "", quantity: 1 }]);
  const updateItem = (idx, field, value) => {
    const next = [...items];
    next[idx][field] = value;
    setItems(next);
  };
  const removeItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-2">Line items</div>
      <div className="space-y-2 mb-2">
        {items.map((it, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select value={it.product_id} onChange={(e) => updateItem(idx, "product_id", e.target.value)} className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
            <input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", parseInt(e.target.value, 10) || 0)} className="w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm" placeholder="Qty" />
            <button type="button" onClick={() => removeItem(idx)} className="text-rose-600 text-xs">Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addItem} className="text-blue-600 text-sm font-medium">+ Add item</button>
    </div>
  );
}

export function ReceivingPage() {
  const { warehouseId } = useOutletContext();
  const [grns, setGrns] = useState([]);
  const [products, setProducts] = useState([]);
  const [params, setParams] = useSearchParams();
  const showNew = params.get("new") === "1";

  const reload = () => {
    if (!warehouseId) return;
    Api.wmsListGrns(warehouseId).then(setGrns).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
  };
  useEffect(reload, [warehouseId]);

  return (
    <div className="space-y-5">
      <PageHeader title="Receiving" subtitle="Receive shipments and create goods-receipt notes"
        actions={<Button onClick={() => setParams({ new: "1" })} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="new-grn-btn"><Plus className="h-4 w-4 mr-1" /> New Receipt</Button>} />
      <Card padding="p-0" className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-6 font-medium">GRN Number</th>
              <th className="text-left py-3 font-medium">Supplier</th>
              <th className="text-left py-3 font-medium">Reference</th>
              <th className="text-left py-3 font-medium">Lines</th>
              <th className="text-left py-3 font-medium">Received By</th>
              <th className="text-left py-3 font-medium">When</th>
              <th className="text-right py-3 px-6 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {grns.map((g) => (
              <tr key={g.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="py-3 px-6 font-medium text-slate-800">{g.grn_number}</td>
                <td className="py-3 text-slate-700">{g.supplier_name || "—"}</td>
                <td className="py-3 text-slate-600">{g.reference || "—"}</td>
                <td className="py-3 text-slate-600">{g.items?.length || 0}</td>
                <td className="py-3 text-slate-600 text-xs">{g.received_by}</td>
                <td className="py-3 text-slate-500 text-xs">{new Date(g.received_at).toLocaleString()}</td>
                <td className="py-3 px-6 text-right"><StatusBadge status={g.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {grns.length === 0 && (
          <EmptyState title="No receipts yet" description="Create a goods-receipt note to record inbound stock." />
        )}
      </Card>
      {showNew && <NewGrnDialog products={products} warehouseId={warehouseId} onClose={() => { setParams({}); reload(); }} />}
    </div>
  );
}

function NewGrnDialog({ products, warehouseId, onClose }) {
  const [items, setItems] = useState([{ product_id: products[0]?.id || "", quantity: 1 }]);
  const [supplier, setSupplier] = useState("");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!items.length) return toast.error("Add at least one line item");
    setSaving(true);
    try {
      const grn = await Api.wmsCreateGrn({
        warehouse_id: warehouseId, supplier_name: supplier, reference: ref,
        items, notes,
      });
      toast.success(`Created ${grn.grn_number}`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Create failed");
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm grid place-items-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="new-grn-dialog">
        <div className="text-lg font-bold text-slate-900 mb-1">New Goods Receipt</div>
        <div className="text-sm text-slate-500 mb-5">Record an inbound shipment.</div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Supplier name</label>
        <input value={supplier} onChange={(e) => setSupplier(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-3" placeholder="e.g. Golden Valley Suppliers" />
        <label className="block text-xs font-medium text-slate-600 mb-1">Reference / PO #</label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-4" placeholder="Optional" />
        <ItemBuilder products={products} items={items} setItems={setItems} />
        <label className="block text-xs font-medium text-slate-600 mb-1 mt-4">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-6" rows={2} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-grn">{saving ? "Saving…" : "Receive shipment"}</Button>
        </div>
      </div>
    </div>
  );
}

export function DispatchPage() {
  const { warehouseId } = useOutletContext();
  const [dispatches, setDispatches] = useState([]);
  const [products, setProducts] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [params, setParams] = useSearchParams();
  const showNew = params.get("new") === "1";

  const reload = () => {
    if (!warehouseId) return;
    Api.wmsListDispatches(warehouseId).then(setDispatches).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
    Api.organizations({ organization_type: "distributor" }).then(setDistributors).catch(() => {});
  };
  useEffect(reload, [warehouseId]);

  const advance = async (d) => {
    const next = { dispatched: "in_transit", in_transit: "delivered" }[d.status];
    if (!next) return;
    try {
      await Api.wmsUpdateDispatchStatus(d.id, next);
      toast.success(`Marked ${next.replace("_", " ")}`);
      reload();
    } catch (e) { toast.error("Update failed"); }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Dispatch" subtitle="Send goods to your distributors — your direct downstream tier"
        actions={<Button onClick={() => setParams({ new: "1" })} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="new-dispatch-btn"><Plus className="h-4 w-4 mr-1" /> New Dispatch</Button>} />
      <Card padding="p-0" className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Tracking</th>
              <th className="text-left py-3 font-medium">To</th>
              <th className="text-left py-3 font-medium">Lines</th>
              <th className="text-left py-3 font-medium">When</th>
              <th className="text-left py-3 font-medium">Status</th>
              <th className="text-right py-3 px-6 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {dispatches.map((d) => (
              <tr key={d.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 px-6 font-medium text-slate-800">{d.tracking_code}</td>
                <td className="py-3 text-slate-700 text-xs">{d.to_role} · {d.to_id?.slice(0, 8)}…</td>
                <td className="py-3 text-slate-600">{d.items?.length || 0}</td>
                <td className="py-3 text-slate-500 text-xs">{new Date(d.created_at).toLocaleString()}</td>
                <td className="py-3"><StatusBadge status={d.status} /></td>
                <td className="py-3 px-6 text-right">
                  {(d.status === "dispatched" || d.status === "in_transit") && (
                    <button onClick={() => advance(d)} className="text-blue-600 hover:underline text-xs font-medium" data-testid={`advance-${d.id.slice(0,6)}`}>Advance →</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {dispatches.length === 0 && (
          <EmptyState title="No dispatches yet" description="Create a dispatch to send goods out of this warehouse." />
        )}
      </Card>
      {showNew && <NewDispatchDialog products={products} distributors={distributors} warehouseId={warehouseId} onClose={() => { setParams({}); reload(); }} />}
    </div>
  );
}

function NewDispatchDialog({ products, distributors, warehouseId, onClose }) {
  const [items, setItems] = useState([{ product_id: products[0]?.id || "", quantity: 1 }]);
  const [toId, setToId] = useState(distributors[0]?.id || "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!toId) return toast.error("Pick a destination");
    setSaving(true);
    try {
      const d = await Api.wmsCreateDispatch({
        warehouse_id: warehouseId, to_id: toId, to_role: "distributor",
        items, notes, status: "dispatched",
      });
      toast.success(`Dispatched ${d.tracking_code}`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Dispatch failed");
    } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm grid place-items-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-xl shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="new-dispatch-dialog">
        <div className="text-lg font-bold text-slate-900 mb-1">Create Dispatch</div>
        <div className="text-sm text-slate-500 mb-5">Send goods out of this warehouse.</div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Destination distributor</label>
        <select value={toId} onChange={(e) => setToId(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-4">
          {distributors.map((d) => <option key={d.id} value={d.id}>{d.organization_code} — {d.organization_name}</option>)}
        </select>
        <ItemBuilder products={products} items={items} setItems={setItems} />
        <label className="block text-xs font-medium text-slate-600 mb-1 mt-4">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-6" rows={2} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="save-dispatch">{saving ? "Saving…" : "Create dispatch"}</Button>
        </div>
      </div>
    </div>
  );
}
