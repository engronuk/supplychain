import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Api } from "@/lib/api";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package, Boxes, Truck, MapPin, Building2, Mail, Phone,
  Loader2, ExternalLink, Edit2, TrendingUp, AlertTriangle,
  Warehouse, Store, Receipt, BarChart3, Tag,
} from "lucide-react";
import EditProductDialog from "./EditProductDialog";
import EditDistributorDialog from "./EditDistributorDialog";
import AdjustInventoryDialog from "./AdjustInventoryDialog";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString();
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// ---------------------------------------------------------------------------
// Manufacturer Product Drawer
// ---------------------------------------------------------------------------
export function ProductDrawer({ open, onOpenChange, manufacturerId, productId, onUpdated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const load = () => {
    if (!productId || !manufacturerId) return;
    setLoading(true);
    Api.manufacturerProductDetail(manufacturerId, productId)
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open && productId) load();
    if (!open) setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId, manufacturerId]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="product-drawer">
          {loading || !data ? (
            <DrawerSkeleton />
          ) : (
            <div>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-1.5">
                      <Tag className="h-3 w-3" /> {data.product.category || "Product"}
                    </div>
                    <SheetTitle className="font-display text-2xl tracking-tight mt-1">
                      {data.product.name}
                    </SheetTitle>
                    <SheetDescription className="font-mono text-xs text-graphite mt-1">
                      SKU {data.product.sku} · {fmtMoney(data.product.unit_price)} per unit
                    </SheetDescription>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setEditOpen(true)}
                    data-testid="drawer-edit-product-btn"
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                </div>
              </SheetHeader>

              <Section icon={Boxes} title="Inventory">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Distributor stock" value={data.inventory.distributor_units.toLocaleString()} />
                  <Metric label="Retailer stock" value={data.inventory.retailer_units.toLocaleString()} />
                  <Metric label="Available" value={data.inventory.available.toLocaleString()} />
                  <Metric label="Reserved" value={data.inventory.reserved.toLocaleString()} />
                </div>
                <div className="mt-3 text-xs text-graphite flex items-center justify-between">
                  <span>Last restock: {fmtDate(data.inventory.last_restock_at)}</span>
                  <button
                    onClick={() => setAdjustOpen(true)}
                    className="text-amber underline-offset-2 hover:underline font-medium"
                    data-testid="drawer-adjust-inventory-btn"
                  >
                    Adjust inventory →
                  </button>
                </div>
              </Section>

              <Section icon={Warehouse} title="Distribution">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Distributors carrying" value={`${data.distribution.distributors_carrying} / ${data.distribution.distributors_total}`} />
                  <Metric label="Retailers stocking" value={`${data.distribution.retailers_stocking} / ${data.distribution.retailers_total}`} />
                </div>
                <div className="mt-3 space-y-1.5 max-h-44 overflow-y-auto">
                  {data.distribution.by_distributor.slice(0, 6).map((d) => (
                    <div key={d.distributor_id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <div className="min-w-0">
                        <div className="text-ink truncate text-sm">{d.distributor_name}</div>
                        <div className="text-xs text-graphite">{d.region}{d.city ? ` · ${d.city}` : ""}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">{d.quantity.toLocaleString()}u</div>
                        <div className="text-xs text-graphite">{fmtMoney(d.revenue_90d)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section icon={BarChart3} title="Analytics · 90d">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Revenue" value={fmtMoney(data.analytics.total_revenue_90d)} tone="moss" />
                  <Metric label="Units sold" value={data.analytics.total_units_90d.toLocaleString()} />
                  <Metric label="Avg daily sales" value={`${data.analytics.avg_daily_sales} u`} />
                  <Metric label="Inventory turnover" value={`${data.analytics.inventory_turnover}x`} />
                </div>
              </Section>

              <div className="mt-6 flex items-center gap-2">
                <Link
                  to={`/products/${data.product.id}`}
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                  data-testid="drawer-view-full-product-link"
                >
                  <Button className="w-full bg-ink hover:bg-ink/90 text-paper">
                    View full details <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {data && (
        <>
          <EditProductDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            product={data.product}
            onSaved={() => { setEditOpen(false); load(); onUpdated && onUpdated(); }}
          />
          <AdjustInventoryDialog
            open={adjustOpen}
            onOpenChange={setAdjustOpen}
            ownerType="manufacturer"
            ownerId={manufacturerId}
            product={data.product}
            currentQty={data.inventory.distributor_units}
            onSaved={() => { setAdjustOpen(false); load(); onUpdated && onUpdated(); }}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Manufacturer Distributor Drawer
// ---------------------------------------------------------------------------
export function DistributorDrawer({ open, onOpenChange, manufacturerId, distributorId, onUpdated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = () => {
    if (!distributorId || !manufacturerId) return;
    setLoading(true);
    Api.manufacturerDistributorDetail(manufacturerId, distributorId)
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open && distributorId) load();
    if (!open) setData(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, distributorId, manufacturerId]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" data-testid="distributor-drawer">
          {loading || !data ? (
            <DrawerSkeleton />
          ) : (
            <div>
              <SheetHeader className="pb-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-1.5">
                      <Building2 className="h-3 w-3" /> Distributor
                    </div>
                    <SheetTitle className="font-display text-2xl tracking-tight mt-1">
                      {data.distributor.name}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-graphite mt-1 flex items-center gap-3 flex-wrap" asChild>
                      <div>
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />
                          {data.distributor.region}{data.distributor.city ? ` · ${data.distributor.city}` : ""}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                          {data.distributor.status || "active"}
                        </Badge>
                      </div>
                    </SheetDescription>
                  </div>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setEditOpen(true)}
                    data-testid="drawer-edit-distributor-btn"
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                </div>
              </SheetHeader>

              <Section icon={Receipt} title="Contact">
                <div className="space-y-2 text-sm">
                  <ContactRow icon={Mail} label="Email"
                    value={data.distributor.contact_email}
                    action={data.distributor.contact_email ? `mailto:${data.distributor.contact_email}` : null} />
                  <ContactRow icon={Phone} label="Phone"
                    value={data.distributor.contact_phone}
                    action={data.distributor.contact_phone ? `tel:${data.distributor.contact_phone}` : null} />
                  <ContactRow icon={MapPin} label="Address" value={data.distributor.address} />
                </div>
              </Section>

              <Section icon={TrendingUp} title="Business metrics">
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Total orders" value={data.business_metrics.total_orders.toLocaleString()} />
                  <Metric label="Units distributed" value={data.business_metrics.total_units_distributed.toLocaleString()} />
                  <Metric label="Revenue generated" value={fmtMoney(data.business_metrics.revenue_generated)} tone="moss" />
                  <Metric label="Retailers downstream" value={data.business_metrics.retailers_count} />
                  <Metric label="Outstanding orders" value={`${data.business_metrics.outstanding_units}u`}
                    tone={data.business_metrics.outstanding_units > 0 ? "amber" : "default"} />
                  <Metric label="Growth (30d)"
                    value={data.business_metrics.growth_rate_pct === null ? "—" : `${data.business_metrics.growth_rate_pct >= 0 ? "+" : ""}${data.business_metrics.growth_rate_pct}%`}
                    tone={data.business_metrics.growth_rate_pct >= 0 ? "moss" : "amber"} />
                </div>
                <div className="mt-3 text-xs text-graphite">
                  Last order: {fmtDate(data.business_metrics.last_order_at)} ·
                  Order cadence: {data.business_metrics.avg_order_freq_days ? `${data.business_metrics.avg_order_freq_days}d avg` : "—"}
                </div>
              </Section>

              <Section icon={Package} title={`Product portfolio · ${data.product_portfolio.length}`}>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {data.product_portfolio.length === 0 && (
                    <div className="text-sm text-graphite py-3">No products carried yet.</div>
                  )}
                  {data.product_portfolio.slice(0, 8).map((p) => (
                    <div key={p.product_id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <div className="min-w-0">
                        <div className="text-ink truncate">{p.product_name}</div>
                        <div className="text-xs text-graphite font-mono">{p.sku}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">{p.quantity.toLocaleString()}u</div>
                        <div className="text-xs text-graphite">{fmtMoney(p.quantity * p.unit_price)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <div className="mt-6 flex items-center gap-2">
                <Link
                  to={`/distributors/${data.distributor.id}`}
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                  data-testid="drawer-view-full-distributor-link"
                >
                  <Button className="w-full bg-ink hover:bg-ink/90 text-paper">
                    View full details <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {data && (
        <EditDistributorDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          distributor={data.distributor}
          onSaved={() => { setEditOpen(false); load(); onUpdated && onUpdated(); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Section({ icon: Icon, title, children }) {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-graphite font-medium mb-3">
        <Icon className="h-3 w-3" /> {title}
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, tone = "default" }) {
  const toneClass =
    tone === "moss" ? "text-moss" :
    tone === "amber" ? "text-amber" : "text-ink";
  return (
    <div className="rounded-md border border-stone-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-graphite">{label}</div>
      <div className={`font-display text-xl tracking-tight mt-0.5 ${toneClass}`}>{value}</div>
    </div>
  );
}

function ContactRow({ icon: Icon, label, value, action }) {
  if (!value) return (
    <div className="flex items-center gap-2 text-graphite">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-xs uppercase tracking-wider">{label}</span>
      <span className="text-sm">—</span>
    </div>
  );
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 mt-0.5 text-graphite" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-graphite">{label}</div>
        {action ? (
          <a href={action} className="text-sm text-ink underline-offset-2 hover:underline break-all">{value}</a>
        ) : (
          <div className="text-sm text-ink break-all">{value}</div>
        )}
      </div>
    </div>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 py-4">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/3" />
      <div className="grid grid-cols-2 gap-3 pt-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="h-32 mt-3" />
      <div className="flex items-center justify-center pt-6 text-graphite gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading details…
      </div>
    </div>
  );
}
