// RetailerActivityFeed.tsx — WhatsApp-style activity timeline
import React from "react";
import { ActivityItem } from "@/services/retailerAnalyticsService";
import { Truck, PackageCheck, MessageSquare, Boxes, Sparkles, Clock } from "lucide-react";

const KIND_ICON: Record<string, any> = {
  shipment: Truck,
  request: MessageSquare,
  inventory: Boxes,
  system: Sparkles,
};

function timeAgo(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

export default function RetailerActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No activity yet — your store updates will appear here.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="activity-feed">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Activity</div>
          <div className="text-sm font-semibold text-slate-900">Latest in your store</div>
        </div>
        <Clock className="h-4 w-4 text-slate-400" />
      </div>
      <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
        {items.map((it, idx) => {
          const Icon = KIND_ICON[it.kind] || Sparkles;
          const isShipmentReceived = it.kind === "shipment" && it.status === "received";
          return (
            <li
              key={`${it.ts}-${idx}`}
              className="px-4 py-3 flex gap-3 hover:bg-slate-50/70 transition-colors"
              data-testid={`activity-item-${idx}`}
            >
              <div
                className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isShipmentReceived
                    ? "bg-emerald-100 text-emerald-700"
                    : it.kind === "shipment"
                    ? "bg-amber-100 text-amber-700"
                    : it.kind === "request"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {isShipmentReceived ? <PackageCheck className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-slate-900 truncate">{it.title}</span>
                  <span className="text-[10px] text-slate-400 flex-shrink-0">{timeAgo(it.ts)}</span>
                </div>
                <div className="text-[13px] text-slate-600 leading-snug">{it.message}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
