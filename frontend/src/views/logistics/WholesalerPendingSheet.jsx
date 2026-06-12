// What's behind a wholesaler's "pending" badge — the open distributor
// orders waiting on that hub, with line-item detail.
import { useEffect, useState } from "react";
import { ClipboardList, Package } from "lucide-react";
import { Api } from "../../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../../components/ui/sheet";

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return iso; }
};

const STATUS_STYLE = {
  pending: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  submitted: "bg-sky-500/10 border-sky-500/30 text-sky-300",
  processing: "bg-violet-500/10 border-violet-500/30 text-violet-300",
};

export const WholesalerPendingSheet = ({ wholesaler, onClose }) => {
  const open = !!wholesaler;
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!wholesaler?.id) { setData(null); return; }
    let alive = true;
    Api.wholesalerPendingOrders(wholesaler.id)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ orders: [] }); });
    return () => { alive = false; };
  }, [wholesaler?.id]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      <SheetContent
        className="w-full sm:max-w-md bg-[#0B1220] border-slate-800 text-slate-200 overflow-y-auto"
        data-testid="wholesaler-pending-sheet"
      >
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-white flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-amber-300" />
            Pending at {wholesaler?.name}
          </SheetTitle>
          <SheetDescription className="text-slate-500 text-xs">
            Open distributor orders awaiting fulfillment by this hub
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {data === null ? (
            <div className="text-[12px] text-slate-500 py-6 text-center">Loading pending orders…</div>
          ) : (data.orders || []).length === 0 ? (
            <div className="text-[12px] text-slate-500 py-6 text-center">
              No pending orders right now — the badge will clear on the next refresh.
            </div>
          ) : (
            data.orders.map((o) => (
              <div
                key={o.id}
                className="rounded-xl bg-slate-900/70 border border-slate-800 p-3.5"
                data-testid="pending-order-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-mono text-slate-200">{o.order_number}</span>
                  <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${STATUS_STYLE[o.status] || STATUS_STYLE.pending}`}>
                    {o.status}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  From <span className="text-slate-200">{o.placed_by}</span>
                  {" · "}{o.units.toLocaleString()} units · {o.lines} line{o.lines === 1 ? "" : "s"}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Placed {fmtDate(o.created_at)}
                  {o.requested_delivery_date ? ` · needed by ${fmtDate(o.requested_delivery_date)}` : ""}
                </div>
                {(o.items || []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800/70 space-y-1">
                    {o.items.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 text-slate-300 truncate">
                          <Package className="h-3 w-3 text-slate-600 shrink-0" /> {it.name}
                        </span>
                        <span className="text-slate-400 tabular-nums shrink-0">{it.quantity.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
