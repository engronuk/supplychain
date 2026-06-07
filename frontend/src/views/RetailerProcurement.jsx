/**
 * Retailer Procurement Workspace — Enterprise edition.
 *
 * Renames the old "Requests" page (one flat list of stock requests) into a
 * full procurement lifecycle workspace with four tabs:
 *   - Cart
 *   - Purchase Orders
 *   - Order History
 *   - Supplier Quotes
 * Plus an always-visible AI Procurement Assistant panel on the right.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart, FileText, History, Quote as QuoteIcon,
  Sparkles, BrainCircuit, Loader2,
} from "lucide-react";

import CartTab from "@/components/procurement/CartTab";
import PurchaseOrdersTab from "@/components/procurement/PurchaseOrdersTab";
import OrderHistoryTab from "@/components/procurement/OrderHistoryTab";
import SupplierQuotesTab from "@/components/procurement/SupplierQuotesTab";
import AIProcurementAssistant from "@/components/procurement/AIProcurementAssistant";

const TAB_LIST = [
  { value: "cart", label: "Cart", icon: ShoppingCart },
  { value: "orders", label: "Purchase Orders", icon: FileText },
  { value: "history", label: "Order History", icon: History },
  { value: "quotes", label: "Supplier Quotes", icon: QuoteIcon },
];

export default function RetailerProcurement() {
  const { session } = useSession();
  const retailerId = session?.entity?.id;
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "cart";
  const setTab = (v) => setParams({ tab: v }, { replace: true });

  const [counts, setCounts] = useState({ cart: 0, open_pos: 0, open_quotes: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  // Refresh the badge counts whenever any tab mutates data.
  useEffect(() => {
    if (!retailerId) return;
    let cancel = false;
    Promise.all([
      Api.cart(retailerId).catch(() => null),
      Api.purchaseOrders({
        retailer_id: retailerId,
        statuses: "draft,submitted,approved,processing,shipped",
      }).catch(() => []),
      Api.quotes({ retailer_id: retailerId, status: "open" }).catch(() => []),
      Api.quotes({ retailer_id: retailerId, status: "responded" }).catch(() => []),
    ]).then(([cart, pos, openQ, respQ]) => {
      if (cancel) return;
      setCounts({
        cart: cart?.unique_skus || 0,
        open_pos: (pos || []).length,
        open_quotes: (openQ?.length || 0) + (respQ?.length || 0),
      });
    });
    return () => { cancel = true; };
  }, [retailerId, reloadKey]);

  const onMutated = () => setReloadKey((k) => k + 1);

  if (!retailerId) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="retailer-procurement">
      <div className="px-8 py-7 max-w-[1760px] mx-auto">
        <Header />

        <div className="grid grid-cols-12 gap-6 mt-6">
          {/* Main workspace */}
          <div className="col-span-12 xl:col-span-9 space-y-6">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList
                className="bg-white border border-slate-200 shadow-sm rounded-2xl p-1.5 h-auto flex-wrap justify-start gap-1"
                data-testid="procurement-tabs"
              >
                {TAB_LIST.map(({ value, label, icon: Icon }) => {
                  const badge =
                    value === "cart" ? counts.cart :
                    value === "orders" ? counts.open_pos :
                    value === "quotes" ? counts.open_quotes : 0;
                  return (
                    <TabsTrigger
                      key={value}
                      value={value}
                      data-testid={`tab-${value}`}
                      className="rounded-xl px-4 h-10 text-sm font-medium text-slate-600 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-sm gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {badge > 0 && (
                        <Badge className="ml-1 bg-violet-100 text-violet-700 hover:bg-violet-100 text-[10px] h-5 px-1.5 data-[state=active]:bg-white/20 data-[state=active]:text-white">
                          {badge}
                        </Badge>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              <TabsContent value="cart" className="mt-5">
                <CartTab retailerId={retailerId} onMutated={onMutated} />
              </TabsContent>
              <TabsContent value="orders" className="mt-5">
                <PurchaseOrdersTab retailerId={retailerId} onMutated={onMutated} />
              </TabsContent>
              <TabsContent value="history" className="mt-5">
                <OrderHistoryTab retailerId={retailerId} />
              </TabsContent>
              <TabsContent value="quotes" className="mt-5">
                <SupplierQuotesTab retailerId={retailerId} onMutated={onMutated} />
              </TabsContent>
            </Tabs>
          </div>

          {/* AI Procurement Assistant — sticky right rail on large screens */}
          <div className="col-span-12 xl:col-span-3">
            <div className="xl:sticky xl:top-4">
              <AIProcurementAssistant
                retailerId={retailerId}
                onMutated={onMutated}
                onSwitchTab={setTab}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-start justify-between gap-6" data-testid="procurement-header">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-violet-700 font-semibold mb-1">
          <Sparkles className="h-3 w-3" /> Procurement Workspace
        </div>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
          Smarter sourcing for your store
        </h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
          Plan reorders, manage purchase orders end-to-end, compare supplier quotes, and let the
          AI assistant guard your shelves against stockouts — all in one workspace.
        </p>
      </div>
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <div className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white px-3 text-[11px] font-semibold shadow-sm">
          <BrainCircuit className="h-3.5 w-3.5" /> AI ASSISTED
        </div>
      </div>
    </div>
  );
}
