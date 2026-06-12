// Global in-app notification feed — fed by the logistics event bus
// (shipment milestones, exceptions, route dispatches) plus order/request
// notifications. Works for every persona: manufacturer, warehouse,
// distributor, wholesaler, retailer.
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bell, Boxes, CheckCheck, MapPin, Package, PackageCheck,
  Route as RouteIcon, ShoppingCart, Truck,
} from "lucide-react";
import { Api } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

const TYPE_ICON = {
  shipment: Package,
  vehicle: Truck,
  route: RouteIcon,
  delivery: PackageCheck,
  geofence: MapPin,
  inventory: Boxes,
  order: ShoppingCart,
  request: ShoppingCart,
  system: Bell,
};

const SEV_ICON_STYLE = {
  critical: "bg-rose-100 text-rose-600",
  warning: "bg-amber-100 text-amber-600",
  info: "bg-slate-100 text-slate-500",
};

export default function NotificationsPopover({ role, entityId }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("all");

  const load = () => {
    if (!role || !entityId) return;
    Api.notifications(role, entityId).then(setItems).catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, entityId]);

  const unread = items.filter((n) => !n.read).length;
  const visible = tab === "unread" ? items.filter((n) => !n.read) : items;

  const markAll = async () => {
    await Api.markAllNotificationsRead(role, entityId);
    load();
  };

  const markOne = async (id) => {
    await Api.markNotificationRead(id);
    load();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-slate-700 hover:bg-slate-100"
          data-testid="notifications-trigger"
        >
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span
              className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold flex items-center justify-center"
              data-testid="notifications-unread-count"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" data-testid="notifications-panel">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-900">Notifications</div>
            <div className="text-xs text-slate-500">{unread} unread</div>
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAll}
              className="text-xs h-8 gap-1"
              data-testid="mark-all-read-btn"
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </Button>
          )}
        </div>
        <div className="px-4 pt-2 pb-1 flex items-center gap-1.5 border-b">
          {["all", "unread"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors mb-1 ${
                tab === t
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
              data-testid={`notifications-tab-${t}`}
            >
              {t === "all" ? "All" : `Unread${unread ? ` (${unread})` : ""}`}
            </button>
          ))}
        </div>
        <ScrollArea className="h-[360px]">
          {visible.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-500 text-sm">
              {tab === "unread" ? "No unread notifications." : "You're all caught up."}
            </div>
          )}
          <ul className="divide-y">
            {visible.map((n) => {
              const Icon = TYPE_ICON[n.type] || Bell;
              const iconStyle = SEV_ICON_STYLE[n.severity] || SEV_ICON_STYLE.info;
              return (
                <li
                  key={n.id}
                  className={`px-4 py-3 cursor-pointer hover:bg-slate-50 ${
                    !n.read ? "bg-slate-50/50" : ""
                  }`}
                  onClick={() => !n.read && markOne(n.id)}
                  data-testid={`notification-${n.id}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 h-7 w-7 rounded-lg grid place-items-center flex-shrink-0 ${iconStyle}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <div className="font-medium text-sm text-slate-900 flex-1 min-w-0">
                          {n.title}
                        </div>
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-rose-500 flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-sm text-slate-600 mt-0.5 line-clamp-2">{n.message}</div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {safeAgo(n.created_at)}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function safeAgo(iso) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}
