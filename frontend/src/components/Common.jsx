import { Card, CardContent } from "@/components/ui/card";

export function KPICard({ label, value, sub, Icon, tone = "slate", testId }) {
  const tones = {
    slate: "bg-slate-900 text-white",
    emerald: "bg-emerald-600 text-white",
    amber: "bg-amber-500 text-white",
    rose: "bg-rose-500 text-white",
    blue: "bg-blue-600 text-white",
    plain: "bg-white border border-slate-200",
  };
  return (
    <Card className={`${tones[tone]} shadow-sm`} data-testid={testId}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className={`text-xs uppercase tracking-wider ${tone === "plain" ? "text-slate-500" : "opacity-80"}`}>
              {label}
            </div>
            <div className={`text-3xl font-semibold mt-2 ${tone === "plain" ? "text-slate-900" : ""}`}>
              {value}
            </div>
            {sub && (
              <div className={`text-xs mt-1 ${tone === "plain" ? "text-slate-500" : "opacity-80"}`}>
                {sub}
              </div>
            )}
          </div>
          {Icon && (
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              tone === "plain" ? "bg-slate-100 text-slate-700" : "bg-white/15"
            }`}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
