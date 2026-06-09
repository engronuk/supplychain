// Inventory list + product drill-down detail.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { Search, Pencil, ArrowLeft, Package, AlertTriangle } from "lucide-react";
import { Api } from "@/lib/api";
import { PageHeader, Card, num, naira, Crumbs, StatusBadge } from "./ui";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function InventoryListPage() {
  const navigate = useNavigate();
  const { warehouseId } = useOutletContext();
  const [inv, setInv] = useState([]);
  const [products, setProducts] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState(null);

  const reload = () => {
    if (!warehouseId) return;
    Api.inventory("warehouse", warehouseId).then(setInv).catch(() => {});
    Api.products().then(setProducts).catch(() => {});
  };
  useEffect(reload, [warehouseId]);

  const rows = useMemo(() => {
    const byPid = Object.fromEntries(products.map((p) => [p.id, p]));
    const ql = q.trim().toLowerCase();
    return inv.map((r) => {
      const p = byPid[r.product_id] || {};
      return {
        ...r, product: p, name: p.name || "—", sku: p.sku || "—",
        category: p.category || "—", unit_price: p.unit_price || 0,
        value: (p.unit_price || 0) * (r.quantity || 0),
        low: (r.quantity || 0) < (r.reorder_level || 0),
      };
    }).filter((r) => {
      if (filter === "low" && !r.low) return false;
      if (!ql) return true;
      return r.name.toLowerCase().includes(ql) || r.sku.toLowerCase().includes(ql) || r.category.toLowerCase().includes(ql);
    });
  }, [inv, products, q, filter]);

  return (
    <div className="space-y-5">
      <PageHeader title="Inventory" subtitle="Manage stock levels across the warehouse" />

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, SKU, category…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            data-testid="inv-search" />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" data-testid="inv-filter">
          <option value="all">All Items</option>
          <option value="low">Low Stock Only</option>
        </select>
        <div className="text-sm text-slate-500">Showing <strong className="text-slate-900">{rows.length}</strong> of {inv.length}</div>
      </Card>

      <Card padding="p-0" className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 border-b border-slate-200 bg-slate-50/60">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Product</th>
              <th className="text-left py-3 font-medium">SKU</th>
              <th className="text-left py-3 font-medium">Category</th>
              <th className="text-left py-3 font-medium">Quantity</th>
              <th className="text-left py-3 font-medium">Reorder Level</th>
              <th className="text-right py-3 font-medium">Unit Price</th>
              <th className="text-right py-3 px-6 font-medium">Value</th>
              <th className="text-right py-3 px-6 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="py-4 px-6 font-medium text-slate-800 cursor-pointer" onClick={() => navigate(`/wms/inventory/${r.product_id}`)}>{r.name}</td>
                <td className="py-4 text-slate-600">{r.sku}</td>
                <td className="py-4 text-slate-600">{r.category}</td>
                <td className={`py-4 font-semibold ${r.low ? "text-rose-600" : "text-emerald-600"}`}>{num(r.quantity)} {r.low && <span className="ml-1 text-xs text-rose-600">low</span>}</td>
                <td className="py-4 text-slate-600">{num(r.reorder_level)}</td>
                <td className="py-4 text-right text-slate-700">{naira(r.unit_price)}</td>
                <td className="py-4 px-6 text-right font-semibold text-slate-800">{naira(r.value)}</td>
                <td className="py-4 px-6 text-right">
                  <button onClick={() => setEditing(r)} className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1" data-testid={`edit-${r.sku}`}>
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-12">No inventory matches your filters.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {editing && <EditInventoryDialog row={editing} onClose={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function EditInventoryDialog({ row, onClose }) {
  const [quantity, setQuantity] = useState(row.quantity);
  const [reorder, setReorder] = useState(row.reorder_level);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await Api.wmsUpdateInventory(row.id, { quantity: parseInt(quantity, 10), reorder_level: parseInt(reorder, 10) });
      toast.success("Inventory updated");
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm grid place-items-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="edit-inv-dialog">
        <div className="text-lg font-bold text-slate-900">Edit Inventory</div>
        <div className="text-sm text-slate-500 mb-5">{row.name} · {row.sku}</div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Quantity</label>
        <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-4" />
        <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Level</label>
        <input type="number" value={reorder} onChange={(e) => setReorder(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 mb-6" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </div>
    </div>
  );
}

export function InventoryDetailPage() {
  const { productId } = useParams();
  const { warehouseId } = useOutletContext();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!warehouseId || !productId) return;
    Api.wmsInventoryDetail(productId, warehouseId).then(setDetail).catch(() => {});
  }, [warehouseId, productId]);

  if (!detail) return <div className="text-slate-500">Loading product…</div>;
  const { product, quantities, batches, movements } = detail;

  return (
    <div className="space-y-5">
      <Crumbs items={[{ label: "Inventory", href: "/wms/inventory" }, { label: product.name }]} />

      <div className="flex items-start gap-5">
        <button onClick={() => navigate("/wms/inventory")} className="rounded-xl border border-slate-200 bg-white p-2"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{product.name}</h1>
          <div className="text-sm text-slate-500 mt-0.5">SKU <span className="font-medium text-slate-700">{product.sku}</span> · Barcode <span className="font-medium text-slate-700">{product.barcode || "—"}</span> · Category <span className="font-medium text-slate-700">{product.category}</span></div>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <QtyCard label="Available" value={quantities.available} tint="text-emerald-600" />
        <QtyCard label="Reserved" value={quantities.reserved} tint="text-blue-600" />
        <QtyCard label="Damaged" value={quantities.damaged} tint="text-amber-600" />
        <QtyCard label="Expired" value={quantities.expired} tint="text-rose-600" />
      </section>

      <Card padding="p-0" className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Batch Numbers</h2>
          <span className="text-xs text-slate-500">{batches.length} batches</span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Batch #</th>
              <th className="text-left py-3 font-medium">Quantity</th>
              <th className="text-left py-3 font-medium">Unit Cost</th>
              <th className="text-left py-3 font-medium">Manufactured</th>
              <th className="text-left py-3 font-medium">Expires</th>
              <th className="text-right py-3 px-6 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 px-6 font-medium text-slate-800">{b.batch_number}</td>
                <td className="py-3 text-emerald-600 font-semibold">{num(b.quantity)}</td>
                <td className="py-3 text-slate-700">{naira(b.unit_cost)}</td>
                <td className="py-3 text-slate-600">{b.manufactured_date}</td>
                <td className="py-3 text-slate-600">{b.expiry_date}</td>
                <td className="py-3 px-6 text-right"><StatusBadge status={b.status || "active"} /></td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-8">No batches recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card padding="p-0" className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">Movement History</h2>
          <span className="text-xs text-slate-500">{movements.length} entries</span>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-500 bg-slate-50/60 border-b border-slate-200">
            <tr>
              <th className="text-left py-3 px-6 font-medium">Type</th>
              <th className="text-left py-3 font-medium">Tracking</th>
              <th className="text-left py-3 font-medium">Quantity</th>
              <th className="text-left py-3 font-medium">When</th>
              <th className="text-right py-3 px-6 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="py-3 px-6 font-semibold text-slate-800">{m.type === "RECEIPT" ? <span className="text-emerald-600">↓ RECEIPT</span> : <span className="text-violet-600">↑ DISPATCH</span>}</td>
                <td className="py-3 text-slate-600">{m.tracking_code}</td>
                <td className="py-3 text-slate-800 font-semibold">{num(m.quantity)}</td>
                <td className="py-3 text-slate-500 text-xs">{new Date(m.created_at).toLocaleString()}</td>
                <td className="py-3 px-6 text-right"><StatusBadge status={m.status} /></td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr><td colSpan={5} className="text-center text-slate-400 py-8">No movements recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function QtyCard({ label, value, tint }) {
  return (
    <Card className="p-5">
      <div className="text-xs uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`text-3xl font-bold mt-2 ${tint}`}>{num(value)}</div>
    </Card>
  );
}
