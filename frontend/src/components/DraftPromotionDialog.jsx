/**
 * Promotion draft dialog — pre-populated from an AI "Promote older batches"
 * recommendation. Saves the draft to /api/manufacturer/:id/promotions.
 */
import { useEffect, useState } from "react";
import { Api } from "@/lib/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

const ZONES = ["All zones", "South West", "South East", "South South",
                "North West", "North East", "North Central"];

export default function DraftPromotionDialog({
  open, onOpenChange, manufacturerId, product, batchAction, onSaved,
}) {
  const [discount, setDiscount] = useState(15);
  const [zone, setZone] = useState("All zones");
  const [duration, setDuration] = useState(21);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && batchAction) {
      setDiscount(batchAction.suggested_discount_pct ?? 15);
      setZone("All zones");
      setDuration(Math.max(7, Math.min(batchAction.days_remaining ?? 21, 30)));
      setNotes(`Auto-drafted to clear ${batchAction.units_available?.toLocaleString() || "—"} units of batch ${batchAction.batch_number} (expires in ${batchAction.days_remaining} days).`);
    }
  }, [open, batchAction]);

  if (!batchAction) return null;

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + duration * 24 * 60 * 60 * 1000);

  const save = async () => {
    setSaving(true);
    try {
      await Api.createPromotionDraft(manufacturerId, {
        manufacturer_id: manufacturerId,
        product_id: product.id,
        batch_id: batchAction.batch_id,
        batch_number: batchAction.batch_number,
        discount_pct: Number(discount),
        target_zone: zone === "All zones" ? null : zone,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        notes,
      });
      toast.success("Promotion drafted");
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to draft promotion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="draft-promotion-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-violet-600" />
            Draft promotion
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{product.name}</span> · Batch{" "}
            <span className="font-mono">{batchAction.batch_number}</span> · expires in{" "}
            <span className="font-semibold text-rose-600">{batchAction.days_remaining} days</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 font-medium">Discount (%)</Label>
            <Input type="number" min="0" max="80" value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="mt-1 font-mono"
              data-testid="promo-discount-input" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 font-medium">Target zone</Label>
            <select
              value={zone} onChange={(e) => setZone(e.target.value)}
              className="mt-1 w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              data-testid="promo-zone-select"
            >
              {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 font-medium">Duration (days)</Label>
            <Input type="number" min="1" max="60" value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="mt-1 font-mono" />
            <p className="text-[10.5px] text-slate-400 mt-1">
              Runs {startsAt.toLocaleDateString("en-US")} – {endsAt.toLocaleDateString("en-US")}
            </p>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500 font-medium">Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-to-br from-[#6D28D9] to-[#8B5CF6] text-white" data-testid="promo-save-btn">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
