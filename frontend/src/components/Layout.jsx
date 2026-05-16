import { NavLink, Outlet } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import NotificationsPopover from "@/components/NotificationsPopover";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Boxes,
  Truck,
  MessageSquare,
  BarChart3,
  FileText,
  LogOut,
  Warehouse,
  Store,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/shipments", label: "Shipments", icon: Truck },
  { to: "/requests", label: "Requests", icon: MessageSquare },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/reports", label: "Reports", icon: FileText },
];

export default function Layout() {
  const { session, signOut } = useSession();
  if (!session) return null;
  const { role, entity } = session;
  const RoleIcon = role === "distributor" ? Warehouse : Store;

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-200 flex flex-col" data-testid="sidebar">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white">
            <Boxes className="h-5 w-5" />
            <span className="font-semibold tracking-tight">Supply Hub</span>
          </div>
          <div className="mt-4 flex items-center gap-2 bg-slate-800/60 rounded-lg px-3 py-2">
            <RoleIcon className="h-4 w-4 text-slate-300" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">{role}</div>
              <div className="text-sm font-medium truncate text-white" data-testid="active-entity-name">
                {entity.name}
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <Button
            variant="ghost"
            onClick={signOut}
            className="w-full justify-start text-slate-300 hover:bg-white/5 hover:text-white"
            data-testid="signout-btn"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Switch account
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-wider">{role} workspace</div>
            <div className="text-sm font-medium text-slate-900">{entity.name} · {entity.region}</div>
          </div>
          <NotificationsPopover role={role} entityId={entity.id} />
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
