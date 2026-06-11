/**
 * Super Admin Console — top-level shell with two tabs:
 *   1. Impersonate — sign in as any demo account (original surface).
 *   2. Simulator   — control the background Activity Simulator.
 */
import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { AuthApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Building2,
  Warehouse,
  Store,
  ShieldCheck,
  ArrowRight,
  Loader2,
  FlaskConical,
  UserCog,
} from "lucide-react";
import SuperAdminSimulator from "@/views/SuperAdminSimulator";

const ROLE_META = {
  super_admin: { Icon: ShieldCheck, label: "Super Admin" },
  manufacturer: { Icon: Building2, label: "Manufacturer" },
  distributor: { Icon: Warehouse, label: "Distributor" },
  retailer: { Icon: Store, label: "Retailer" },
};

export default function SuperAdminConsole() {
  const { user } = useSession();

  return (
    <div className="min-h-full bg-paper" data-testid="super-admin-console">
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-10">
        <header className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" /> Super Admin · {user?.email}
            </div>
            <h1 className="font-display text-4xl md:text-5xl tracking-tight mt-2">
              The control plane.
            </h1>
            <p className="text-graphite text-base mt-3 max-w-xl">
              Step into any workspace as that user, or wire the background
              Activity Simulator to keep dashboards alive during demos.
            </p>
          </div>
        </header>

        <Tabs defaultValue="impersonate" className="mt-10">
          <TabsList className="bg-stone-100 border border-stone-200">
            <TabsTrigger value="impersonate" data-testid="tab-impersonate">
              <UserCog className="h-3.5 w-3.5 mr-1.5" /> Impersonate
            </TabsTrigger>
            <TabsTrigger value="simulator" data-testid="tab-simulator">
              <FlaskConical className="h-3.5 w-3.5 mr-1.5" /> Simulator
            </TabsTrigger>
          </TabsList>

          <TabsContent value="impersonate" className="mt-6">
            <ImpersonatePanel />
          </TabsContent>
          <TabsContent value="simulator" className="mt-6">
            <SuperAdminSimulator />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ImpersonatePanel() {
  const { impersonate } = useSession();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    AuthApi.demoAccounts()
      .then(setAccounts)
      .catch(() => toast.error("Failed to load demo accounts"))
      .finally(() => setLoading(false));
  }, []);

  const handleImpersonate = async (acc) => {
    setBusy(acc.email);
    try {
      const all = await AuthApi.demoAccounts();
      const target = all.find((a) => a.email === acc.email);
      if (!target) throw new Error("Account not found");
      const usersList = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/auth/users`,
        {
          credentials: "include",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("tk.access_token") || ""}`,
          },
        },
      ).then((r) => r.json());
      const found = (usersList || []).find((u) => u.email === acc.email);
      if (!found) {
        toast.error("Cannot resolve user id");
        return;
      }
      await impersonate(found.id);
      toast.success(`Impersonating ${acc.email}`);
      window.location.assign("/dashboard");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Impersonation failed");
    } finally {
      setBusy("");
    }
  };

  const grouped = accounts.reduce((acc, a) => {
    (acc[a.role] = acc[a.role] || []).push(a);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-graphite gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounts…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Demo users" value={accounts.length} />
        <Stat label="Roles" value={Object.keys(grouped).length} />
        <Stat label="Tenants" value={2} />
      </div>

      {["manufacturer", "distributor", "retailer"].map((role) => {
        const list = grouped[role] || [];
        if (!list.length) return null;
        const meta = ROLE_META[role];
        const Icon = meta.Icon;
        return (
          <section key={role}>
            <div className="flex items-center gap-2 mb-4">
              <Icon className="h-4 w-4 text-amber" />
              <h2 className="font-display text-xl tracking-tight">{meta.label}s</h2>
              <span className="text-graphite text-xs">· {list.length}</span>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((acc) => (
                <article
                  key={acc.email}
                  className="rounded-lg border border-stone-200 bg-white p-4 hover:border-ink/30 hover:shadow-sm transition-all"
                  data-testid={`account-card-${acc.email}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {acc.email}
                      </div>
                      <div className="text-xs text-graphite truncate mt-0.5">
                        {acc.entity_name || meta.label}
                      </div>
                    </div>
                    <Icon className="h-4 w-4 text-graphite flex-shrink-0" />
                  </div>
                  <Button
                    onClick={() => handleImpersonate(acc)}
                    disabled={busy === acc.email}
                    variant="outline"
                    className="mt-4 w-full h-9 border-stone-300 hover:bg-ink hover:text-paper hover:border-ink text-sm"
                    data-testid={`impersonate-${acc.email}`}
                  >
                    {busy === acc.email ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        Sign in as <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="font-display text-3xl text-ink leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-graphite mt-1">
        {label}
      </div>
    </div>
  );
}
