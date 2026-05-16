// RetailerAIInsights.tsx — intelligent insight cards for the retailer dashboard
import React from "react";
import { AIInsight } from "@/services/retailerAnalyticsService";
import {
  AlertTriangle,
  Sparkles,
  TrendingUp,
  Boxes,
  ChevronRight,
} from "lucide-react";

const TONE: Record<string, { wrap: string; ring: string; chip: string; chipText: string; Icon: any }> = {
  critical: {
    wrap: "bg-rose-50/70 border-rose-200/80",
    ring: "bg-rose-500",
    chip: "bg-rose-100 text-rose-700",
    chipText: "Critical",
    Icon: AlertTriangle,
  },
  warning: {
    wrap: "bg-amber-50/70 border-amber-200/80",
    ring: "bg-amber-500",
    chip: "bg-amber-100 text-amber-700",
    chipText: "Warning",
    Icon: AlertTriangle,
  },
  info: {
    wrap: "bg-indigo-50/60 border-indigo-200/70",
    ring: "bg-indigo-500",
    chip: "bg-indigo-100 text-indigo-700",
    chipText: "Insight",
    Icon: Sparkles,
  },
};

const TYPE_ICON: Record<string, any> = {
  stockout_risk: AlertTriangle,
  low_stock: Boxes,
  fast_seller: TrendingUp,
  overstock: Boxes,
};

interface Props {
  insights: AIInsight[];
  onAction?: (i: AIInsight) => void;
}

export default function RetailerAIInsights({ insights, onAction }: Props) {
  if (!insights.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500" data-testid="ai-insights-empty">
        Looking good — no urgent insights right now.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="ai-insights-grid">
      {insights.map((i) => {
        const t = TONE[i.tone] || TONE.info;
        const Icon = TYPE_ICON[i.type] || t.Icon;
        return (
          <button
            key={i.id}
            onClick={() => onAction && onAction(i)}
            className={`text-left relative rounded-2xl border ${t.wrap} p-4 hover:shadow-md hover:-translate-y-0.5 transition-all`}
            data-testid={`insight-${i.id}`}
          >
            <span className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${t.ring}`} />
            <div className="flex items-start gap-3 pl-2">
              <div className="h-9 w-9 rounded-xl bg-white/90 border border-slate-200 flex items-center justify-center flex-shrink-0">
                <Icon className="h-4 w-4 text-slate-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${t.chip}`}>
                    {t.chipText}
                  </span>
                  <span className="text-[11px] text-slate-500">{i.title}</span>
                </div>
                <div className="text-sm text-slate-800 leading-snug">{i.message}</div>
                <div className="mt-2 inline-flex items-center text-[12px] font-semibold text-slate-900">
                  {i.action} <ChevronRight className="h-3 w-3 ml-0.5" />
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
