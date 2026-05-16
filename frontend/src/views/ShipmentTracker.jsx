import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Truck, PackageCheck, Plus, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["all", "pending", "in_transit", "received"];

export default function ShipmentTracker() {
  const { session } = useSession();
  const role = session.role;
  const [shipments, setShipments] = useState([]);
  const [tab, setTab] = useState("all");
  const [refreshing, setRefreshing] = useState(0);
  const [openCreate, setOpenCreate] = useState(false);

  useEffect(() => {
    let params = {};
    if (role === "manufacturer") params = { manufacturer_id: session.entity.id };
    else if (role === "distributor") params = { distributor_id: session.entity.id };
    else params = { retailer_id: session.entity.id };
    Api.shipments(params).then(setShipments);
  }, [role, session.entity.id, refreshing]);

  const filtered = useMemo(() => {
    if (tab === "all") return shipments;
    return shipments.filter((s) => s.status === tab);
  }, [shipments, tab]);

  const advance = async (s, target) => {
    try {
      await Api.updateShipmentStatus(s.id, target);
      toast.success(`Shipment marked as ${target.replace("_", " ")}`);
      setRefreshing((x) => x + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update");
    }
  };

  const canCreate = role === "manufacturer" || role === "distributor";

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="shipment-tracker">
      <PageHeader
        title="Shipments"
        description="Track every package from pending to received."
        actions={
          canCreate && (
            <CreateShipmentDialog
              open={openCreate}
              setOpen={setOpenCreate}
              onCreated={() => setRefreshing((x) => x + 1)}
            />
          )
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList data-testid="shipment-tabs">
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s} className="capitalize" data-testid={`tab-${s}`}>
              {s.replace("_", " ")}
              <span className="ml-2 text-xs text-slate-500">
                ({s === "all" ? shipments.length : shipments.filter((x) => x.status === s).length})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="space-y-3">
        {filtered.length === 0 && (
          <Card><CardContent className="p-10 text-center text-slate-500">No shipments to show.</CardContent></Card>
        )}
        {filtered.map((s) => {
          const isSender = s.from_role === role && s.from_id === session.entity.id;
          const isReceiver = s.to_role === role && s.to_id === session.entity.id;
          return (
            <Card key={s.id} data-testid={`shipment-card-${s.tracking_code}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="font-mono text-sm font-semibold text-slate-900">{s.tracking_code}</div>
                      <StatusBadge status={s.status} />
                    </div>
                    <div className="text-sm text-slate-600 flex items-center gap-1 flex-wrap">
                      <RoleChip role={s.from_role} />
                      <span className="font-medium text-slate-900">{s.from_party?.name || "—"}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 mx-1" />
                      <RoleChip role={s.to_role} />
                      <span className="font-medium text-slate-900">{s.to_party?.name || "—"}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {s.items.map((it, idx) => (
                        <span key={idx} className="text-xs bg-slate-100 text-slate-700 rounded-md px-2 py-1">
                          {it.product?.name || it.product_id} × {it.quantity}
                        </span>
                      ))}
                    </div>

                    {/* Visual pipeline */}
                    <div className="mt-5 flex items-center gap-2">
                      <Step active={true} label="Pending" />
                      <Segment active={s.status === "in_transit" || s.status === "received"} />
                      <Step active={s.status === "in_transit" || s.status === "received"} label="In Transit" />
                      <Segment active={s.status === "received"} />
                      <Step active={s.status === "received"} label="Received" />
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {isSender && s.status === "pending" && (
                      <Button
                        onClick={() => advance(s, "in_transit")}
                        className="bg-amber-500 hover:bg-amber-600 text-white"
                        data-testid={`btn-dispatch-${s.tracking_code}`}
                      >
                        <Truck className="h-4 w-4 mr-2" /> Mark in transit
                      </Button>
                    )}
                    {isReceiver && s.status === "in_transit" && (
                      <Button
                        onClick={() => advance(s, "received")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        data-testid={`btn-receive-${s.tracking_code}`}
                      >
                        <PackageCheck className="h-4 w-4 mr-2" /> Confirm received
                      </Button>
                    )}
                    <div className="text-xs text-slate-400">
                      {new Date(s.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RoleChip({ role }) {
  const map = { manufacturer: "Mfg", distributor: "Dist", retailer: "Retail" };
  return (
    <span className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">
      {map[role] || role}
    </span>
  );
}

function Step({ active, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-2.5 w-2.5 rounded-full ${active ? "bg-slate-900" : "bg-slate-200"}`} />
      <span className={`text-xs ${active ? "text-slate-900 font-medium" : "text-slate-400"}`}>{label}</span>
    </div>
  );
}
function Segment({ active }) {
  return <div className={`flex-1 h-px ${active ? "bg-slate-900" : "bg-slate-200"}`} />;
}

function CreateShipmentDialog({ open, setOpen, onCreated }) {
  const { session } = useSession();
  const role = session.role;
  const targetRole = role === "manufacturer" ? "distributor" : "retailer";
  const [targets, setTargets] = useState([]);
  const [products, setProducts] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ product_id: "", quantity: 1 }]);

  useEffect(() => {
    if (open) {
      if (role === "manufacturer") {
        Api.distributors(session.entity.id).then(setTargets);
      } else {
        Api.retailers(session.entity.id).then(setTargets);
      }
      Api.products().then(setProducts);
    }
  }, [open, role, session.entity.id]);

  const submit = async () => {
    const valid = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    if (!targetId || valid.length === 0) {
      toast.error(`Pick a ${targetRole} and at least one product line.`);
      return;
    }
    try {
      await Api.createShipment({
        from_role: role,
        from_id: session.entity.id,
        to_role: targetRole,
        to_id: targetId,
        items: valid.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
        notes: notes || null,
      });
      toast.success("Shipment created");
      setOpen(false);
      setTargetId("");
      setNotes("");
      setLines([{ product_id: "", quantity: 1 }]);
      onCreated();
    } catch {
      toast.error("Failed to create shipment");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-slate-900 hover:bg-slate-800" data-testid="open-create-shipment">
          <Plus className="h-4 w-4 mr-2" /> New shipment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create shipment</DialogTitle>
          <DialogDescription>
            Outbound shipment from {session.entity.name} to a {targetRole}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="capitalize">{targetRole}</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger data-testid="ship-target-select">
                <SelectValue placeholder={`Pick a ${targetRole}`} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {targets.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}{t.region ? ` · ${t.region}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Items</Label>
            <div className="space-y-2 mt-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex gap-2">
                  <Select
                    value={l.product_id}
                    onValueChange={(v) => setLines((arr) => arr.map((x, i) => i === idx ? { ...x, product_id: v } : x))}
                  >
                    <SelectTrigger className="flex-1" data-testid={`ship-line-product-${idx}`}>
                      <SelectValue placeholder="Product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="1"
                    value={l.quantity}
                    onChange={(e) => setLines((arr) => arr.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))}
                    className="w-24"
                    data-testid={`ship-line-qty-${idx}`}
                  />
                  <Button variant="ghost" size="icon" onClick={() => setLines((arr) => arr.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-4 w-4 text-slate-400" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines((arr) => [...arr, { product_id: "", quantity: 1 }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add item
              </Button>
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any handling instructions…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} className="bg-slate-900 hover:bg-slate-800" data-testid="submit-shipment">
            Create shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
