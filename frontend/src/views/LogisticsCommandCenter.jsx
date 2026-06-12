// Manufacturer Logistics Command Center — Phase 1 event-driven Control Tower
// (live map, event stream, inventory-in-transit, digital twin) plus the
// planning & operations workspace (allocations, transfers, forecast).
// Route: /manufacturer/logistics-center
import { useState } from "react";
import { RadioTower, Satellite, SlidersHorizontal } from "lucide-react";
import { ControlTowerView } from "./logistics/ControlTowerView";
import { LogisticsOperations } from "./logistics/LogisticsOperations";

export default function LogisticsCommandCenter() {
  const [tab, setTab] = useState("tower");
  return (
    <div className="p-4 md:p-8 space-y-5" data-testid="logistics-command-center">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-blue-700 font-semibold mb-1">
            <Satellite className="h-3 w-3" /> Mission Control · Live Supply Chain
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Logistics Command Center</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Real-time, event-driven visibility from factory gate to retail shelf — every truck, fence and exception in one cockpit.
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" data-testid="logistics-tab-switch">
          <TabBtn active={tab === "tower"} onClick={() => setTab("tower")} Icon={RadioTower} label="Control Tower" testId="tab-control-tower" />
          <TabBtn active={tab === "ops"} onClick={() => setTab("ops")} Icon={SlidersHorizontal} label="Planning & Ops" testId="tab-operations" />
        </div>
      </div>

      {tab === "tower" ? <ControlTowerView /> : <LogisticsOperations />}
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
