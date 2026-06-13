import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "./wholesaler/ui";
import WholesalerProcurement from "./WholesalerProcurement";
import WholesalerOrders from "./WholesalerOrders";
import WholesalerFulfillment from "./WholesalerFulfillment";
import WholesalerShipments from "./WholesalerShipments";

const TABS = [
  { value: "purchase",      label: "Purchase Orders" },        // wholesaler → distributor (upstream)
  { value: "orders",        label: "Customer Orders" },        // retailer/dist → wholesaler (incoming)
  { value: "fulfillment",   label: "Fulfillment" },
  { value: "shipments",     label: "Shipments" },
];

/**
 * WholesalerProcurementHub — single tabbed workspace covering the
 * wholesaler's full order-to-delivery lifecycle:
 *
 *   Purchase Orders  →  upstream procurement from manufacturer/warehouse
 *   Distributor Orders → incoming demand from regional distributors
 *   Fulfillment      → pick / pack / dispatch workflow
 *   Shipments        → outbound shipment ledger + timeline
 *
 * Every tab loads exclusively from MongoDB via the existing /api/wholesaler/...
 * endpoints. No mock data anywhere.
 */
export default function WholesalerProcurementHub() {
  const { session } = useSession();
  const wid = session?.entity?.id;

  // Live counts in the tab pills — pulled from the same DB tables the
  // sub-views render. Refreshed whenever the user switches tabs.
  const [counts, setCounts] = useState({
    purchase: null, orders: null, fulfillment: null, shipments: null,
  });
  const [params, setParams] = useSearchParams();
  const initial = TABS.find((t) => t.value === params.get("tab"))?.value || "purchase";
  const [tab, setTab] = useState(initial);

  const setActiveTab = (v) => {
    setTab(v);
    setParams((p) => { const n = new URLSearchParams(p); n.set("tab", v); return n; });
  };

  // Fetch counts in parallel from the DB.
  const refreshCounts = async () => {
    if (!wid) return;
    try {
      const [pos, ordersDash, fuls, shipsDash] = await Promise.all([
        WholesalerApi.purchaseOrders(wid),
        WholesalerApi.ordersDashboard(wid),
        WholesalerApi.listFulfillments(wid),
        WholesalerApi.shipmentsDashboard(wid),
      ]);
      setCounts({
        purchase: (pos || []).filter((p) => p.status !== "delivered" && p.status !== "cancelled").length,
        orders: (ordersDash?.kpis?.pending_approval || 0)
              + (ordersDash?.kpis?.approved || 0)
              + (ordersDash?.kpis?.in_fulfillment || 0)
              + (ordersDash?.kpis?.backordered || 0),
        fulfillment: (fuls || []).filter((f) => f.status !== "delivered").length,
        shipments: (shipsDash?.kpis?.active_shipments || 0),
      });
    } catch (e) {
      // Silent — tabs still work without badges if API hiccups.
    }
  };

  useEffect(() => { refreshCounts(); }, [wid, tab]);

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-procurement-hub">
      <PageHeader
        title="Procurement"
        subtitle="Buy from distributors upstream · serve retailer orders · pick/pack & ship — one workspace."
      />

      <Tabs value={tab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList data-testid="procurement-hub-tabs" className="flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              data-testid={`tab-${t.value}`}
              className="data-[state=active]:font-semibold flex items-center gap-2"
            >
              {t.label}
              {counts[t.value] != null && counts[t.value] > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-5 px-1.5 text-[10px] font-medium"
                  data-testid={`tab-count-${t.value}`}
                >
                  {counts[t.value]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="purchase" forceMount hidden={tab !== "purchase"}>
          <WholesalerProcurement embedded />
        </TabsContent>
        <TabsContent value="orders" forceMount hidden={tab !== "orders"}>
          <WholesalerOrders embedded />
        </TabsContent>
        <TabsContent value="fulfillment" forceMount hidden={tab !== "fulfillment"}>
          <WholesalerFulfillment embedded />
        </TabsContent>
        <TabsContent value="shipments" forceMount hidden={tab !== "shipments"}>
          <WholesalerShipments embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}
