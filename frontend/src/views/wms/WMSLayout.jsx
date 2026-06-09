import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Boxes, ArrowDownToLine, Truck, ArrowLeftRight, Undo2,
  ClipboardList, FileBarChart2, Bell, Building2, MapPin, Users, Package,
  Settings, Search, Mail, HelpCircle, Plus, ChevronDown, ChevronLeft,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";

const NAV = [
  { section: "Main", items: [
    { icon: LayoutDashboard, label: "Dashboard",   path: "/wms" },
    { icon: Boxes,            label: "Inventory",   path: "/wms/inventory" },
    { icon: ArrowDownToLine,  label: "Receiving",   path: "/wms/receiving" },
    { icon: Truck,            label: "Dispatch",    path: "/wms/dispatch" },
    { icon: ArrowLeftRight,   label: "Transfers",   path: "/wms/transfers" },
    { icon: Undo2,            label: "Returns",     path: "/wms/returns" },
    { icon: ClipboardList,    label: "Cycle Counts",path: "/wms/cycle-counts" },
    { icon: FileBarChart2,    label: "Reports",     path: "/wms/reports" },
    { icon: Bell,             label: "Alerts",      path: "/wms/alerts" },
  ]},
  { section: "Setup", items: [
    { icon: Building2, label: "Warehouses",   path: "/wms/warehouses" },
    { icon: MapPin,    label: "Locations",    path: "/wms/locations" },
    { icon: Users,     label: "Users & Roles",path: "/wms/users" },
    { icon: Package,   label: "Products",     path: "/wms/products" },
    { icon: Settings,  label: "Settings",     path: "/wms/settings" },
  ]},
];

export default function WMSLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, signOut } = useSession();
  const [warehouseOrg, setWarehouseOrg] = useState(null);
  const warehouseId = session?.entity?.id || session?.user?.entity_id;
  const isWarehouse = session?.role === "warehouse";

  useEffect(() => {
    if (!warehouseId) return;
    if (isWarehouse) {
      Api.organization(warehouseId).then(setWarehouseOrg).catch(() => {});
    } else {
      // super_admin / manufacturer — pick the first warehouse in tenant.
      Api.organizations({ organization_type: "warehouse" })
        .then((orgs) => orgs?.length && setWarehouseOrg(orgs[0]))
        .catch(() => {});
    }
  }, [warehouseId, isWarehouse]);

  return (
    <div className="flex min-h-screen bg-slate-50/60 text-slate-800">
      <Sidebar
        active={location.pathname}
        onNav={(p) => navigate(p)}
        warehouseName={warehouseOrg?.organization_name || "Apapa Warehouse"}
        warehouseCity={warehouseOrg?.city || "Lagos"}
        userName={session?.user?.name || session?.user?.email?.split("@")[0] || "John Adeyemi"}
        userRole={isWarehouse ? "Warehouse Manager" : (session?.role || "Operator")}
        onSignOut={() => { signOut(); navigate("/login"); }}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar
          tenantName="Flour Mills Nigeria"
          warehouseName={warehouseOrg?.organization_name || "Apapa Warehouse"}
          warehouseCity={(warehouseOrg?.city || "Lagos") + ", Nigeria"}
          onCreateNew={() => navigate("/wms/receiving?new=1")}
        />
        <main className="px-8 py-6 flex-1">
          <Outlet context={{ warehouseOrg, warehouseId, isWarehouse }} />
        </main>
      </div>
    </div>
  );
}

function Sidebar({ active, onNav, warehouseName, warehouseCity, userName, userRole, onSignOut }) {
  const isActive = (p) => active === p || (p !== "/wms" && active.startsWith(p));
  return (
    <aside className="w-[260px] shrink-0 bg-[#0B1838] text-slate-300 flex flex-col" data-testid="wms-sidebar">
      <div className="px-5 pt-5 pb-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-500/90 grid place-items-center text-white shadow-lg shadow-blue-900/40">
          <WarehouseIcon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-white font-semibold tracking-tight">TradeKonekt</div>
          <div className="text-[11px] tracking-[0.18em] text-slate-400 uppercase">WMS</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 mt-2">
        {NAV.map((s) => (
          <div key={s.section} className="mb-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 px-3 mb-2">{s.section}</div>
            <ul className="space-y-0.5">
              {s.items.map((it) => {
                const a = isActive(it.path);
                return (
                  <li key={it.label}>
                    <button
                      onClick={() => onNav(it.path)}
                      className={[
                        "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition",
                        a
                          ? "bg-white text-[#0B1838] font-semibold shadow"
                          : "text-slate-300 hover:bg-white/5 hover:text-white",
                      ].join(" ")}
                      data-testid={`nav-${it.label.toLowerCase().replace(/\s+|&/g, "-")}`}
                    >
                      <it.icon className={`h-4 w-4 ${a ? "text-[#0B1838]" : "text-slate-400"}`} />
                      <span className="flex-1 text-left">{it.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="px-3 pt-2">
        <div className="text-[11px] uppercase tracking-wider text-slate-400 px-2 mb-2">Current Warehouse</div>
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-white/10 grid place-items-center text-blue-200">
            <WarehouseIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white text-sm font-semibold truncate">{warehouseName}</div>
            <div className="text-xs text-slate-400 truncate">{warehouseCity}, Nigeria</div>
          </div>
        </div>
      </div>
      <div className="px-3 pt-3 pb-3">
        <button onClick={onSignOut} className="w-full rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3 hover:bg-white/10 transition" data-testid="wms-user-card">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center text-white text-sm font-bold ring-2 ring-emerald-500/30">
            {(userName || "?").split(" ").map((w) => w[0]).join("").slice(0,2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-white text-sm font-semibold truncate">{userName}</div>
            <div className="text-xs text-slate-400 truncate">{userRole}</div>
          </div>
        </button>
      </div>
      <button className="px-5 py-3 border-t border-white/10 flex items-center gap-2 text-slate-400 text-sm hover:text-white">
        <ChevronLeft className="h-4 w-4" /> Collapse
      </button>
    </aside>
  );
}

function TopBar({ tenantName, warehouseName, warehouseCity, onCreateNew }) {
  return (
    <header className="bg-white border-b border-slate-200/80 px-8 py-4 flex items-center gap-4">
      <button className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 min-w-[210px]">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-white text-[10px] font-black grid place-items-center">FMN</div>
        <div className="text-left min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{tenantName}</div>
          <div className="text-[11px] text-slate-500 truncate">Manufacturer</div>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400 ml-auto" />
      </button>
      <button className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 min-w-[210px]">
        <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 grid place-items-center"><WarehouseIcon className="h-4 w-4" /></div>
        <div className="text-left min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">{warehouseName}</div>
          <div className="text-[11px] text-slate-500 truncate">{warehouseCity}</div>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400 ml-auto" />
      </button>
      <div className="flex-1 max-w-2xl relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Search anything..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-16 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 border border-slate-200 px-1.5 rounded">Ctrl + K</span>
      </div>
      <div className="flex items-center gap-2">
        <IconBtn icon={Bell} count={12} />
        <IconBtn icon={Mail} count={5} />
        <IconBtn icon={HelpCircle} />
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 grid place-items-center text-white text-sm font-bold ring-2 ring-emerald-500/30">JA</div>
        <button onClick={onCreateNew} className="ml-3 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white px-4 py-2.5 text-sm font-semibold shadow-lg shadow-blue-500/20 hover:from-blue-600 hover:to-blue-800" data-testid="topbar-create-new">
          <Plus className="h-4 w-4" /> Create New <ChevronDown className="h-3.5 w-3.5 opacity-80" />
        </button>
      </div>
    </header>
  );
}

function IconBtn({ icon: Icon, count }) {
  return (
    <button className="relative h-10 w-10 rounded-xl border border-slate-200 bg-white grid place-items-center text-slate-600 hover:bg-slate-50">
      <Icon className="h-4 w-4" />
      {count != null && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold text-white grid place-items-center px-1 bg-rose-500">
          {count}
        </span>
      )}
    </button>
  );
}
