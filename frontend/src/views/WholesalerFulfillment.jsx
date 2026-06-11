import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PageHeader, EmptyState, fmtNumber,
} from "./wholesaler/ui";
import {
  PackageOpen, ScanLine, PackageCheck, Truck, AlertTriangle, RefreshCw,
} from "lucide-react";

const STAGES = ["allocated", "picking", "picked", "packing", "packed", "ready_for_dispatch", "dispatched", "delivered"];
const STAGE_TONE = {
  allocated: "bg-violet-100 text-violet-700",
  picking:   "bg-amber-100 text-amber-700",
  picked:    "bg-amber-100 text-amber-700",
  packing:   "bg-blue-100 text-blue-700",
  packed:    "bg-blue-100 text-blue-700",
  ready_for_dispatch: "bg-indigo-100 text-indigo-700",
  dispatched: "bg-sky-100 text-sky-700",
  delivered:  "bg-emerald-100 text-emerald-700",
};

export default function WholesalerFulfillment({ embedded = false }) {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeId, setActiveId] = useState(null);

  const refresh = () => {
    if (!wid) return;
    setLoading(true);
    WholesalerApi.listFulfillments(wid)
      .then(setRows)
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [wid]);

  const filtered = statusFilter === "all"
    ? rows
    : rows.filter((r) => r.status === statusFilter);

  return (
    <div className={embedded ? "space-y-6" : "p-6 md:p-8 space-y-6"} data-testid="wholesaler-fulfillment">
      {!embedded && (
        <PageHeader
          title="Fulfillment Workflow"
          subtitle="Pick, pack, and dispatch approved distributor orders."
          action={
            <Button variant="outline" size="sm" onClick={refresh} data-testid="ful-refresh">
              <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
          }
        />
      )}
      {embedded && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={refresh} data-testid="ful-refresh">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Fulfillment Queue ({filtered.length})</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="ful-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-slate-500 py-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <EmptyState title="No fulfillments" body="Approve a distributor order to seed a fulfillment." />
          ) : (
            <div className="space-y-3">
              {filtered.map((f) => (
                <FulCard key={f.id} f={f} onOpen={() => setActiveId(f.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <FulfillmentModal
        fid={activeId}
        wid={wid}
        onClose={() => setActiveId(null)}
        onChange={refresh}
      />
    </div>
  );
}

function FulCard({ f, onOpen }) {
  const stepIdx = STAGES.indexOf(f.status);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left p-4 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all"
      data-testid={`ful-card-${f.fulfillment_number}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{f.fulfillment_number}</span>
            <Badge className={`font-medium ${STAGE_TONE[f.status] || ""}`}>{f.status}</Badge>
            {f.shortage_reported && (
              <Badge className="bg-rose-100 text-rose-700 font-medium">shortage</Badge>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {f.order_number} · {f.distributor?.name} · {f.distributor?.region} · {(f.items || []).length} lines
          </div>
        </div>
        <div className="text-xs text-slate-500">
          Priority: <span className="font-medium text-slate-700">{f.priority}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1">
        {STAGES.map((s, i) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= stepIdx ? "bg-violet-500" : "bg-slate-100"}`} title={s} />
        ))}
      </div>
    </button>
  );
}

function FulfillmentModal({ fid, wid, onClose, onChange }) {
  const [ful, setFul] = useState(null);
  const [pickQty, setPickQty] = useState({});           // product_id → picked
  const [shortageNote, setShortageNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!fid) { setFul(null); return; }
    WholesalerApi.fulfillmentDetail(wid, fid).then((f) => {
      setFul(f);
      const init = {};
      for (const it of f.items || []) init[it.product_id] = it.picked_quantity || it.quantity;
      setPickQty(init);
    });
  }, [fid, wid]);

  if (!fid) return null;
  if (!ful) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="sr-only">Loading fulfillment</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-sm text-slate-500">Loading…</div>
        </DialogContent>
      </Dialog>
    );
  }

  const run = async (action, payload) => {
    setSaving(true);
    try {
      await WholesalerApi.fulfillmentAction(wid, fid, action, payload);
      toast.success(`Fulfillment ${action.replace("-", " ")}d`);
      const updated = await WholesalerApi.fulfillmentDetail(wid, fid);
      setFul(updated);
      onChange();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed");
    } finally { setSaving(false); }
  };

  const stage = ful.status;
  const isPicking = stage === "picking";
  const isPacking = stage === "packing";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="fulfillment-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ful.fulfillment_number}
            <Badge className={STAGE_TONE[stage]}>{stage}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            Order <strong>{ful.order_number}</strong> · Distributor <strong>{ful.distributor?.name}</strong> · {ful.distributor?.region}
          </div>

          {ful.shortage_reported && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" data-testid="shortage-banner">
              <strong>Shortage reported:</strong> {ful.shortage_note}
            </div>
          )}

          {/* Picking screen */}
          {(stage === "allocated" || isPicking) && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ScanLine className="h-4 w-4 text-violet-600" /> Picking
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b">
                        <th className="py-2 px-2">Product</th>
                        <th className="py-2 px-2">SKU</th>
                        <th className="py-2 px-2">Batch</th>
                        <th className="py-2 px-2 text-right">Quantity</th>
                        {isPicking && <th className="py-2 px-2 text-right">Picked</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ful.items.map((it) => (
                        <tr key={it.product_id} className="border-b border-slate-100">
                          <td className="py-2 px-2 font-medium">{it.product_name}</td>
                          <td className="py-2 px-2 text-slate-500 text-xs">{it.sku || "—"}</td>
                          <td className="py-2 px-2 text-slate-500 text-xs">{it.batch_number || "—"}</td>
                          <td className="py-2 px-2 text-right">{fmtNumber(it.quantity)}</td>
                          {isPicking && (
                            <td className="py-2 px-2 text-right">
                              <Input
                                type="number" min={0} max={it.quantity}
                                value={pickQty[it.product_id] ?? it.quantity}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(it.quantity, Number(e.target.value) || 0));
                                  setPickQty((s) => ({ ...s, [it.product_id]: v }));
                                }}
                                className="w-24 ml-auto"
                                data-testid={`pick-qty-${it.product_id}`}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {isPicking && (
                  <div className="flex items-center gap-2 pt-2">
                    <Input
                      placeholder="Optional shortage note"
                      value={shortageNote}
                      onChange={(e) => setShortageNote(e.target.value)}
                      data-testid="shortage-note"
                    />
                    <Button
                      variant="outline" disabled={saving || !shortageNote}
                      onClick={() => run("report-shortage", { note: shortageNote })}
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      data-testid="report-shortage-btn"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" /> Report Shortage
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Packing screen */}
          {(stage === "picked" || isPacking) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-violet-600" /> Packing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-slate-500 mb-2">Packing list (auto-generated from picked quantities):</div>
                <ul className="text-sm space-y-1">
                  {ful.items.map((it) => (
                    <li key={it.product_id} className="flex justify-between border-b border-slate-100 py-1">
                      <span>{it.product_name} <span className="text-slate-400">· {it.sku || "—"}</span></span>
                      <span className="text-slate-600">{fmtNumber(it.picked_quantity || it.quantity)} units</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Dispatch screen */}
          {(stage === "packed" || stage === "ready_for_dispatch") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="h-4 w-4 text-violet-600" /> Dispatch
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm">
                  Delivery destination: <strong>{ful.distributor?.name}</strong>
                  {ful.distributor?.city ? ` · ${ful.distributor.city}` : ""} {ful.distributor?.region ? `, ${ful.distributor.region}` : ""}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Dispatching will create a shipment, decrement inventory, and mark the order as <strong>shipped</strong>.
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          {(ful.status_history || []).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                {ful.status_history.map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-slate-600">
                    <Badge className={STAGE_TONE[ev.status] || "bg-slate-100 text-slate-700"}>{ev.status}</Badge>
                    <span className="text-slate-400">{new Date(ev.at).toLocaleString()}</span>
                    <span className="text-slate-500 truncate">— {ev.by}{ev.note ? `: ${ev.note}` : ""}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {stage === "allocated" && (
            <Button onClick={() => run("start-picking", {})} disabled={saving} data-testid="ful-start-picking">
              Start Picking
            </Button>
          )}
          {isPicking && (
            <Button
              onClick={() => run("complete-picking", {
                items: ful.items.map((it) => ({
                  product_id: it.product_id,
                  picked_quantity: pickQty[it.product_id] ?? it.quantity,
                })),
              })}
              disabled={saving} data-testid="ful-complete-picking">
              Complete Picking
            </Button>
          )}
          {stage === "picked" && (
            <Button onClick={() => run("start-packing", {})} disabled={saving} data-testid="ful-start-packing">
              Start Packing
            </Button>
          )}
          {isPacking && (
            <Button onClick={() => run("complete-packing", {})} disabled={saving} data-testid="ful-complete-packing">
              Complete Packing
            </Button>
          )}
          {stage === "packed" && (
            <Button onClick={() => run("ready-dispatch", {})} disabled={saving} data-testid="ful-ready-dispatch">
              Mark Ready for Dispatch
            </Button>
          )}
          {stage === "ready_for_dispatch" && (
            <Button onClick={() => run("dispatch", {})} disabled={saving} data-testid="ful-dispatch">
              <Truck className="h-4 w-4 mr-1" /> Dispatch
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
