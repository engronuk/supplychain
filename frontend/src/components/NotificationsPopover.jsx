import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, CheckCheck } from "lucide-react";
import { Api } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

export default function NotificationsPopover({ role, entityId }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);

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
        <ScrollArea className="h-[360px]">
          {items.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-500 text-sm">
              You're all caught up.
            </div>
          )}
          <ul className="divide-y">
            {items.map((n) => (
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
                    className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${
                      n.read ? "bg-slate-300" : "bg-rose-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-900">{n.title}</div>
                    <div className="text-sm text-slate-600 mt-0.5">{n.message}</div>
                    <div className="text-[11px] text-slate-400 mt-1">
                      {safeAgo(n.created_at)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
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
