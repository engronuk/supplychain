/**
 * Retailer Product Detail — drill-down from the Full Inventory table.
 *
 * Shows everything a retailer needs to know about a single SKU:
 *   • Overview (name · SKU · barcode · category · manufacturer · cost price)
 *   • Stock health (quantity · reorder · velocity · days remaining)
 *   • Editable retail price + reorder level + free-text notes (with margin %)
 *   • Sales performance (30d / 90d) + 30-day daily trend chart
 *   • Recent supply (latest POs for this SKU)
 *
 * Manufacturer-set fields (sku, name, category, barcode, cost unit_price)
 * are read-only — only retailer-controlled fields are editable.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronLeft, Package, Tag, Barcode, Building2, AlertOctagon,
  AlertTriangle, ShieldCheck, TrendingUp, ShoppingCart, Loader2,
  PencilLine, Save, Receipt, Boxes, Calendar, Sparkles, BadgePercent,
} from "lucide-react";
import { toast } from "sonner";
import POStatusBadge from "@/components/procurement/POStatusBadge";

const fmtMoney = (n) => "₦" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS = {
  healthy:  { chip: "bg-emerald-100 text-emerald-800", icon: ShieldCheck,    label: "Healthy" },
  low:      { chip: "bg-amber-100 text-amber-800",     icon: AlertTriangle,  label: "Low stock" },
  critical: { chip: "bg-rose-100 text-rose-800",       icon: AlertOctagon,   label: "Critical" },
};

export default function RetailerProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const retailerId = session?.entity?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!retailerId || !productId) return;
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.retailerProductDetail(retailerId, productId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId, productId]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="retailer-product-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading product…
        </div>
      </div>
    );
  }

  const { product, manufacturer, inventory, performance, trend_30d, recent_supply } = data;
  const status = STATUS[inventory.status] || STATUS.healthy;
  const StatusIcon = status.icon;

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="retailer-product-detail">
      <div className="px-8 py-7 max-w-[1500px] mx-auto space-y-6">
        {/* Back link */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-900 transition-colors"
          data-testid="product-back"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Inventory
        </button>

        {/* Header */}
        <Card className="rounded-2xl shadow-sm border-slate-200 overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start gap-6 flex-wrap">
              <div className="h-24 w-24 rounded-2xl bg-violet-100 flex items-center justify-center shrink-0 overflow-hidden">
                {product.image_url ? (
                  <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-10 w-10 text-violet-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-[0.25em] text-violet-700 font-semibold mb-1">
                  Product Detail
                </div>
                <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{product.name}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-slate-600">
                  <Badge variant="outline" className="font-mono text-[11px] gap-1">
                    <Tag className="h-3 w-3" /> {product.sku || "—"}
                  </Badge>
                  {product.barcode && (
                    <Badge variant="outline" className="font-mono text-[11px] gap-1">
                      <Barcode className="h-3 w-3" /> {product.barcode}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[11px] gap-1">
                    <Boxes className="h-3 w-3" /> {product.category || "—"}
                  </Badge>
                  {manufacturer?.name && (
                    <Badge variant="outline" className="text-[11px] gap-1">
                      <Building2 className="h-3 w-3" /> {manufacturer.name}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge className={`gap-1.5 ${status.chip}`}>
                  <StatusIcon className="h-3.5 w-3.5" /> {status.label}
                </Badge>
                <Button
                  onClick={() => navigate("/procurement?tab=cart")}
                  className="bg-violet-700 hover:bg-violet-800 text-white"
                  data-testid="product-reorder-btn"
                >
                  <ShoppingCart className="h-4 w-4 mr-1.5" /> Reorder
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Kpi label="On Hand"        value={fmtInt(inventory.quantity)} accent="text-slate-900" />
          <Kpi label="Reorder Level"  value={fmtInt(inventory.reorder_level)} accent="text-slate-700" />
          <Kpi label="Velocity / day" value={inventory.velocity_30d} accent="text-blue-700" />
          <Kpi label="Days of cover"  value={inventory.days_remaining == null ? "—" : `${inventory.days_remaining}d`} accent={inventory.days_remaining != null && inventory.days_remaining <= 7 ? "text-rose-700" : "text-slate-900"} />
          <Kpi label="Last sale"      value={fmtDate(inventory.last_sale)} accent="text-slate-700" />
        </div>

        {/* Two-column: Pricing editor + Manufacturer overview */}
        <div className="grid grid-cols-12 gap-6">
          <PricingEditor data={data} retailerId={retailerId} productId={productId} onUpdated={setData} />
          <ProductOverviewCard product={product} manufacturer={manufacturer} inventory={inventory} />
        </div>

        {/* Sales performance + Trend */}
        <div className="grid grid-cols-12 gap-6">
          <PerformanceCard performance={performance} retail_price={inventory.retail_price} />
          <TrendCard trend={trend_30d} />
        </div>

        {/* Recent supply */}
        <RecentSupplyCard supply={recent_supply} />
      </div>
    </div>
  );
}

/* ---------- Pieces ---------- */
function Kpi({ label, value, accent }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200">
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className={`text-xl font-semibold tabular-nums mt-1 ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PricingEditor({ data, retailerId, productId, onUpdated }) {
  const { inventory } = data;
  const [retailPrice, setRetailPrice] = useState(inventory.retail_price ?? "");
  const [reorder, setReorder] = useState(inventory.reorder_level ?? 0);
  const [notes, setNotes] = useState(inventory.notes ?? "");
  const [saving, setSaving] = useState(false);

  const costPrice = inventory.cost_price || 0;
  const numericPrice = Number(retailPrice || 0);
  const margin = costPrice > 0 && numericPrice > 0
    ? ((numericPrice - costPrice) / costPrice * 100)
    : null;

  const save = async () => {
    setSaving(true);
    try {
      const updated = await Api.updateRetailerPricing(retailerId, productId, {
        retail_price: retailPrice === "" ? null : Number(retailPrice),
        reorder_level: Number(reorder),
        notes: notes || null,
      });
      onUpdated(updated);
      toast.success("Pricing updated");
    } catch {
      toast.error("Could not save pricing");
    } finally { setSaving(false); }
  };

  return (
    <Card className="col-span-12 lg:col-span-6 rounded-2xl shadow-sm border-slate-200" data-testid="pricing-editor">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <PencilLine className="h-4 w-4 text-violet-700" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Editable</div>
            <h3 className="text-base font-semibold text-slate-900">Retailer pricing & reorder rule</h3>
          </div>
        </div>

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm flex items-center justify-between mb-4">
          <span className="text-slate-500">Cost price (from supplier)</span>
          <span className="text-slate-900 font-semibold tabular-nums">{fmtMoney(costPrice)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Retail price (₦)</Label>
            <Input
              type="number" min="0" step="0.01"
              value={retailPrice}
              onChange={(e) => setRetailPrice(e.target.value)}
              placeholder="Set selling price"
              className="mt-1 tabular-nums"
              data-testid="edit-retail-price"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-wider text-slate-500">Reorder level</Label>
            <Input
              type="number" min="0"
              value={reorder}
              onChange={(e) => setReorder(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 tabular-nums"
              data-testid="edit-reorder-level"
            />
          </div>
        </div>

        {margin !== null && (
          <div className={`mt-3 rounded-xl border p-3 flex items-center justify-between text-sm ${
            margin >= 20 ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
            margin >= 0  ? "bg-violet-50 border-violet-200 text-violet-800" :
                           "bg-rose-50 border-rose-200 text-rose-800"
          }`} data-testid="margin-preview">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <BadgePercent className="h-4 w-4" /> Margin
            </span>
            <span className="font-bold tabular-nums">{margin.toFixed(1)}%</span>
          </div>
        )}

        <div className="mt-4">
          <Label className="text-xs uppercase tracking-wider text-slate-500">Internal notes</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. shelf-end promo until Saturday"
            className="mt-1"
            data-testid="edit-notes"
          />
        </div>

        <Button
          onClick={save}
          disabled={saving}
          className="mt-4 w-full bg-violet-700 hover:bg-violet-800 text-white"
          data-testid="save-pricing"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1.5" />}
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}

function ProductOverviewCard({ product, manufacturer, inventory }) {
  return (
    <Card className="col-span-12 lg:col-span-6 rounded-2xl shadow-sm border-slate-200" data-testid="product-overview-card">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-4 w-4 text-violet-700" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Manufacturer-set fields</div>
            <h3 className="text-base font-semibold text-slate-900">Product overview</h3>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="SKU" value={product.sku} mono />
          <Field label="Barcode" value={product.barcode} mono />
          <Field label="Category" value={product.category} />
          <Field label="Manufacturer" value={manufacturer?.name} />
          <Field label="Cost price" value={fmtMoney(product.unit_price)} mono />
          <Field label="Shelf life" value={product.shelf_life_days ? `${product.shelf_life_days} days` : "Not set"} />
          <Field label="Expiry date" value={product.expiry_date ? fmtDate(product.expiry_date) : "Not set"} />
          <Field label="Last updated" value={fmtDate(inventory.updated_at)} />
        </dl>
        {(!product.shelf_life_days && !product.expiry_date) && (
          <div className="mt-4 text-[11px] text-slate-400 italic">
            Expiry / shelf-life data is set by the manufacturer — ask them to enrich the catalog if missing.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</dt>
      <dd className={`mt-0.5 text-slate-900 ${mono ? "font-mono text-[13px]" : ""}`}>
        {value || <span className="text-slate-400 italic">—</span>}
      </dd>
    </div>
  );
}

function PerformanceCard({ performance, retail_price }) {
  const tableRows = [
    ["Units sold (30d)", fmtInt(performance.units_30d)],
    ["Revenue (30d)",    fmtMoney(performance.revenue_30d)],
    ["Units sold (90d)", fmtInt(performance.units_90d)],
    ["Revenue (90d)",    fmtMoney(performance.revenue_90d)],
  ];
  if (retail_price && performance.units_30d > 0) {
    tableRows.push(["Avg sell price (30d)", fmtMoney(performance.revenue_30d / performance.units_30d)]);
  }
  return (
    <Card className="col-span-12 lg:col-span-5 rounded-2xl shadow-sm border-slate-200" data-testid="performance-card">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <Receipt className="h-4 w-4 text-violet-700" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Sales performance</div>
            <h3 className="text-base font-semibold text-slate-900">Last 30 & 90 days</h3>
          </div>
        </div>
        <dl className="divide-y divide-slate-100">
          {tableRows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-2 text-sm">
              <dt className="text-slate-500">{k}</dt>
              <dd className="font-semibold text-slate-900 tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function TrendCard({ trend }) {
  const max = Math.max(...trend.map((t) => t.units), 1);
  const w = 600, h = 200, padL = 32, padR = 12, padT = 12, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const barW = innerW / trend.length - 2;
  return (
    <Card className="col-span-12 lg:col-span-7 rounded-2xl shadow-sm border-slate-200" data-testid="trend-card">
      <CardContent className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-4 w-4 text-violet-700" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Demand trend</div>
            <h3 className="text-base font-semibold text-slate-900">Units sold · last 30 days</h3>
          </div>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[200px]" preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <line key={i} x1={padL} x2={w - padR}
                  y1={padT + innerH * p} y2={padT + innerH * p}
                  stroke="#f1f5f9" strokeWidth="1" />
          ))}
          {trend.map((t, i) => {
            const hVal = (t.units / max) * innerH;
            const x = padL + i * (innerW / trend.length) + 1;
            const y = padT + innerH - hVal;
            return (
              <rect key={i} x={x} y={y} width={barW} height={hVal}
                    fill="#a78bfa" rx="2" />
            );
          })}
          {trend.filter((_, i) => i % 5 === 0).map((t, i) => (
            <text key={i} x={padL + (5 * i) * (innerW / trend.length)} y={h - 8}
                  fontSize="9" fill="#94a3b8" textAnchor="start">
              {t.date.slice(5)}
            </text>
          ))}
          {[0, 0.5, 1].map((p, i) => (
            <text key={i} x={padL - 6} y={padT + innerH * (1 - p) + 4}
                  fontSize="9" fill="#94a3b8" textAnchor="end">
              {Math.round(max * p)}
            </text>
          ))}
        </svg>
      </CardContent>
    </Card>
  );
}

function RecentSupplyCard({ supply }) {
  return (
    <Card className="rounded-2xl shadow-sm border-slate-200" data-testid="recent-supply-card">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-violet-700" />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Procurement history</div>
              <h3 className="text-base font-semibold text-slate-900">Recent purchase orders for this SKU</h3>
            </div>
          </div>
        </div>
        {supply.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-8">
            No purchase orders found — start by adding this SKU to your Procurement cart.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">PO #</th>
                  <th className="text-left px-3 py-2 font-semibold">Supplier</th>
                  <th className="text-left px-3 py-2 font-semibold">Date</th>
                  <th className="text-right px-3 py-2 font-semibold">Qty</th>
                  <th className="text-right px-3 py-2 font-semibold">Unit</th>
                  <th className="text-right px-3 py-2 font-semibold">Line</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {supply.map((s) => (
                  <tr key={s.po_number} data-testid={`supply-row-${s.po_number}`}>
                    <td className="px-3 py-2 font-mono font-semibold">{s.po_number}</td>
                    <td className="px-3 py-2 text-slate-700">{s.supplier}</td>
                    <td className="px-3 py-2 text-slate-500 tabular-nums">{fmtDate(s.date)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(s.unit_cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtMoney(s.line_total)}</td>
                    <td className="px-3 py-2"><POStatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
