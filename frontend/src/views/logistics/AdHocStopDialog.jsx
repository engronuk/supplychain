// Ad-hoc delivery dialog — create a brand-new shipment stop from the builder.
import { useState } from "react";
import { PackagePlus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../../components/ui/select";

export const AdHocStopDialog = ({ open, onOpenChange, destinations, products, onAdd }) => {
  const [query, setQuery] = useState("");
  const [dest, setDest] = useState(null);
  const [lines, setLines] = useState([{ product_id: "", quantity: "" }]);

  const filtered = (destinations || [])
    .filter((d) => !query
      || (d.name || "").toLowerCase().includes(query.toLowerCase())
      || (d.city || "").toLowerCase().includes(query.toLowerCase()))
    .slice(0, 30);

  const setLine = (i, patch) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const reset = () => { setQuery(""); setDest(null); setLines([{ product_id: "", quantity: "" }]); };

  const add = () => {
    if (!dest) return toast.error("Pick a destination");
    const items = lines
      .filter((l) => l.product_id && Number(l.quantity) > 0)
      .map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) }));
    if (!items.length) return toast.error("Add at least one product line with a quantity");
    onAdd({
      key: `adhoc-${Date.now()}`, ad_hoc: true,
      dest_id: dest.id, dest_type: dest.type, dest_name: dest.name,
      city: dest.city, lat: dest.lat, lng: dest.lng,
      units: items.reduce((a, b) => a + b.quantity, 0), items,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="bg-[#0B1220] border-slate-800 text-slate-200 sm:max-w-md" data-testid="adhoc-dialog">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-violet-400" /> Ad-hoc delivery
          </DialogTitle>
          <DialogDescription className="text-slate-500 text-xs">
            Creates a new shipment from the route's origin warehouse and adds it as a stop.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Destination picker */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Destination</div>
            {dest ? (
              <div className="flex items-center gap-2 rounded-lg bg-violet-500/10 border border-violet-500/40 px-2.5 py-2" data-testid="adhoc-dest-selected">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-slate-100 truncate">{dest.name}</div>
                  <div className="text-[10px] text-slate-500">{dest.city || dest.region || "—"} · {dest.type}</div>
                </div>
                <button type="button" onClick={() => setDest(null)} className="p-1 rounded hover:bg-slate-800 text-slate-400">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <Input
                  value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search distributors & wholesalers…"
                  className="h-8 bg-slate-900 border-slate-700 text-slate-200 text-xs placeholder:text-slate-600"
                  data-testid="adhoc-dest-search"
                />
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                  {filtered.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[11px] text-slate-500">No matches.</div>
                  ) : filtered.map((d) => (
                    <button
                      key={d.id} type="button" onClick={() => setDest(d)}
                      data-testid="adhoc-dest-row"
                      className="w-full text-left px-2.5 py-1.5 hover:bg-slate-800/60 transition-colors flex items-center gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-slate-200 truncate">{d.name}</div>
                        <div className="text-[10px] text-slate-500">{d.city || d.region || "—"}</div>
                      </div>
                      <span className={`text-[9px] font-semibold uppercase px-1 py-0.5 rounded border shrink-0 ${
                        d.type === "distributor"
                          ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
                          : "bg-violet-500/10 border-violet-500/30 text-violet-300"}`}>
                        {d.type}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Cargo lines */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Cargo</div>
            <div className="space-y-1.5">
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Select value={l.product_id} onValueChange={(v) => setLine(i, { product_id: v })}>
                    <SelectTrigger className="h-8 flex-1 bg-slate-900 border-slate-700 text-slate-200 text-xs" data-testid="adhoc-product-select">
                      <SelectValue placeholder="Product" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700 text-slate-200">
                      {(products || []).map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min="1" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: e.target.value })}
                    placeholder="Qty"
                    className="h-8 w-20 bg-slate-900 border-slate-700 text-slate-200 text-xs placeholder:text-slate-600"
                    data-testid="adhoc-qty-input"
                  />
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                            className="p-1 rounded hover:bg-slate-800 text-slate-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {lines.length < 3 && (
              <button
                type="button"
                onClick={() => setLines((p) => [...p, { product_id: "", quantity: "" }])}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
                data-testid="adhoc-add-line"
              >
                <Plus className="h-3 w-3" /> Add line
              </button>
            )}
          </div>

          <Button onClick={add} className="w-full h-9 bg-violet-600 hover:bg-violet-500 text-white" data-testid="adhoc-add-btn">
            <PackagePlus className="h-4 w-4 mr-1.5" /> Add stop to route
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
