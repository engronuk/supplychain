import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import NotificationsPopover from "@/components/NotificationsPopover";
import RetailerAssistantBubble from "@/components/RetailerAssistantBubble";
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
  Factory,
  Network,
  Radar,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const ROLE_ICON = {
  manufacturer: Factory,
  distributor: Warehouse,
  retailer: Store,
};

function navForRole(role) {
  const base = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/inventory", label: "Inventory", icon: Boxes },
    { to: "/shipments", label: "Shipments", icon: Truck },
  ];
  if (role === "manufacturer") {
    base.push({ to: "/network-map", label: "Network Map", icon: Radar });
    base.push({ to: "/network", label: "Distributors", icon: Network });
  } else if (role === "distributor") {
    base.push({ to: "/network", label: "Retailers", icon: Network });
    base.push({ to: "/requests", label: "Requests", icon: MessageSquare });
  } else if (role === "retailer") {
    base.push({ to: "/requests", label: "Requests", icon: MessageSquare });
  }
  base.push({ to: "/analytics", label: "Analytics", icon: BarChart3 });
  base.push({ to: "/reports", label: "Reports", icon: FileText });
  return base;
}

const COLLAPSE_KEY = "tk:sidebar:collapsed";

export default function Layout() {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const location = useLocation();

  // Persisted collapse state
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  // Mobile drawer
  const [mobileOpen, setMobileOpen] = useState(false);
  // close drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  if (!session) return null;
  const { role, entity } = session;
  const RoleIcon = ROLE_ICON[role] || Store;
  const nav = navForRole(role);

  const handleAssistantUiAction = (a) => {
    if (a.action === "open_smart_reorder" || a.action === "show_low_stock") {
      navigate("/dashboard");
      setTimeout(() => window.dispatchEvent(new CustomEvent("retailer:open-smart-reorder")), 100);
    } else if (a.action === "open_voice_order") {
      navigate("/dashboard");
      setTimeout(() => window.dispatchEvent(new CustomEvent("retailer:open-voice-order")), 100);
    }
  };
  const handleAssistantRefresh = () => {
    window.dispatchEvent(new CustomEvent("retailer:refresh-dashboard"));
  };

  // width tokens
  const sidebarW = collapsed ? "md:w-[72px]" : "md:w-64";
  const mainPad = collapsed ? "md:pl-[72px]" : "md:pl-64";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
          data-testid="sidebar-backdrop"
        />
      )}

      {/* Sidebar — fixed, full viewport height */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 bg-slate-900 text-slate-200 flex flex-col
          transition-all duration-300 ease-out
          w-64 ${sidebarW}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
        data-testid="sidebar"
        data-collapsed={collapsed ? "true" : "false"}
      >
        {/* Brand + collapse toggle */}
        <div className={`flex items-center border-b border-slate-800 ${collapsed ? "md:justify-center md:px-3" : "px-5"} py-4`}>
          <div className={`flex items-center gap-2 text-white ${collapsed ? "md:hidden" : ""}`}>
            <Boxes className="h-5 w-5" />
            <span className="font-semibold tracking-tight">TradeKonekt</span>
          </div>
          {collapsed && (
            <div className="hidden md:flex items-center justify-center">
              <Boxes className="h-5 w-5 text-white" />
            </div>
          )}
          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto h-8 w-8 rounded-lg text-slate-300 hover:bg-white/5 hover:text-white flex items-center justify-center md:hidden"
            aria-label="Close menu"
            data-testid="sidebar-mobile-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Workspace card */}
        <div className={`${collapsed ? "md:px-2 md:py-3" : "px-3 py-3"}`}>
          <div
            className={`flex items-center gap-2 bg-slate-800/60 rounded-lg ${
              collapsed ? "md:justify-center md:px-0 md:py-2" : "px-3 py-2"
            }`}
            title={collapsed ? `${role} · ${entity.name}` : ""}
          >
            <RoleIcon className="h-4 w-4 text-slate-300 flex-shrink-0" />
            <div className={`min-w-0 ${collapsed ? "md:hidden" : ""}`}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">{role}</div>
              <div className="text-sm font-medium truncate text-white" data-testid="active-entity-name">
                {entity.name}
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto ${collapsed ? "md:px-2" : "px-3"} pb-3 space-y-1`}>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              data-testid={`nav-${label.toLowerCase()}`}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg text-sm transition-colors
                ${collapsed ? "md:justify-center md:px-2 md:py-2.5 px-3 py-2" : "px-3 py-2"}
                ${
                  isActive
                    ? "bg-white/10 text-white shadow-inner shadow-white/5"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && !collapsed && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-white" />
                  )}
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className={`${collapsed ? "md:hidden" : ""}`}>{label}</span>
                  {/* Hover tooltip when collapsed (desktop only) */}
                  {collapsed && (
                    <span className="hidden md:group-hover:flex absolute left-full ml-2 px-2.5 py-1 rounded-md bg-slate-800 text-white text-xs whitespace-nowrap border border-slate-700 shadow-lg z-10">
                      {label}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer: sign out + collapse toggle */}
        <div className={`border-t border-slate-800 ${collapsed ? "md:px-2" : "px-3"} py-3 space-y-1`}>
          <Button
            variant="ghost"
            onClick={signOut}
            title={collapsed ? "Switch account" : undefined}
            className={`w-full text-slate-300 hover:bg-white/5 hover:text-white ${
              collapsed ? "md:justify-center md:px-2" : "justify-start"
            }`}
            data-testid="signout-btn"
          >
            <LogOut className="h-4 w-4" />
            <span className={`ml-2 ${collapsed ? "md:hidden" : ""}`}>Switch account</span>
          </Button>

          <button
            onClick={() => setCollapsed((v) => !v)}
            className={`hidden md:flex w-full items-center text-slate-400 hover:text-white hover:bg-white/5 rounded-lg text-xs font-medium transition-colors
              ${collapsed ? "justify-center px-2 py-2" : "justify-end px-3 py-2 gap-1"}`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-testid="sidebar-collapse-toggle"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main column shifts with sidebar width */}
      <div className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-out pl-0 ${mainPad}`}>
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="h-9 w-9 rounded-lg text-slate-700 hover:bg-slate-100 flex items-center justify-center md:hidden"
              aria-label="Open menu"
              data-testid="sidebar-mobile-open"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] md:text-xs text-slate-500 uppercase tracking-wider">{role} workspace</div>
              <div className="text-sm font-medium text-slate-900 truncate">
                {entity.name}{entity.region ? ` · ${entity.region}` : ""}{entity.city ? `, ${entity.city}` : ""}
              </div>
            </div>
          </div>
          <NotificationsPopover role={role} entityId={entity.id} />
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {/* Retailer-only floating AI assistant bubble */}
      {role === "retailer" && (
        <RetailerAssistantBubble
          onUiAction={handleAssistantUiAction}
          onRefresh={handleAssistantRefresh}
        />
      )}
    </div>
  );
}
