import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

export default function EditProductDialog({ open, onOpenChange, product, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name || "",
        sku: product.sku || "",
        category: product.category || "",
        unit_price: product.unit_price ?? 0,
        barcode: product.barcode || "",
      });
    }
  }, [product]);

  const save = async () => {
    setSaving(true);
    try {
      await Api.updateProduct(product.id, {
        name: form.name.trim(),
        sku: form.sku.trim(),
        category: form.category.trim(),
        unit_price: parseFloat(form.unit_price) || 0,
        barcode: form.barcode.trim(),
      });
      toast.success("Product updated");
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-product-dialog">
        <DialogHeader>
          <DialogTitle>Edit product</DialogTitle>
          <DialogDescription>Changes are live network-wide.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Product name" testId="edit-product-name">
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU" testId="edit-product-sku">
              <Input value={form.sku || ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="font-mono" />
            </Field>
            <Field label="Category">
              <Input value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit price (₦)" testId="edit-product-price">
              <Input type="number" step="0.01" value={form.unit_price ?? ""}
                onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
            </Field>
            <Field label="Barcode">
              <Input value={form.barcode || ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="font-mono" />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name} className="bg-ink hover:bg-ink/90 text-paper" data-testid="edit-product-save-btn">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" /> Save changes</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, testId }) {
  return (
    <div data-testid={testId}>
      <Label className="text-xs uppercase tracking-wider text-graphite font-medium">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
