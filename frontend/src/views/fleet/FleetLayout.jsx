/**
 * Fleet workspace layout — Phase B4+
 *
 * Shared `/fleet/*` surface for Manufacturer / Distributor / Wholesaler /
 * Warehouse / Super Admin dispatchers. Driver and Retailer roles are denied
 * with a friendly redirect.
 *
 * Outer chrome lives in the main `Layout` (sidebar + top bar). This file
 * renders the secondary fleet nav (Dashboard / Drivers / Vehicles /
 * Dispatch / Compliance / Command Centre) as a horizontal sub-nav strip
 * above an `<Outlet />` so individual fleet pages remain composable.
 */
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Gauge, Users, Truck, ClipboardList, ShieldAlert, Radio, BarChart3,
} from "lucide-react";
import { useSession } from "@/context/SessionContext";
import { useEffect } from "react";

const FLEET_ROLES = new Set([
  "manufacturer", "distributor", "wholesaler", "warehouse", "super_admin",
]);

const TABS = [
  { to: "/fleet/dashboard",       label: "Dashboard",      icon: Gauge,         testid: "fleet-tab-dashboard" },
  { to: "/fleet/drivers",         label: "Drivers",        icon: Users,         testid: "fleet-tab-drivers" },
  { to: "/fleet/vehicles",        label: "Vehicles",       icon: Truck,         testid: "fleet-tab-vehicles" },
  { to: "/fleet/dispatch",        label: "Dispatch",       icon: ClipboardList, testid: "fleet-tab-dispatch" },
  { to: "/fleet/compliance",      label: "Compliance",     icon: ShieldAlert,   testid: "fleet-tab-compliance" },
  { to: "/fleet/command-centre",  label: "Command Centre", icon: Radio,         testid: "fleet-tab-command-centre" },
  { to: "/fleet/analytics",       label: "Analytics",      icon: BarChart3,     testid: "fleet-tab-analytics" },
];

export default function FleetLayout() {
  const { session } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session && !FLEET_ROLES.has(session.role)) {
      navigate("/dashboard", { replace: true });
    }
  }, [session, navigate]);

  if (!session || !FLEET_ROLES.has(session.role)) return null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]" data-testid="fleet-layout">
      <div
        className="border-b border-slate-200/80 bg-white/80 backdrop-blur-sm sticky top-0 z-10"
        data-testid="fleet-subnav"
      >
        <div className="flex flex-wrap items-center gap-1 px-6 py-2">
          {TABS.map(({ to, label, icon: Icon, testid }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={testid}
              className={({ isActive }) =>
                [
                  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100",
                ].join(" ")
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="flex-1 px-6 py-6" data-testid="fleet-content">
        <Outlet />
      </div>
    </div>
  );
}
