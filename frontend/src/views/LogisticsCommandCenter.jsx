// Single Logistics Command Center — operational cockpit for every dispatcher.
//
// Manufacturer  : Control Tower · Fleet Status · Route Planning · AI Intelligence
// Distributor   : Fleet Status (tenant-scoped only)
// Wholesaler    : Fleet Status (tenant-scoped only)
//
// Tenant-scoped Control Tower for distributor/wholesaler is a P1 follow-up —
// the existing /api/logistics/control-tower endpoint is manufacturer-only.
//
// All dispatch actions (assign, reassign, cancel) live exclusively in the
// standalone /dispatch route. This workspace is monitoring + planning only.
import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Map, RadioTower, Satellite, Radio } from "lucide-react";
import { useSession } from "@/context/SessionContext";
import { ControlTowerView } from "./logistics/ControlTowerView";
import { RoutePlanningView } from "./logistics/RoutePlanningView";
import { LogisticsAIView } from "./logistics/LogisticsAIView";
import FleetStatusView from "./logistics/FleetStatusView";

const ALL_TABS = [
  { id: "tower",  label: "Control Tower",   icon: RadioTower,   testId: "tab-control-tower",   roles: ["manufacturer", "super_admin"] },
  { id: "fleet",  label: "Fleet Status",    icon: Radio,        testId: "tab-fleet-status",    roles: ["manufacturer", "distributor", "wholesaler", "super_admin"] },
  { id: "plan",   label: "Route Planning",  icon: Map,          testId: "tab-route-planning",  roles: ["manufacturer", "super_admin"] },
  { id: "ai",     label: "AI Intelligence", icon: BrainCircuit, testId: "tab-ai-insights",     roles: ["manufacturer", "super_admin"] },
];

export default function LogisticsCommandCenter() {
  const { session } = useSession();
  const role = session?.role || "manufacturer";

  const tabs = useMemo(() => ALL_TABS.filter((t) => t.roles.includes(role)), [role]);
  const [tab, setTab] = useState(tabs[0]?.id || "fleet");
  const [visited, setVisited] = useState({ [tabs[0]?.id || "fleet"]: true });

  // Defensive: if role changes and current tab not allowed, fall back.
  useEffect(() => {
    if (!tabs.find((t) => t.id === tab)) {
      const next = tabs[0]?.id || "fleet";
      setTab(next);
      setVisited((v) => ({ ...v, [next]: true }));
    }
  }, [tabs, tab]);

  const switchTab = (t) => {
    setTab(t);
    setVisited((v) => ({ ...v, [t]: true }));
  };

  const subtitle = role === "manufacturer" || role === "super_admin"
    ? "Real-time, event-driven visibility from factory gate to retail shelf — every truck, fence and exception in one cockpit."
    : "Tenant-scoped fleet monitoring · alerts · compliance · active shipments. Dispatch actions live in the standalone Dispatch Console.";

  return (
    <div className="p-4 md:p-8 space-y-5" data-testid="logistics-command-center">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-blue-700 font-semibold mb-1">
            <Satellite className="h-3 w-3" /> Mission Control · Live Supply Chain
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Logistics Command Center</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">{subtitle}</p>
        </div>
        {tabs.length > 1 && (
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" data-testid="logistics-tab-switch">
            {tabs.map((t) => (
              <TabBtn
                key={t.id}
                active={tab === t.id}
                onClick={() => switchTab(t.id)}
                Icon={t.icon}
                label={t.label}
                testId={t.testId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tabs stay mounted after first visit so switching back is instant. */}
      {tabs.find((t) => t.id === "tower") && (
        <div className={tab === "tower" ? "" : "hidden"}><ControlTowerView /></div>
      )}
      {tabs.find((t) => t.id === "fleet") && visited.fleet && (
        <div className={tab === "fleet" ? "" : "hidden"}><FleetStatusView /></div>
      )}
      {tabs.find((t) => t.id === "plan") && visited.plan && (
        <div className={tab === "plan" ? "" : "hidden"}><RoutePlanningView /></div>
      )}
      {tabs.find((t) => t.id === "ai") && visited.ai && (
        <div className={tab === "ai" ? "" : "hidden"}><LogisticsAIView /></div>
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
