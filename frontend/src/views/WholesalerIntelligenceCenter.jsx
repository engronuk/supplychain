import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sparkles, AlertTriangle, AlertCircle, TrendingUp, Target, Wallet,
  Rocket, ShieldAlert, Lightbulb, ListChecks, Activity, Snowflake,
} from "lucide-react";
import {
  PageHeader, KpiCard, fmtCurrency, fmtNumber, EmptyState,
} from "./wholesaler/ui";

/**
 * Wholesaler Intelligence Center (Phase 3D) — rule-based briefing surfaced
 * from the `/wholesaler/{wid}/analytics` deep blocks. No AI calls.
 */
export default function WholesalerIntelligenceCenter() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wid) return;
    setLoading(true);
    WholesalerApi.analytics(wid)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [wid]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading intelligence…</div>;
  }
  if (!data?.intelligence) {
    return (
      <div className="p-6 md:p-8 space-y-6">
        <PageHeader title="Intelligence Center"
                    subtitle="Executive briefings, opportunities, risks and recommended actions" />
        <EmptyState title="No data available" body="Intelligence becomes available once orders and inventory exist." />
      </div>
    );
  }

  const intel = data.intelligence;
  const snap = intel.snapshot || {};

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-intel-center">
      <PageHeader
        title="Intelligence Center"
        subtitle="Rule-based executive briefings, opportunities, risks and recommended actions. Refreshed live from your data."
      />

      {/* Snapshot KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 gap-3">
        <KpiCard testid="ic-snap-revenue"   icon={Wallet}        label="Revenue (90d)"
                 value={fmtCurrency(snap.total_revenue_90d)} tone="positive" />
        <KpiCard testid="ic-snap-projected" icon={TrendingUp}    label="Projected Rev (30d)"
                 value={fmtCurrency(snap.projected_revenue_30d)} />
        <KpiCard testid="ic-snap-urgent"    icon={AlertTriangle} label="Urgent Replenishments"
                 value={fmtNumber(snap.urgent_replenishments || 0)}
                 tone={snap.urgent_replenishments > 0 ? "alert" : "positive"} />
        <KpiCard testid="ic-snap-churn"     icon={ShieldAlert}   label="High Churn Risks"
                 value={fmtNumber(snap.high_churn || 0)}
                 tone={snap.high_churn > 0 ? "alert" : "positive"} />
      </div>

      {/* Executive Briefing */}
      <Card data-testid="ic-briefing">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" /> Executive Briefing
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(intel.headlines || []).length === 0 ? (
            <EmptyState title="No briefing items yet" />
          ) : (
            <ul className="space-y-2.5" data-testid="ic-headlines">
              {intel.headlines.map((h, i) => (
                <li key={i} className="text-sm text-slate-800 flex gap-2 items-start"
                    data-testid={`ic-headline-${i}`}>
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Opportunities + Risks side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="ic-opportunities">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-emerald-600" /> Opportunities
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(intel.opportunities || []).length === 0 ? (
              <EmptyState title="No opportunities surfaced" />
            ) : intel.opportunities.map((o) => (
              <OpportunityRow key={o.id} item={o} />
            ))}
          </CardContent>
        </Card>

        <Card data-testid="ic-risks">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600" /> Risks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(intel.risks || []).length === 0 ? (
              <EmptyState title="No active risks detected" />
            ) : intel.risks.map((r) => (
              <RiskRow key={r.id} item={r} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Recommended Actions */}
      <Card data-testid="ic-actions">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-indigo-600" /> Recommended Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(intel.actions || []).length === 0 ? (
            <EmptyState title="Nothing recommended right now" />
          ) : intel.actions.map((a) => (
            <ActionRow key={a.id} item={a} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

const OPP_ICON = {
  rocket: Rocket,
  target: Target,
  wallet: Wallet,
  trending_up: TrendingUp,
};

function OpportunityRow({ item }) {
  const Icon = OPP_ICON[item.icon] || Sparkles;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 flex gap-3"
         data-testid={`ic-opp-${item.id}`}>
      <div className="h-9 w-9 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-emerald-900">{item.title}</div>
        {item.body && <div className="text-xs text-emerald-800/80 mt-0.5">{item.body}</div>}
      </div>
    </div>
  );
}

const SEV_META = {
  high:   { ring: "border-rose-200 bg-rose-50/50", chip: "bg-rose-100 text-rose-700",
             icon: "text-rose-700 bg-rose-100" },
  medium: { ring: "border-amber-200 bg-amber-50/50", chip: "bg-amber-100 text-amber-700",
             icon: "text-amber-700 bg-amber-100" },
  low:    { ring: "border-slate-200 bg-slate-50", chip: "bg-slate-100 text-slate-700",
             icon: "text-slate-700 bg-slate-200" },
};

function RiskRow({ item }) {
  const m = SEV_META[item.severity] || SEV_META.low;
  return (
    <div className={`rounded-lg border p-3 flex gap-3 ${m.ring}`} data-testid={`ic-risk-${item.id}`}>
      <div className={`h-9 w-9 rounded-lg grid place-items-center shrink-0 ${m.icon}`}>
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{item.title}</span>
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${m.chip}`}>
            {item.severity}
          </span>
        </div>
        {item.body && <div className="text-xs text-slate-700 mt-0.5">{item.body}</div>}
      </div>
    </div>
  );
}

const PRI_META = {
  high:   { ring: "border-rose-200 bg-rose-50/50",   chip: "bg-rose-100 text-rose-700" },
  medium: { ring: "border-indigo-200 bg-indigo-50/40", chip: "bg-indigo-100 text-indigo-700" },
  low:    { ring: "border-slate-200 bg-slate-50",     chip: "bg-slate-100 text-slate-700" },
};

function ActionRow({ item }) {
  const m = PRI_META[item.priority] || PRI_META.medium;
  return (
    <div className={`rounded-lg border p-3 ${m.ring}`} data-testid={`ic-action-${item.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900">{item.title}</span>
        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${m.chip}`}>
          {item.priority}
        </span>
      </div>
      {item.body && <div className="text-xs text-slate-700 mt-1">{item.body}</div>}
    </div>
  );
}
