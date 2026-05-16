import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Api } from "@/lib/api";
import { useSession } from "@/context/SessionContext";
import { Boxes, Store, Warehouse, ArrowRight, Loader2 } from "lucide-react";

export default function LandingPage() {
  const { signIn } = useSession();
  const [role, setRole] = useState("distributor");
  const [distributors, setDistributors] = useState([]);
  const [retailers, setRetailers] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([Api.distributors(), Api.retailers()])
      .then(([d, r]) => {
        setDistributors(d);
        setRetailers(r);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelectedId("");
  }, [role]);

  const list = role === "distributor" ? distributors : retailers;
  const selected = list.find((x) => x.id === selectedId);

  const handleEnter = () => {
    if (!selected) return;
    signIn(role, selected);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-16 lg:py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left — brand */}
          <div>
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-6">
              <Boxes className="h-4 w-4" />
              <span className="tracking-wider uppercase">Supply Chain Hub</span>
            </div>
            <h1 className="text-5xl lg:text-6xl font-semibold text-slate-900 leading-[1.05] tracking-tight">
              The shared workspace<br />
              <span className="text-slate-500">for distributors & retailers.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-600 max-w-md">
              Inventory, shipments, requests, analytics and reports — in one
              place. Track every box from Pending to Received.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400" /> Pending
              </span>
              <span className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> In Transit
              </span>
              <span className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-full px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Received
              </span>
            </div>
          </div>

          {/* Right — Sign in card */}
          <Card className="border-slate-200 shadow-xl shadow-slate-200/50" data-testid="landing-signin-card">
            <CardHeader>
              <CardTitle className="text-2xl">Step into your workspace</CardTitle>
              <CardDescription>
                Pick your role and account. No password required for this demo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <label className="text-sm font-medium text-slate-700 mb-3 block">I am a…</label>
                <div className="grid grid-cols-2 gap-3">
                  <RoleTile
                    active={role === "distributor"}
                    onClick={() => setRole("distributor")}
                    Icon={Warehouse}
                    label="Distributor"
                    sub="Manage stock & fulfill requests"
                    testId="role-distributor"
                  />
                  <RoleTile
                    active={role === "retailer"}
                    onClick={() => setRole("retailer")}
                    Icon={Store}
                    label="Retailer"
                    sub="Order stock & track shipments"
                    testId="role-retailer"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Choose {role === "distributor" ? "distributor" : "retail store"}
                </label>
                <Select value={selectedId} onValueChange={setSelectedId} disabled={loading}>
                  <SelectTrigger data-testid="entity-select-trigger">
                    <SelectValue placeholder={loading ? "Loading…" : "Select an account"} />
                  </SelectTrigger>
                  <SelectContent>
                    {list.map((x) => (
                      <SelectItem key={x.id} value={x.id} data-testid={`entity-option-${x.id}`}>
                        {x.name} · <span className="text-slate-500">{x.region}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleEnter}
                disabled={!selected}
                className="w-full bg-slate-900 hover:bg-slate-800 h-11 text-base"
                data-testid="enter-workspace-btn"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Enter workspace <ArrowRight className="ml-2 h-4 w-4" /></>}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RoleTile({ active, onClick, Icon, label, sub, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`text-left p-4 rounded-xl border transition-all ${
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-900 hover:border-slate-300"
      }`}
    >
      <Icon className={`h-5 w-5 mb-2 ${active ? "text-white" : "text-slate-500"}`} />
      <div className="font-semibold">{label}</div>
      <div className={`text-xs mt-0.5 ${active ? "text-slate-300" : "text-slate-500"}`}>{sub}</div>
    </button>
  );
}
