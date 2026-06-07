/**
 * Add a product to the cart. Picks a supplier and shows the available
 * distributors with their last-known unit cost for this product.
 */
import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function AddCartItemDialog({ retailerId, onAdded, trigger }) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [productId, setProductId] = useState("");
  const [distributorId, setDistributorId] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [unitCost, setUnitCost] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      Api.products().catch(() => []),
      Api.distributors().catch(() => []),
    ]).then(([ps, ds]) => {
      setProducts(ps || []);
      setDistributors(ds || []);
    });
  }, [open]);

  // Helpers kept for reference but unused (Api.products/distributors exist).

  const submit = async () => {
    if (!productId || !distributorId || quantity < 1) {
      toast.error("Pick a product, a supplier and a quantity");
      return;
    }
    setSaving(true);
    try {
      await Api.cartAddItem(retailerId, {
        product_id: productId,
        distributor_id: distributorId,
        quantity: Number(quantity),
        unit_cost: Number(unitCost) || 0,
      });
      toast.success("Item added to cart");
      onAdded?.();
      setOpen(false);
      setProductId(""); setDistributorId(""); setQuantity(10); setUnitCost(0);
    } catch {
      toast.error("Could not add item");
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button className="bg-slate-900 hover:bg-slate-800 text-white" data-testid="open-add-to-cart">
            <Plus className="h-4 w-4 mr-1.5" /> Add item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add product to cart</DialogTitle>
          <DialogDescription>Pick a product, choose a supplier and enter the agreed unit cost.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="mt-1" data-testid="add-cart-product-select">
                <SelectValue placeholder="Select a product" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Supplier</Label>
            <Select value={distributorId} onValueChange={setDistributorId}>
              <SelectTrigger className="mt-1" data-testid="add-cart-supplier-select">
                <SelectValue placeholder="Select a supplier" />
              </SelectTrigger>
              <SelectContent>
                {distributors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Quantity</Label>
              <Input
                type="number" min="1" value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="mt-1 tabular-nums"
                data-testid="add-cart-qty"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-500">Unit cost (₦)</Label>
              <Input
                type="number" min="0" step="0.01" value={unitCost}
                onChange={(e) => setUnitCost(Math.max(0, Number(e.target.value) || 0))}
                className="mt-1 tabular-nums"
                data-testid="add-cart-unit-cost"
              />
            </div>
          </div>
          <div className="rounded-lg bg-violet-50 border border-violet-100 p-3">
            <div className="text-[11px] uppercase tracking-wider text-violet-700 font-semibold">Line total</div>
            <div className="text-lg font-bold text-violet-900 tabular-nums">
              ₦{(Number(quantity) * Number(unitCost || 0)).toLocaleString()}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="bg-violet-700 hover:bg-violet-800 text-white"
            data-testid="confirm-add-to-cart"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Add to cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
