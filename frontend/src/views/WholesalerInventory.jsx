import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { toast } from "sonner";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
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
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  PageHeader, HealthBadge, fmtNumber, fmtCurrency, KpiCard, EmptyState,
} from "./wholesaler/ui";
import { Boxes, Plus, RefreshCw, Sparkles, Activity } from "lucide-react";

export default function WholesalerInventory() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [inv, setInv] = useState({ rows: [], summary: {} });
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [active, setActive] = useState(null);   // active inventory row for modal
  const [modal, setModal] = useState(null);     // "receive" | "adjust" | "cycle"

  const refresh = () => {
    if (!wid) return;
    setLoading(true);
    Promise.all([
      WholesalerApi.inventory(wid),
      WholesalerApi.movements(wid, 30),
    ])
      .then(([i, m]) => { setInv(i); setMovements(m); })
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [wid]);

  const rows = (inv.rows || []).filter((r) => {
    if (healthFilter !== "all" && r.health !== healthFilter) return false;
    if (search && !`${r.product_name} ${r.sku}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-inventory">
      <PageHeader
        title="Inventory Management"
        subtitle="Available, reserved, damaged & in-transit stock — across your aggregation hub."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} data-testid="inv-refresh">
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => { setActive(null); setModal("receive"); }}
              data-testid="inv-receive-btn"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Receive Inventory
            </Button>
          </div>
        }
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          testid="inv-total-skus"
          icon={Boxes}
          label="Total SKUs"
          value={fmtNumber(inv.summary.total_skus)}
        />
        <KpiCard
          testid="inv-total-value"
          icon={Activity}
          label="Total Value"
          value={fmtCurrency(inv.summary.total_value)}
        />
        <KpiCard
          testid="inv-total-units"
          icon={Boxes}
          label="Total Units"
          value={fmtNumber(inv.summary.total_units)}
        />
        <KpiCard
          testid="inv-at-risk"
          icon={Sparkles}
          label="At Risk SKUs"
          value={fmtNumber((inv.summary.low_stock || 0) + (inv.summary.out_of_stock || 0))}
          tone={(inv.summary.low_stock || 0) + (inv.summary.out_of_stock || 0) > 0 ? "warning" : "default"}
          hint={`${inv.summary.low_stock || 0} low · ${inv.summary.out_of_stock || 0} out`}
        />
      </div>

      <Tabs defaultValue="catalogue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="catalogue" data-testid="tab-catalogue">Stock Catalogue</TabsTrigger>
          <TabsTrigger value="movements" data-testid="tab-movements">Movements</TabsTrigger>
        </TabsList>

        <TabsContent value="catalogue" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Inventory Catalogue</CardTitle>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search SKU or product…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-48"
                  data-testid="inv-search"
                />
                <Select value={healthFilter} onValueChange={setHealthFilter}>
                  <SelectTrigger className="w-40" data-testid="inv-health-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Health</SelectItem>
                    <SelectItem value="healthy">Healthy</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="out">Out</SelectItem>
                    <SelectItem value="excess">Excess</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-6 text-sm text-slate-500">Loading inventory…</div>
              ) : rows.length === 0 ? (
                <EmptyState
                  title="No inventory matches your filters"
                  body="Try clearing search filters or receive new stock."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="inv-table">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                        <th className="py-2 px-3 font-medium">Product</th>
                        <th className="py-2 px-3 font-medium">SKU</th>
                        <th className="py-2 px-3 font-medium text-right">Available</th>
                        <th className="py-2 px-3 font-medium text-right">Reserved</th>
                        <th className="py-2 px-3 font-medium text-right">Damaged</th>
                        <th className="py-2 px-3 font-medium text-right">In Transit</th>
                        <th className="py-2 px-3 font-medium text-right">Reorder</th>
                        <th className="py-2 px-3 font-medium text-right">Value</th>
                        <th className="py-2 px-3 font-medium">Health</th>
                        <th className="py-2 px-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`inv-row-${r.product_id}`}>
                          <td className="py-2 px-3 font-medium text-slate-800">{r.product_name}</td>
                          <td className="py-2 px-3 text-slate-500 text-xs">{r.sku || "—"}</td>
                          <td className="py-2 px-3 text-right font-medium">{fmtNumber(r.available)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{fmtNumber(r.reserved)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{fmtNumber(r.damaged)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{fmtNumber(r.in_transit)}</td>
                          <td className="py-2 px-3 text-right text-slate-500">{fmtNumber(r.reorder_level)}</td>
                          <td className="py-2 px-3 text-right">{fmtCurrency(r.value)}</td>
                          <td className="py-2 px-3"><HealthBadge status={r.health} /></td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => { setActive(r); setModal("adjust"); }}
                              data-testid={`inv-adjust-${r.product_id}`}
                            >Adjust</Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => { setActive(r); setModal("cycle"); }}
                              data-testid={`inv-cycle-${r.product_id}`}
                            >Count</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movements">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Movements</CardTitle>
            </CardHeader>
            <CardContent>
              {movements.length === 0 ? (
                <EmptyState title="No movements yet" body="Inventory receipts, adjustments, and cycle counts will appear here." />
              ) : (
                <div className="space-y-2">
                  {movements.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50"
                      data-testid={`movement-${m.id}`}
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-800">
                          {m.product_name} {m.sku ? `· ${m.sku}` : ""}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {m.kind} · {m.note || "—"} · {new Date(m.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className={`text-sm font-semibold ${m.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {m.delta >= 0 ? "+" : ""}{m.delta}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <ReceiveModal
        open={modal === "receive"}
        onClose={() => setModal(null)}
        wid={wid}
        rows={inv.rows || []}
        onSuccess={refresh}
      />
      <AdjustModal
        open={modal === "adjust"}
        row={active}
        onClose={() => setModal(null)}
        wid={wid}
        onSuccess={refresh}
      />
      <CycleCountModal
        open={modal === "cycle"}
        row={active}
        onClose={() => setModal(null)}
        wid={wid}
        onSuccess={refresh}
      />
    </div>
  );
}

function ReceiveModal({ open, onClose, wid, rows, onSuccess }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState(100);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setProductId(rows[0]?.product_id || ""); setQty(100); setNote(""); }
  }, [open, rows]);

  const submit = async () => {
    if (!productId || !qty) return;
    setSaving(true);
    try {
      await WholesalerApi.receive(wid, {
        product_id: productId,
        quantity: Number(qty),
        source: "manual",
        note: note || undefined,
        actor: "wholesaler",
      });
      toast.success("Inventory received");
      onSuccess();
      onClose();
    } catch (e) {
      toast.error("Failed to receive inventory");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="receive-modal">
        <DialogHeader>
          <DialogTitle>Receive Inventory</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rec-product">Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="rec-product" data-testid="receive-product"><SelectValue placeholder="Pick a product" /></SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.product_id} value={r.product_id}>
                    {r.product_name} {r.sku ? `· ${r.sku}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="rec-qty">Quantity</Label>
            <Input
              id="rec-qty"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              data-testid="receive-qty"
            />
          </div>
          <div>
            <Label htmlFor="rec-note">Note (optional)</Label>
            <Textarea id="rec-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !productId} data-testid="receive-submit">
            {saving ? "Saving…" : "Receive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustModal({ open, row, onClose, wid, onSuccess }) {
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState("manual");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setDelta(0); setReason("manual"); setNote(""); }
  }, [open]);

  if (!row) return null;
  const newQty = Math.max(0, row.available + Number(delta || 0));

  const submit = async () => {
    setSaving(true);
    try {
      await WholesalerApi.adjustInventory(wid, row.product_id, {
        delta: Number(delta), reason, note: note || undefined, actor: "wholesaler",
      });
      toast.success("Inventory adjusted");
      onSuccess(); onClose();
    } catch (e) {
      toast.error("Failed to adjust inventory");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="adjust-modal">
        <DialogHeader>
          <DialogTitle>Adjust Inventory — {row.product_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            Current: <strong>{fmtNumber(row.available)}</strong> · New: <strong>{fmtNumber(newQty)}</strong>
          </div>
          <div>
            <Label htmlFor="adj-delta">Delta (positive or negative)</Label>
            <Input
              id="adj-delta"
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              data-testid="adjust-delta"
            />
          </div>
          <div>
            <Label htmlFor="adj-reason">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="adj-reason" data-testid="adjust-reason"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="receive">Receive</SelectItem>
                <SelectItem value="damage">Damage</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="cycle_count">Cycle Count</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="adj-note">Note</Label>
            <Textarea id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || delta === 0 || delta === "0"} data-testid="adjust-submit">
            {saving ? "Saving…" : "Apply Adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CycleCountModal({ open, row, onClose, wid, onSuccess }) {
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && row) { setCounted(row.available); setNote(""); }
  }, [open, row]);

  if (!row) return null;
  const variance = Number(counted) - row.available;

  const submit = async () => {
    setSaving(true);
    try {
      await WholesalerApi.cycleCount(wid, row.product_id, {
        counted_quantity: Number(counted), note: note || undefined, actor: "wholesaler",
      });
      toast.success(`Cycle count saved (variance ${variance >= 0 ? "+" : ""}${variance})`);
      onSuccess(); onClose();
    } catch (e) {
      toast.error("Failed to save cycle count");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="cycle-modal">
        <DialogHeader>
          <DialogTitle>Cycle Count — {row.product_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-slate-600">
            System on-hand: <strong>{fmtNumber(row.available)}</strong> · Variance: <strong className={variance < 0 ? "text-rose-600" : variance > 0 ? "text-emerald-600" : "text-slate-600"}>{variance >= 0 ? "+" : ""}{variance}</strong>
          </div>
          <div>
            <Label htmlFor="cc-counted">Counted Quantity</Label>
            <Input
              id="cc-counted"
              type="number"
              min={0}
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              data-testid="cycle-counted"
            />
          </div>
          <div>
            <Label htmlFor="cc-note">Note (optional)</Label>
            <Textarea id="cc-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving} data-testid="cycle-submit">
            {saving ? "Saving…" : "Save Count"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
