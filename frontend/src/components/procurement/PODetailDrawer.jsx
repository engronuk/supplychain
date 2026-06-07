/**
 * Right-side sliding PO detail drawer — manifest, supplier info, lifecycle
 * timeline and actions (Duplicate, Cancel, Print/PDF).
 */
import { useEffect, useRef, useState } from "react";
import { Api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Truck, Package, X, Copy, Download, Loader2, CheckCircle2,
  Clock, ShieldCheck, Boxes, AlertCircle, FileText,
} from "lucide-react";
import { toast } from "sonner";
import POStatusBadge from "./POStatusBadge";

const fmtMoney = (n) => `₦${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString() : "—";

const LIFECYCLE = ["draft", "submitted", "approved", "processing", "shipped", "delivered"];

export default function PODetailDrawer({ poId, open, onOpenChange, role = "retailer", onMutated }) {
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const printRef = useRef(null);

  useEffect(() => {
    if (!open || !poId) return;
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.purchaseOrder(poId)
      .then((p) => { if (!cancelled) { setPo(p); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [poId, open]);

  const reload = () => {
    if (!poId) return;
    setLoading(true);
    Api.purchaseOrder(poId).then(setPo).finally(() => setLoading(false));
  };

  const act = async (action, payload = {}) => {
    setBusy(true);
    try {
      const updated = await Api.poAction(po.id, action, payload);
      setPo(updated);
      toast.success(`PO ${action}d`);
      onMutated?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || `Could not ${action} PO`);
    } finally { setBusy(false); }
  };

  const onDuplicate = async () => {
    setBusy(true);
    try {
      const dup = await Api.poAction(po.id, "duplicate");
      toast.success(`Created draft ${dup.po_number} from this PO`);
      onMutated?.();
      onOpenChange(false);
    } catch { toast.error("Could not duplicate"); }
    finally { setBusy(false); }
  };

  const onPrint = () => {
    // Open a print-only window with the PO content. Browser print dialog
    // gives the user "Save as PDF" out of the box (per user choice).
    if (!po) return;
    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) {
      toast.error("Pop-up blocked — allow pop-ups to download PDF");
      return;
    }
    win.document.write(buildPrintHtml(po));
    win.document.close();
    setTimeout(() => win.print(), 250);
  };

  const isRetailer = role === "retailer";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto p-0" data-testid="po-detail-drawer">
        {loading || !po ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading PO…
          </div>
        ) : (
          <div ref={printRef}>
            <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                    Purchase Order
                  </div>
                  <SheetTitle className="text-2xl font-semibold tracking-tight tabular-nums">
                    {po.po_number}
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-sm">
                    {isRetailer
                      ? <>Supplier: <span className="font-medium text-slate-700">{po.distributor?.name || "—"}</span></>
                      : <>Retailer: <span className="font-medium text-slate-700">{po.retailer?.name || "—"}</span></>}
                  </SheetDescription>
                </div>
                <div className="flex items-center gap-2">
                  <POStatusBadge status={po.status} />
                </div>
              </div>
            </SheetHeader>

            <div className="px-6 py-5 space-y-6">
              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Total" value={fmtMoney(po.total_amount)} accent="text-violet-700" />
                <Stat label="Items" value={po.items?.length || 0} />
                <Stat label="Units" value={po.items?.reduce((a, b) => a + b.quantity, 0) || 0} />
              </div>

              {/* Manifest */}
              <div>
                <SectionTitle icon={Boxes}>Order Manifest</SectionTitle>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">Product</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Qty</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Unit</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Line</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {po.items?.map((it, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-900">{it.product?.name || it.product_id?.slice(0, 8)}</div>
                            <div className="text-[11px] text-slate-400">{it.product?.category || ""}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{it.quantity}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(it.unit_cost)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmtMoney(it.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-semibold">
                        <td colSpan="3" className="px-4 py-2.5 text-right text-slate-600">Total</td>
                        <td className="px-4 py-2.5 text-right text-violet-700 tabular-nums">{fmtMoney(po.total_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <SectionTitle icon={Clock}>Lifecycle</SectionTitle>
                <LifecycleTimeline po={po} />
              </div>

              {po.note && (
                <div>
                  <SectionTitle icon={FileText}>Note</SectionTitle>
                  <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 italic">&ldquo;{po.note}&rdquo;</div>
                </div>
              )}

              {(po.cancel_reason || po.reject_reason) && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-sm text-rose-900">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <AlertCircle className="h-4 w-4" /> {po.cancel_reason ? "Cancelled" : "Rejected"} — reason
                  </div>
                  <div>{po.cancel_reason || po.reject_reason}</div>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2 sticky bottom-0">
              <Button variant="outline" onClick={onPrint} data-testid="po-print-pdf">
                <Download className="h-4 w-4 mr-1.5" /> Download PDF
              </Button>
              {isRetailer && (
                <>
                  <Button variant="outline" disabled={busy} onClick={onDuplicate} data-testid="po-duplicate">
                    <Copy className="h-4 w-4 mr-1.5" /> Duplicate
                  </Button>
                  {po.status === "draft" && (
                    <Button
                      disabled={busy}
                      onClick={() => act("submit")}
                      className="bg-violet-700 hover:bg-violet-800 text-white"
                      data-testid="po-submit"
                    >Submit</Button>
                  )}
                  {["draft", "submitted", "approved", "processing"].includes(po.status) && (
                    <Button
                      variant="outline" disabled={busy}
                      onClick={() => setCancelOpen(true)}
                      className="border-rose-200 text-rose-700 hover:bg-rose-50"
                      data-testid="po-cancel"
                    ><X className="h-4 w-4 mr-1.5" /> Cancel</Button>
                  )}
                </>
              )}
              {!isRetailer && (
                <>
                  {po.status === "submitted" && (
                    <>
                      <Button variant="outline" disabled={busy}
                              onClick={() => act("reject", { reason: "Distributor declined" })}
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              data-testid="po-reject">Reject</Button>
                      <Button disabled={busy} onClick={() => act("approve")}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              data-testid="po-approve">Approve</Button>
                    </>
                  )}
                  {po.status === "approved" && (
                    <Button disabled={busy} onClick={() => act("process")}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                            data-testid="po-process">Mark Processing</Button>
                  )}
                  {["approved", "processing"].includes(po.status) && (
                    <Button disabled={busy} onClick={() => act("ship")}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                            data-testid="po-ship"><Truck className="h-4 w-4 mr-1.5" /> Ship</Button>
                  )}
                  {po.status === "shipped" && (
                    <Button disabled={busy} onClick={() => act("deliver")}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            data-testid="po-deliver"><CheckCircle2 className="h-4 w-4 mr-1.5" /> Mark Delivered</Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Cancel reason dialog */}
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel PO {po?.po_number}?</DialogTitle>
              <DialogDescription>Please give a brief reason — your supplier will be notified.</DialogDescription>
            </DialogHeader>
            <CancelReasonForm onSubmit={async (reason) => {
              setCancelOpen(false);
              await act("cancel", { reason });
            }} />
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}

function CancelReasonForm({ onSubmit }) {
  const [reason, setReason] = useState("");
  return (
    <>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Found better pricing, no longer needed…"
        rows={3}
        data-testid="cancel-reason-textarea"
      />
      <DialogFooter className="mt-3">
        <Button
          onClick={() => onSubmit(reason)}
          disabled={!reason.trim()}
          className="bg-rose-600 hover:bg-rose-700 text-white"
          data-testid="confirm-cancel-po"
        >Confirm cancellation</Button>
      </DialogFooter>
    </>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${accent || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Icon className="h-4 w-4 text-slate-400" />
      <h4 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{children}</h4>
    </div>
  );
}

function LifecycleTimeline({ po }) {
  const flow = po.status === "rejected"
    ? ["draft", "submitted", "rejected"]
    : po.status === "cancelled"
    ? ["draft", "submitted", "cancelled"]
    : LIFECYCLE;
  const events = po.status_history || [];
  const lastIdx = flow.indexOf(po.status);
  return (
    <ol className="relative">
      {flow.map((stage, idx) => {
        const reached = events.find((e) => e.status === stage);
        const active = idx <= lastIdx;
        return (
          <li key={stage} className="flex items-start gap-3 pb-3">
            <div className="flex flex-col items-center">
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                active
                  ? (stage === "rejected" || stage === "cancelled" ? "bg-rose-500 border-rose-500 text-white" : "bg-emerald-500 border-emerald-500 text-white")
                  : "bg-white border-slate-200 text-slate-400"
              }`}>
                {idx + 1}
              </div>
              {idx < flow.length - 1 && (
                <div className={`w-0.5 flex-1 mt-1 ${active ? "bg-emerald-500" : "bg-slate-200"}`} style={{ minHeight: 18 }} />
              )}
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2">
                <POStatusBadge status={stage} />
                {reached && <span className="text-[11px] text-slate-500">{fmtDT(reached.at)}</span>}
              </div>
              {reached?.note && <div className="text-[12px] text-slate-500 mt-1 italic">{reached.note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function buildPrintHtml(po) {
  const lines = (po.items || []).map((it) => `
    <tr>
      <td>${escapeHtml(it.product?.name || it.product_id || "")}</td>
      <td style="text-align:right">${it.quantity}</td>
      <td style="text-align:right">₦${Number(it.unit_cost || 0).toLocaleString()}</td>
      <td style="text-align:right">₦${Number(it.line_total || 0).toLocaleString()}</td>
    </tr>
  `).join("");
  return `<!doctype html><html><head><meta charset="utf-8" />
    <title>${po.po_number}</title>
    <style>
      body { font-family: 'Helvetica', sans-serif; padding: 40px; color:#0f172a; }
      h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -.5px; }
      .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background:#ede9fe; color:#5b21b6; font-size:11px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; }
      .meta { color:#64748b; font-size:12px; margin: 6px 0 16px; }
      table { width:100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
      th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
      th { background:#f8fafc; text-align:left; text-transform:uppercase; font-size:10px; letter-spacing:.4px; color:#64748b; }
      tfoot td { font-weight:600; background:#f1f5f9; }
      .total { text-align:right; font-size:18px; font-weight:700; margin-top:14px; color:#5b21b6; }
      .label { font-size:10px; text-transform:uppercase; color:#94a3b8; letter-spacing:.5px; }
      .row { display:flex; justify-content: space-between; margin-top: 18px; }
      .grid2 { display:grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      .box { border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; }
      @media print { body { padding: 20px; } }
    </style></head><body>
    <div style="display:flex; align-items:flex-start; justify-content:space-between;">
      <div>
        <div class="badge">Purchase Order</div>
        <h1>${escapeHtml(po.po_number)}</h1>
        <div class="meta">Created ${new Date(po.created_at).toLocaleString()} · Status: ${po.status.toUpperCase()}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Total</div>
        <div class="total">₦${Number(po.total_amount || 0).toLocaleString()}</div>
      </div>
    </div>
    <div class="grid2">
      <div class="box"><div class="label">Supplier</div><div><strong>${escapeHtml(po.distributor?.name || "—")}</strong></div><div style="font-size:11px;color:#64748b">${escapeHtml(po.distributor?.city || "")} · ${escapeHtml(po.distributor?.region || "")}</div></div>
      <div class="box"><div class="label">Retailer</div><div><strong>${escapeHtml(po.retailer?.name || "—")}</strong></div><div style="font-size:11px;color:#64748b">${escapeHtml(po.retailer?.city || "")} · ${escapeHtml(po.retailer?.region || "")}</div></div>
    </div>
    <table>
      <thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Line</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">TOTAL</td><td style="text-align:right">₦${Number(po.total_amount || 0).toLocaleString()}</td></tr></tfoot>
    </table>
    ${po.note ? `<p style="margin-top:18px; font-size:12px; color:#475569;"><strong>Note:</strong> ${escapeHtml(po.note)}</p>` : ""}
  </body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
