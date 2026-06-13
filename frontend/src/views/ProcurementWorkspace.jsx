// Procurement workspace (manufacturer) — three desks in one place:
//   Order Allocation → bucket-driven order allocation center
//   Shipments        → shipment authorizations + Shipment Command Center
//   Planning & Ops   → transfers, pipeline, forecast, alerts, quick actions
// Tabs stay mounted after first visit so switching back is instant.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Package, SlidersHorizontal } from "lucide-react";
import ShipmentCommandCenter from "./ShipmentCommandCenter";
import AllocationCenter from "./AllocationCenter";
import AuthorizationSection from "./AuthorizationSection";
import { LogisticsOperations } from "./logistics/LogisticsOperations";

const VALID_TABS = ["allocation", "shipments", "ops"];

export default function ProcurementWorkspace() {
  const [params] = useSearchParams();
  const requested = params.get("tab");
  const initial = VALID_TABS.includes(requested) ? requested : "allocation";
  const [tab, setTab] = useState(initial);
  const [visited, setVisited] = useState({ [initial]: true });
  const switchTab = (t) => { setTab(t); setVisited((v) => ({ ...v, [t]: true })); };

  return (
    <div data-testid="procurement-workspace">
      <div className="px-4 md:px-8 pt-4 md:pt-5 flex justify-end">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" data-testid="procurement-tab-switch">
          <TabBtn active={tab === "allocation"} onClick={() => switchTab("allocation")} Icon={ClipboardList} label="Order Allocation" testId="tab-allocation" />
          <TabBtn active={tab === "shipments"} onClick={() => switchTab("shipments")} Icon={Package} label="Shipments" testId="tab-shipments" />
          <TabBtn active={tab === "ops"} onClick={() => switchTab("ops")} Icon={SlidersHorizontal} label="Planning & Ops" testId="tab-planning-ops" />
        </div>
      </div>
      {visited.allocation && (
        <div className={tab === "allocation" ? "" : "hidden"}>
          <div className="p-4 md:p-8 pt-4">
            <AllocationCenter />
          </div>
        </div>
      )}
      {visited.shipments && (
        <div className={tab === "shipments" ? "" : "hidden"}>
          <AuthorizationSection />
          <ShipmentCommandCenter />
        </div>
      )}
      {visited.ops && (
        <div className={tab === "ops" ? "" : "hidden"}>
          <div className="p-4 md:p-8 pt-4">
            <LogisticsOperations onGoShipments={() => switchTab("shipments")} />
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, Icon, label, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}
