// Logistics Command Center — decision panels: Inventory Allocation,
// Shipment Authorization, Transfer Management + Create Transfer dialog.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, ArrowRight, Check, X, Pencil, RefreshCw, Truck, Plus,
  Loader2, PackageCheck,
} from "lucide-react";
import { Api } from "../../lib/api";
import { useSession } from "../../context/SessionContext";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../components/ui/select";
import { toast } from "sonner";

const num = (n) => (Number(n) || 0).toLocaleString();
const PRIORITY = {
  critical: "bg-rose-100 text-rose-700",
  high: "bg-rose-100 text-rose-700",
  medium: "bg-amber-100 text-amber-800",
  normal: "bg-slate-100 text-slate-600",
  low: "bg-slate-100 text-slate-600",
};

// ============================================================================
// Inventory Allocation Center (queue + Vertex AI recommendation)
// ============================================================================
export const AllocationPanel = ({ queue, aiRec, onChanged }) => {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const act = async (orderId, fn, okMsg) => {
    setBusy(orderId);
    try {
      await fn();
      toast.success(okMsg);
      onChanged?.();
    } catch (e) {
      toast.error("Action failed", { description: e?.response?.data?.detail || e?.message });
    } finally {
      setBusy(null);
    }
  };

  const recompute = async () => {
    setAiBusy(true);
    const id = toast.loading("Asking Vertex AI for the optimal transfer…");
    try {
      await Api.logisticsAiRecompute();
      toast.success("Recommendation updated", { id });
      onChanged?.();
    } catch (e) {
      toast.error("AI recommendation failed", { id, description: e?.response?.data?.detail || e?.message });
    } finally {
      setAiBusy(false);
    }
  };

  const execute = async () => {
    setAiBusy(true);
    const id = toast.loading("Executing recommended transfer…");
    try {
      const res = await Api.logisticsAiExecute();
      toast.success(`Transfer ${res?.transfer?.transfer_number || ""} created`, { id });
      onChanged?.();
    } catch (e) {
      toast.error("Execution failed", { id, description: e?.response?.data?.detail || e?.message });
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden h-full flex flex-col" data-testid="allocation-panel">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-900 text-sm">Inventory Allocation Center</div>
        <button
          type="button"
          onClick={() => navigate("/manufacturer/allocation")}
          className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
          data-testid="allocation-view-all"
        >
          View all →
        </button>
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-[480px]">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Allocation Queue</div>
        {queue.length === 0 ? (
          <div className="text-sm text-slate-400 py-6 text-center">No orders awaiting allocation.</div>
        ) : queue.map((q) => (
          <div key={q.order_id} className="rounded-lg border border-slate-200 p-3" data-testid={`allocation-row-${q.number}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-blue-700">{q.number}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${PRIORITY[q.priority] || PRIORITY.normal}`}>
                {q.priority}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
              <div>
                <div className="text-slate-400 uppercase tracking-wider text-[9px]">Distributor</div>
                <div className="font-medium text-slate-900 truncate">{q.distributor_name}</div>
                <div className="text-slate-500">{q.region}</div>
              </div>
              <div>
                <div className="text-slate-400 uppercase tracking-wider text-[9px]">Requested</div>
                <div className="font-semibold text-slate-900">{num(q.requested_units)} units</div>
              </div>
              <div>
                <div className="text-slate-400 uppercase tracking-wider text-[9px]">Coverable Stock</div>
                <div className={`font-semibold ${q.available_units < q.requested_units ? "text-rose-600" : "text-emerald-600"}`}>
                  {num(q.available_units)} units
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3">
              <Button
                size="sm" className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={busy === q.order_id}
                onClick={() => act(q.order_id, () => Api.allocationAuto(q.order_id, "Approved from Logistics Command Center"), `${q.number} allocated`)}
                data-testid={`allocation-approve-${q.number}`}
              >
                <Check className="h-3 w-3 mr-1" /> Approve
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => navigate("/manufacturer/allocation")}
                data-testid={`allocation-partial-${q.number}`}
              >
                Partial
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-rose-200 text-rose-600 hover:bg-rose-50"
                disabled={busy === q.order_id}
                onClick={() => act(q.order_id, () => Api.allocationReject(q.order_id, "Rejected from Logistics Command Center"), `${q.number} rejected`)}
                data-testid={`allocation-reject-${q.number}`}
              >
                <X className="h-3 w-3 mr-1" /> Reject
              </Button>
            </div>
          </div>
        ))}

        {/* Vertex AI Smart Recommendation */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5" data-testid="ai-recommendation-card">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> AI Recommendation
            </div>
            <div className="flex items-center gap-1.5">
              {aiRec && (
                <span className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
                  aiRec.ai_status === "vertex_ai" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-800"
                }`}>
                  {aiRec.ai_status === "vertex_ai" ? "VERTEX AI" : "EVIDENCE MODE"}
                </span>
              )}
              <button
                type="button" onClick={recompute} disabled={aiBusy}
                className="h-6 w-6 grid place-items-center rounded-md text-emerald-700 hover:bg-emerald-100"
                title="Recompute recommendation"
                data-testid="ai-recompute-btn"
              >
                <RefreshCw className={`h-3 w-3 ${aiBusy ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          {!aiRec ? (
            <div className="mt-2">
              <p className="text-[12px] text-slate-600">No recommendation computed yet for this network.</p>
              <Button
                size="sm" className="mt-2 h-7 text-[11px] bg-violet-600 hover:bg-violet-700 text-white"
                onClick={recompute} disabled={aiBusy}
                data-testid="ai-generate-btn"
              >
                <Sparkles className="h-3 w-3 mr-1" /> Generate with Vertex AI
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-slate-900 flex-wrap">
                <span>{aiRec.from_warehouse_name}</span>
                <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />
                <span>{aiRec.to_warehouse_name}</span>
              </div>
              <div className="text-[12px] text-slate-700 mt-1">
                Move <span className="font-bold">{num(aiRec.quantity)} units</span> of <span className="font-medium">{aiRec.product_name}</span>
                <span className="ml-1.5 text-[10px] uppercase font-bold text-emerald-700">{(aiRec.reason_code || "").replace(/_/g, " ")}</span>
              </div>
              {aiRec.narrative && <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">{aiRec.narrative}</p>}
              <div className="mt-2.5">
                {aiRec.executed ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                    <PackageCheck className="h-3.5 w-3.5" /> Executed · {aiRec.transfer_number}
                  </span>
                ) : (
                  <Button
                    size="sm" className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={execute} disabled={aiBusy || !aiRec.quantity}
                    data-testid="ai-execute-btn"
                  >
                    <Truck className="h-3 w-3 mr-1" /> Execute Transfer
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Shipment Authorization Center
// ============================================================================
export const AuthorizationPanel = ({ authorization, onChanged }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState("warehouse");
  const [busy, setBusy] = useState(null);
  const [modifying, setModifying] = useState(null); // request id
  const [modQty, setModQty] = useState("");

  const wh = authorization.warehouse || [];
  const who = authorization.wholesaler || [];
  const dist = authorization.distributor || [];

  const decide = async (id, action, quantity) => {
    setBusy(id);
    try {
      const res = await Api.logisticsDecideRequest(id, action, quantity);
      if (action === "reject") toast.success("Request rejected");
      else toast.success(res?.transfer_number ? `Approved · transfer ${res.transfer_number} created` : "Request approved");
      setModifying(null);
      onChanged?.();
    } catch (e) {
      toast.error("Decision failed", { description: e?.response?.data?.detail || e?.message });
    } finally {
      setBusy(null);
    }
  };

  const tabs = [
    ["warehouse", `Warehouse (${wh.length})`],
    ["distributor", `Distributor (${dist.length})`],
    ["wholesaler", `Wholesaler (${who.length})`],
  ];

  const renderRequest = (r) => (
    <div key={r.id} className="rounded-lg border border-slate-200 p-3" data-testid={`auth-request-${r.request_number}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-blue-700">{r.request_number}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${PRIORITY[r.priority] || PRIORITY.normal}`}>{r.priority}</span>
      </div>
      <div className="text-[12px] font-medium text-slate-900 mt-1.5 truncate">{r.requester_name}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">
        {r.product_name} · {num(r.quantity)} units
        {r.current_stock != null && <span> · on hand {num(r.current_stock)}</span>}
        {r.requested_date && <span> · needed {r.requested_date}</span>}
      </div>
      {modifying === r.id ? (
        <div className="flex items-center gap-1.5 mt-2.5">
          <Input
            type="number" min="1" value={modQty} onChange={(e) => setModQty(e.target.value)}
            className="h-7 w-28 text-[12px]" placeholder="New qty"
            data-testid={`auth-modify-qty-${r.request_number}`}
          />
          <Button
            size="sm" className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={busy === r.id || !Number(modQty)}
            onClick={() => decide(r.id, "modify", Number(modQty))}
            data-testid={`auth-modify-confirm-${r.request_number}`}
          >
            <Check className="h-3 w-3 mr-1" /> Confirm
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setModifying(null)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 mt-2.5">
          <Button
            size="sm" className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={busy === r.id}
            onClick={() => decide(r.id, "approve")}
            data-testid={`auth-approve-${r.request_number}`}
          >
            {busy === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />} Approve
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-rose-200 text-rose-600 hover:bg-rose-50"
            disabled={busy === r.id}
            onClick={() => decide(r.id, "reject")}
            data-testid={`auth-reject-${r.request_number}`}
          >
            <X className="h-3 w-3 mr-1" /> Reject
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-slate-200 text-slate-600"
            onClick={() => { setModifying(r.id); setModQty(String(r.quantity)); }}
            data-testid={`auth-modify-${r.request_number}`}
          >
            <Pencil className="h-3 w-3 mr-1" /> Modify
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden h-full flex flex-col" data-testid="authorization-panel">
      <div className="px-5 py-3 border-b border-slate-100 font-semibold text-slate-900 text-sm">
        Shipment Authorization Center
      </div>
      <div className="px-4 pt-3 flex items-center gap-1.5">
        {tabs.map(([key, label]) => (
          <button
            key={key} type="button" onClick={() => setTab(key)}
            data-testid={`auth-tab-${key}`}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
              tab === key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-[440px]" data-testid="auth-list">
        {tab === "warehouse" && (wh.length === 0
          ? <Empty text="No warehouse replenishment requests pending." />
          : wh.map(renderRequest))}
        {tab === "wholesaler" && (who.length === 0
          ? <Empty text="No wholesaler requests pending." />
          : who.map(renderRequest))}
        {tab === "distributor" && (dist.length === 0
          ? <Empty text="No distributor purchase orders pending." />
          : dist.map((q) => (
            <div key={q.order_id} className="rounded-lg border border-slate-200 p-3" data-testid={`auth-dist-${q.number}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-blue-700">{q.number}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${PRIORITY[q.priority] || PRIORITY.normal}`}>{q.priority}</span>
              </div>
              <div className="text-[12px] font-medium text-slate-900 mt-1.5 truncate">{q.distributor_name}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{num(q.requested_units)} units · {q.region}</div>
              <Button
                size="sm" variant="outline" className="h-7 px-2.5 text-[11px] mt-2.5 border-blue-200 text-blue-700"
                onClick={() => navigate("/manufacturer/allocation")}
                data-testid={`auth-dist-open-${q.number}`}
              >
                Open in Allocation Center →
              </Button>
            </div>
          )))}
      </div>
    </div>
  );
};

const Empty = ({ text }) => (
  <div className="text-sm text-slate-400 py-8 text-center">{text}</div>
);

// ============================================================================
// Inventory Transfer Management
// ============================================================================
const TRANSFER_STATUS = {
  processing: "bg-amber-100 text-amber-800",
  in_transit: "bg-emerald-100 text-emerald-700",
  delivered: "bg-slate-100 text-slate-600",
  cancelled: "bg-rose-100 text-rose-700",
};

export const TransfersPanel = ({ transfers, onCreate, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const active = transfers.active || [];

  const advance = async (id, action) => {
    setBusy(id);
    try {
      await Api.logisticsAdvanceTransfer(id, action);
      toast.success(action === "deliver" ? "Transfer delivered — destination stock credited" : "Transfer cancelled — source stock restored");
      onChanged?.();
    } catch (e) {
      toast.error("Update failed", { description: e?.response?.data?.detail || e?.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden h-full flex flex-col" data-testid="transfers-panel">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="font-semibold text-slate-900 text-sm">Inventory Transfer Management</div>
        <Button size="sm" className="h-7 text-[11px] bg-blue-600 hover:bg-blue-700 text-white" onClick={onCreate} data-testid="transfers-create-btn">
          <Plus className="h-3 w-3 mr-1" /> Create Transfer
        </Button>
      </div>
      <div className="p-4 space-y-3 flex-1 overflow-y-auto max-h-[440px]" data-testid="transfers-list">
        <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
          Active Transfers · {transfers.total || 0} total
        </div>
        {active.length === 0 ? (
          <Empty text="No active transfers. Create one to rebalance stock." />
        ) : active.map((t) => (
          <div key={t.id} className="rounded-lg border border-slate-200 p-3" data-testid={`transfer-${t.transfer_number}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold text-blue-700">{t.transfer_number}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${TRANSFER_STATUS[t.status] || TRANSFER_STATUS.processing}`}>
                {(t.status || "").replace("_", " ")}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-900 mt-1.5 flex-wrap">
              <span className="truncate max-w-[40%]">{t.from_warehouse_name}</span>
              <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="truncate max-w-[40%]">{t.to_warehouse_name}</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {num(t.quantity)} × {t.product_name} · {(t.reason || "").replace(/_/g, " ")}
              {t.vehicle_code && <span> · {t.vehicle_code}</span>}
            </div>
            {t.eta && (
              <div className="text-[11px] text-slate-500 mt-0.5">
                ETA {new Date(t.eta).toLocaleString("en-NG", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" })}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-2.5">
              <Button
                size="sm" variant="outline" className="h-7 px-2.5 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                disabled={busy === t.id}
                onClick={() => advance(t.id, "deliver")}
                data-testid={`transfer-deliver-${t.transfer_number}`}
              >
                <PackageCheck className="h-3 w-3 mr-1" /> Mark Delivered
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50"
                disabled={busy === t.id}
                onClick={() => advance(t.id, "cancel")}
                data-testid={`transfer-cancel-${t.transfer_number}`}
              >
                Cancel
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// Create Transfer dialog
// ============================================================================
const REASONS = [
  ["rebalancing", "Rebalancing"],
  ["emergency", "Emergency"],
  ["stockout_prevention", "Stockout Prevention"],
  ["demand_surge", "Demand Surge"],
];

export const CreateTransferDialog = ({ open, onOpenChange, warehouses, onCreated }) => {
  const { session } = useSession();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ from: "", to: "", product: "", qty: "", reason: "rebalancing" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || products.length) return;
    const mfrId = session?.entity?.id;
    Api.products(mfrId).then(setProducts).catch(() => setProducts([]));
  }, [open, products.length, session]);

  const sourceUnits = useMemo(
    () => warehouses.find((w) => w.id === form.from)?.units,
    [warehouses, form.from],
  );

  const submit = async () => {
    if (!form.from || !form.to || !form.product || !Number(form.qty)) {
      toast.error("Fill in all transfer fields");
      return;
    }
    setSubmitting(true);
    try {
      const t = await Api.logisticsCreateTransfer({
        from_warehouse_id: form.from,
        to_warehouse_id: form.to,
        product_id: form.product,
        quantity: Number(form.qty),
        reason: form.reason,
      });
      toast.success(`Transfer ${t.transfer_number} created`, {
        description: `${num(t.quantity)} units dispatched on ${t.vehicle_code || "a truck"}.`,
      });
      setForm({ from: "", to: "", product: "", qty: "", reason: "rebalancing" });
      onCreated?.();
    } catch (e) {
      toast.error("Could not create transfer", { description: e?.response?.data?.detail || e?.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="create-transfer-dialog">
        <DialogHeader>
          <DialogTitle>Create Inventory Transfer</DialogTitle>
          <DialogDescription>Move stock between warehouses. Source inventory is reserved immediately.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Source Warehouse">
            <Select value={form.from} onValueChange={(v) => setForm((f) => ({ ...f, from: v }))}>
              <SelectTrigger data-testid="transfer-from-select"><SelectValue placeholder="Select source" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id} disabled={w.id === form.to}>
                    {w.name} · {num(w.units)} units
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Destination Warehouse">
            <Select value={form.to} onValueChange={(v) => setForm((f) => ({ ...f, to: v }))}>
              <SelectTrigger data-testid="transfer-to-select"><SelectValue placeholder="Select destination" /></SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id} disabled={w.id === form.from}>
                    {w.name} · {num(w.units)} units
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Product">
            <Select value={form.product} onValueChange={(v) => setForm((f) => ({ ...f, product: v }))}>
              <SelectTrigger data-testid="transfer-product-select"><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Quantity${sourceUnits != null ? ` · source holds ${num(sourceUnits)} units total` : ""}`}>
            <Input
              type="number" min="1" placeholder="e.g. 4000"
              value={form.qty}
              onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))}
              data-testid="transfer-qty-input"
            />
          </Field>
          <Field label="Reason">
            <Select value={form.reason} onValueChange={(v) => setForm((f) => ({ ...f, reason: v }))}>
              <SelectTrigger data-testid="transfer-reason-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="transfer-cancel-btn">Cancel</Button>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={submit} disabled={submitting} data-testid="transfer-submit-btn">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Truck className="h-4 w-4 mr-1.5" />}
            Create Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({ label, children }) => (
  <div>
    <div className="text-[11px] font-semibold text-slate-600 mb-1">{label}</div>
    {children}
  </div>
);
