/**
 * Cart Tab — server-persisted cart grouped by supplier with row editing,
 * subtotal preview and submit-to-PO action.
 */
import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  ShoppingCart, Trash2, Package, Truck, Send, Loader2, Plus, X,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import AddCartItemDialog from "./AddCartItemDialog";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function CartTab({ retailerId, onMutated }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.cart(retailerId)
      .then((d) => { if (!cancelled) { setCart(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId, reloadKey]);

  const updateQty = async (item, qty) => {
    if (qty < 1) return;
    setBusy(true);
    try {
      const updated = await Api.cartUpdateItem(
        retailerId, item.product_id, { quantity: qty }, item.distributor_id
      );
      setCart(updated);
      onMutated?.();
    } catch {
      toast.error("Could not update item");
    } finally { setBusy(false); }
  };

  const removeItem = async (item) => {
    setBusy(true);
    try {
      const updated = await Api.cartRemoveItem(retailerId, item.product_id, item.distributor_id);
      setCart(updated);
      toast.success("Item removed");
      onMutated?.();
    } catch {
      toast.error("Could not remove item");
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!window.confirm("Clear the entire cart?")) return;
    setBusy(true);
    try {
      await Api.cartClear(retailerId);
      reload();
      onMutated?.();
      toast.success("Cart cleared");
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await Api.cartSubmit(retailerId);
      toast.success(`${result.count} purchase order(s) submitted to suppliers`);
      reload();
      onMutated?.();
      setSubmitDialogOpen(false);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not submit cart");
    } finally { setBusy(false); }
  };

  if (loading) return <LoadingState />;

  const empty = !cart?.items?.length;

  return (
    <div data-testid="cart-tab" className="space-y-5">
      {/* Header strip */}
      <Card className="rounded-2xl shadow-sm border-slate-200">
        <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-violet-100 flex items-center justify-center">
              <ShoppingCart className="h-6 w-6 text-violet-700" />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Cart Summary</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums">
                {fmtMoney(cart?.subtotal)} · {cart?.unique_skus || 0} SKU{cart?.unique_skus === 1 ? "" : "s"} · {cart?.item_count || 0} units
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AddCartItemDialog
              retailerId={retailerId}
              onAdded={() => { reload(); onMutated?.(); }}
            />
            {!empty && (
              <>
                <Button
                  variant="outline"
                  onClick={clear}
                  disabled={busy}
                  className="border-rose-200 text-rose-700 hover:bg-rose-50"
                  data-testid="clear-cart-btn"
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Clear
                </Button>
                <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      disabled={busy}
                      className="bg-violet-700 hover:bg-violet-800 text-white"
                      data-testid="submit-cart-btn"
                    >
                      <Send className="h-4 w-4 mr-1.5" />
                      Submit order
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Submit cart as purchase orders?</DialogTitle>
                      <DialogDescription>
                        Your cart will be split by supplier and {cart?.by_supplier?.length || 0} purchase order(s)
                        will be created and sent for approval.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                      {cart?.by_supplier?.map((g) => (
                        <div key={g.distributor_id} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700 font-medium">{g.distributor?.name || "—"}</span>
                          <span className="text-slate-900 font-semibold tabular-nums">{fmtMoney(g.subtotal)}</span>
                        </div>
                      ))}
                      <div className="border-t border-slate-200 pt-2 flex items-center justify-between text-sm">
                        <span className="text-slate-500">Grand total</span>
                        <span className="text-violet-700 font-bold tabular-nums">{fmtMoney(cart?.subtotal)}</span>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setSubmitDialogOpen(false)}>Cancel</Button>
                      <Button
                        onClick={submit}
                        disabled={busy}
                        className="bg-violet-700 hover:bg-violet-800 text-white"
                        data-testid="confirm-submit-cart"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1.5" />}
                        Confirm & send
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {empty ? (
        <EmptyCart retailerId={retailerId} onAdded={() => { reload(); onMutated?.(); }} />
      ) : (
        <div className="space-y-5">
          {cart.by_supplier.map((group) => (
            <SupplierGroup
              key={group.distributor_id}
              group={group}
              busy={busy}
              onUpdateQty={updateQty}
              onRemoveItem={removeItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SupplierGroup({ group, busy, onUpdateQty, onRemoveItem }) {
  const supplier = group.supplier || group.distributor || {};
  const stype = group.supplier_type || "wholesaler";
  const supplierName = supplier.name || supplier.organization_name || "—";
  const supplierCity = supplier.city || "";
  const supplierRegion = supplier.region || "";
  const typeBadge = stype === "wholesaler"
    ? { label: "Wholesaler", cls: "bg-violet-100 text-violet-700 ring-violet-200" }
    : { label: "Distributor (direct)", cls: "bg-amber-100 text-amber-800 ring-amber-200" };
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden" data-testid={`supplier-group-${group.distributor_id}`}>
      <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center">
            <Truck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              {supplierName}
              <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ring-1 ${typeBadge.cls}`}>
                {typeBadge.label}
              </span>
            </div>
            <div className="text-[11px] text-slate-500">{supplierCity} · {supplierRegion}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Subtotal</div>
          <div className="text-lg font-semibold text-slate-900 tabular-nums">{fmtMoney(group.subtotal)}</div>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {group.items.map((it) => (
          <CartRow
            key={`${it.product_id}_${it.distributor_id}_${it.supplier_type || "wholesaler"}_${it.quantity}`}
            item={it}
            busy={busy}
            onQty={(q) => onUpdateQty(it, q)}
            onRemove={() => onRemoveItem(it)}
          />
        ))}
      </div>
    </Card>
  );
}

function CartRow({ item, busy, onQty, onRemove }) {
  // Local qty is seeded from props once; if the parent receives a new
  // server-side quantity it will re-mount this row via the key prop.
  const [qty, setQty] = useState(item.quantity);
  return (
    <div className="px-5 py-3 flex items-center gap-4" data-testid={`cart-row-${item.product_id}`}>
      <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
        {item.product?.image_url ? (
          <img src={item.product.image_url} alt="" className="h-10 w-10 object-cover rounded-lg" />
        ) : <Package className="h-4 w-4 text-slate-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-900 truncate">{item.product?.name || "—"}</div>
        <div className="text-[11px] text-slate-500">
          {item.product?.category || "—"} · {fmtMoney(item.unit_cost)}/unit
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline" size="icon"
          className="h-8 w-8"
          disabled={busy || qty <= 1}
          onClick={() => onQty(qty - 1)}
          data-testid={`cart-dec-${item.product_id}`}
        ><X className="h-3.5 w-3.5" /></Button>
        <Input
          type="number"
          min="1"
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          onBlur={(e) => Number(e.target.value) !== item.quantity && onQty(Math.max(1, Number(e.target.value) || 1))}
          className="h-8 w-16 text-center tabular-nums"
          data-testid={`cart-qty-${item.product_id}`}
        />
        <Button
          variant="outline" size="icon"
          className="h-8 w-8"
          disabled={busy}
          onClick={() => onQty(qty + 1)}
          data-testid={`cart-inc-${item.product_id}`}
        ><Plus className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="w-28 text-right tabular-nums shrink-0">
        <div className="text-sm font-semibold text-slate-900">{fmtMoney(item.line_total)}</div>
      </div>
      <Button
        variant="ghost" size="icon"
        className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
        disabled={busy}
        onClick={onRemove}
        data-testid={`cart-remove-${item.product_id}`}
      ><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

function EmptyCart({ retailerId, onAdded }) {
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardContent className="p-10 flex flex-col items-center justify-center text-center">
        <div className="h-14 w-14 rounded-2xl bg-violet-100 flex items-center justify-center mb-4">
          <ShoppingCart className="h-7 w-7 text-violet-700" />
        </div>
        <div className="text-lg font-semibold text-slate-900">Your cart is empty</div>
        <p className="text-sm text-slate-500 mt-1 max-w-sm">
          Add products from the catalog, or let the AI assistant suggest reorders based on your current stock cover.
        </p>
        <div className="mt-5">
          <AddCartItemDialog retailerId={retailerId} onAdded={onAdded} />
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-10 flex items-center justify-center text-slate-400 gap-2">
      <Loader2 className="h-5 w-5 animate-spin" /> Loading your cart…
    </div>
  );
}
