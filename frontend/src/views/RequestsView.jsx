import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "sonner";

export default function RequestsView() {
  const { session } = useSession();
  const role = session.role;
  const [requests, setRequests] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const [openCreate, setOpenCreate] = useState(false);

  useEffect(() => {
    const params = role === "distributor"
      ? { distributor_id: session.entity.id }
      : { retailer_id: session.entity.id };
    Api.requests(params).then(setRequests);
  }, [role, session.entity.id, refresh]);

  const decide = async (id, action) => {
    try {
      await Api.decideRequest(id, action);
      toast.success(action === "approve" ? "Request approved — shipment created" : "Request rejected");
      setRefresh((x) => x + 1);
    } catch (e) {
      toast.error("Action failed");
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="requests-view">
      <PageHeader
        title="Stock Requests"
        description={role === "distributor" ? "Approve or reject retailer stock requests." : "Request stock from your distributor."}
        actions={role === "retailer" && (
          <CreateRequestDialog open={openCreate} setOpen={setOpenCreate} onCreated={() => setRefresh((x) => x + 1)} />
        )}
      />

      <div className="space-y-3">
        {requests.length === 0 && (
          <Card><CardContent className="p-10 text-center text-slate-500">No requests yet.</CardContent></Card>
        )}
        {requests.map((r) => (
          <Card key={r.id} data-testid={`request-card-${r.id}`}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="font-semibold text-slate-900">
                      {role === "distributor" ? r.retailer?.name : r.distributor?.name}
                    </div>
                    <StatusBadge status={r.status} kind="request" />
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                  {r.note && (
                    <div className="mt-2 text-sm text-slate-600 italic">"{r.note}"</div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {r.items.map((it, idx) => (
                      <span key={idx} className="text-xs bg-slate-100 text-slate-700 rounded-md px-2 py-1">
                        {it.product?.name || it.product_id} × {it.quantity}
                      </span>
                    ))}
                  </div>
                </div>
                {role === "distributor" && r.status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => decide(r.id, "reject")}
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      data-testid={`reject-${r.id}`}
                    >
                      <X className="h-4 w-4 mr-1" /> Reject
                    </Button>
                    <Button
                      onClick={() => decide(r.id, "approve")}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      data-testid={`approve-${r.id}`}
                    >
                      <Check className="h-4 w-4 mr-1" /> Approve
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CreateRequestDialog({ open, setOpen, onCreated }) {
  const { session } = useSession();
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([{ product_id: "", quantity: 1 }]);
  const [note, setNote] = useState("");

  useEffect(() => { if (open) Api.products().then(setProducts); }, [open]);

  const submit = async () => {
    const valid = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    if (valid.length === 0) {
      toast.error("Add at least one product line.");
      return;
    }
    try {
      await Api.createRequest({
        retailer_id: session.entity.id,
        distributor_id: session.entity.distributor_id,
        items: valid.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
        note: note || null,
      });
      toast.success("Request submitted");
      setOpen(false);
      setLines([{ product_id: "", quantity: 1 }]);
      setNote("");
      onCreated();
    } catch {
      toast.error("Failed to submit request");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-slate-900 hover:bg-slate-800" data-testid="open-create-request">
          <Plus className="h-4 w-4 mr-2" /> New request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request stock</DialogTitle>
          <DialogDescription>Send a stock request to your distributor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Items</Label>
            <div className="space-y-2 mt-2">
              {lines.map((l, idx) => (
                <div key={idx} className="flex gap-2">
                  <Select
                    value={l.product_id}
                    onValueChange={(v) => setLines((arr) => arr.map((x, i) => i === idx ? { ...x, product_id: v } : x))}
                  >
                    <SelectTrigger className="flex-1" data-testid={`req-line-product-${idx}`}>
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
                    data-testid={`req-line-qty-${idx}`}
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
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why do you need this?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} className="bg-slate-900 hover:bg-slate-800" data-testid="submit-request">
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
