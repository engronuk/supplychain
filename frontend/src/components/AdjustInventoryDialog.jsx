import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Minus, Save } from "lucide-react";
import { toast } from "sonner";

/**
 * Inventory adjustment dialog.
 * Modes: "delta" (default — +/- N) or "set" (absolute value).
 * Required props: ownerType ("manufacturer" | "distributor" | "retailer"),
 * ownerId, product { id, name, sku }, currentQty.
 */
export default function AdjustInventoryDialog({
  open, onOpenChange, ownerType, ownerId, product, currentQty = 0,
  initialDelta = 0, initialReason = "", onSaved,
}) {
  const [mode, setMode] = useState("delta");
  const [delta, setDelta] = useState(0);
  const [absolute, setAbsolute] = useState(0);
  const [reorder, setReorder] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("delta");
      setDelta(initialDelta || 0);
      setAbsolute(currentQty);
      setReorder("");
      setReason(initialReason || "");
    }
  }, [open, currentQty, initialDelta, initialReason]);

  const projected = mode === "delta"
    ? Math.max(0, currentQty + Number(delta || 0))
    : Math.max(0, Number(absolute || 0));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        owner_type: ownerType,
        owner_id: ownerId,
        product_id: product.id,
        reason: reason.trim(),
      };
      if (mode === "delta") payload.quantity_delta = Number(delta);
      else payload.set_quantity = Number(absolute);
      if (reorder !== "" && !Number.isNaN(Number(reorder))) {
        payload.reorder_level = Number(reorder);
      }
      await Api.adjustInventory(payload);
      toast.success("Inventory adjusted");
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Adjustment failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="adjust-inventory-dialog">
        <DialogHeader>
          <DialogTitle>Adjust inventory</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{product?.sku}</span> · {product?.name} · current: <span className="font-medium">{currentQty.toLocaleString()}u</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-md bg-stone-100 border border-stone-200">
            <ModeButton active={mode === "delta"} onClick={() => setMode("delta")} testId="mode-delta">
              <Plus className="h-3 w-3 mr-1" /> Add or remove
            </ModeButton>
            <ModeButton active={mode === "set"} onClick={() => setMode("set")} testId="mode-set">
              <Minus className="h-3 w-3 mr-1" /> Set absolute
            </ModeButton>
          </div>

          {mode === "delta" ? (
            <div>
              <Label className="text-xs uppercase tracking-wider text-graphite font-medium">
                Change by (units) — positive to add, negative to remove
              </Label>
              <Input
                type="number" value={delta}
                onChange={(e) => setDelta(e.target.value)}
                placeholder="e.g. 100 or -50"
                className="mt-1 font-mono"
                data-testid="adjust-delta-input"
              />
            </div>
          ) : (
            <div>
              <Label className="text-xs uppercase tracking-wider text-graphite font-medium">
                Set quantity to
              </Label>
              <Input
                type="number" min="0" value={absolute}
                onChange={(e) => setAbsolute(e.target.value)}
                className="mt-1 font-mono"
                data-testid="adjust-absolute-input"
              />
            </div>
          )}

          <div>
            <Label className="text-xs uppercase tracking-wider text-graphite font-medium">
              Reorder level (optional)
            </Label>
            <Input
              type="number" min="0" value={reorder}
              onChange={(e) => setReorder(e.target.value)}
              placeholder="Leave blank to keep current"
              className="mt-1 font-mono"
            />
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-graphite font-medium">Reason</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Stock count correction, damaged inventory write-off"
              className="mt-1"
              data-testid="adjust-reason-input"
            />
          </div>

          <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-sm" data-testid="adjust-projected-row">
            <div className="text-[10px] uppercase tracking-wider text-graphite">After adjustment</div>
            <div className="font-display text-2xl tracking-tight text-ink">
              {projected.toLocaleString()} units
              <span className="text-sm text-graphite font-sans ml-2">
                ({(projected - currentQty) >= 0 ? "+" : ""}{(projected - currentQty).toLocaleString()})
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-ink hover:bg-ink/90 text-paper"
                  data-testid="adjust-save-btn">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4 mr-1.5" /> Confirm adjustment</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({ active, onClick, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center justify-center h-9 rounded-md text-sm font-medium transition-colors ${
        active ? "bg-white text-ink shadow-sm" : "text-graphite hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
