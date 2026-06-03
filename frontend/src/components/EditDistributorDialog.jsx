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

export default function EditDistributorDialog({ open, onOpenChange, distributor, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (distributor) {
      setForm({
        name: distributor.name || "",
        region: distributor.region || "",
        city: distributor.city || "",
        contact_email: distributor.contact_email || "",
        phone: distributor.contact_phone || distributor.phone || "",
        address: distributor.address || "",
        status: distributor.status || "active",
      });
    }
  }, [distributor]);

  const save = async () => {
    setSaving(true);
    try {
      await Api.updateDistributor(distributor.id, form);
      toast.success("Distributor updated");
      onSaved && onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="edit-distributor-dialog">
        <DialogHeader>
          <DialogTitle>Edit distributor</DialogTitle>
          <DialogDescription>Updates the directory + downstream views.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Company name" testId="edit-distributor-name">
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region">
              <Input value={form.region || ""} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            </Field>
            <Field label="City">
              <Input value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
          </div>
          <Field label="Address">
            <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact email" testId="edit-distributor-email">
              <Input type="email" value={form.contact_email || ""} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </Field>
            <Field label="Phone" testId="edit-distributor-phone">
              <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
          </div>
          <Field label="Status">
            <select
              value={form.status || "active"}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full h-10 px-3 rounded-md border border-stone-300 bg-white text-sm"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="onboarding">Onboarding</option>
              <option value="suspended">Suspended</option>
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.name} className="bg-ink hover:bg-ink/90 text-paper" data-testid="edit-distributor-save-btn">
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
