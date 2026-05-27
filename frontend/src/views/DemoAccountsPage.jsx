import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthApi } from "@/lib/api";
import { useSession } from "@/context/SessionContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Building2,
  Warehouse,
  Store,
  ShieldCheck,
  Loader2,
  Sparkles,
} from "lucide-react";

const ROLE_META = {
  super_admin: { Icon: ShieldCheck, label: "Super Admin", tone: "amber" },
  manufacturer: { Icon: Building2, label: "Manufacturer", tone: "indigo" },
  distributor: { Icon: Warehouse, label: "Distributor", tone: "moss" },
  retailer: { Icon: Store, label: "Retailer", tone: "amber" },
};

const DEMO_PASSWORD = "TradeKonekt2026!";

export default function DemoAccountsPage() {
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    AuthApi.demoAccounts()
      .then(setAccounts)
      .catch(() => toast.error("Failed to load demo accounts"))
      .finally(() => setLoading(false));
  }, []);

  const handleSignIn = async (email) => {
    setBusy(email);
    try {
      await signIn({ email, password: DEMO_PASSWORD });
      navigate("/dashboard", { replace: true });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Sign-in failed");
    } finally {
      setBusy("");
    }
  };

  const copyEmail = (email) => {
    navigator.clipboard?.writeText(email);
    toast.success(`Copied ${email}`);
  };

  const copyPassword = () => {
    navigator.clipboard?.writeText(DEMO_PASSWORD);
    toast.success("Password copied");
  };

  const grouped = accounts.reduce((acc, a) => {
    (acc[a.role] = acc[a.role] || []).push(a);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-paper text-ink font-sans" data-testid="demo-accounts-page">
      {/* topnav */}
      <header className="sticky top-0 z-40 bg-paper/85 backdrop-blur-md border-b border-stone-200/60">
        <div className="max-w-[1280px] mx-auto px-6 md:px-10 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-ink text-paper flex items-center justify-center font-display text-lg font-semibold">T</div>
            <span className="font-display text-xl tracking-tight">TradeKonekt</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/login" data-testid="back-to-login-link">
              <Button variant="ghost" className="h-9 text-ink hover:bg-stone-100">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to sign in
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-6 md:px-10 py-12 md:py-16">
        {/* hero */}
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-10 items-end">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-graphite font-medium flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-amber" />
              Demo workspace · POC roster
            </div>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl tracking-tight mt-3 leading-[1.05]">
              Try any role.<span className="italic text-amber"> One tap.</span>
            </h1>
            <p className="text-graphite text-base mt-4 max-w-2xl leading-relaxed">
              The 500-retailer pilot ships with one account per role so you can
              step into the manufacturer's executive view, a regional distributor
              and a Lagos retailer — all running against the same live data plane.
            </p>
          </div>

          {/* shared password card */}
          <div className="rounded-xl border border-stone-200 bg-white p-5" data-testid="shared-password-card">
            <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium">Shared demo password</div>
            <div className="flex items-center justify-between mt-2">
              <code className="font-mono text-lg text-ink">{DEMO_PASSWORD}</code>
              <button
                onClick={copyPassword}
                className="inline-flex items-center gap-1.5 text-sm text-graphite hover:text-ink h-8 px-2.5 rounded-md hover:bg-stone-100"
                data-testid="copy-password-btn"
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <div className="text-xs text-graphite mt-3 leading-relaxed">
              Every demo account uses this password. Real users created via invitation set their own.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="mt-16 flex items-center justify-center text-graphite gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading demo roster…
          </div>
        ) : (
          <div className="mt-12 space-y-10">
            {["super_admin", "manufacturer", "distributor", "retailer"].map((role) => {
              const list = grouped[role] || [];
              if (!list.length) return null;
              const meta = ROLE_META[role];
              const Icon = meta.Icon;
              return (
                <section key={role} data-testid={`demo-role-section-${role}`}>
                  <div className="flex items-center gap-2.5 mb-5">
                    <div className={`h-8 w-8 rounded-md bg-white border border-stone-200 flex items-center justify-center text-${meta.tone === "amber" ? "amber" : meta.tone === "moss" ? "moss" : "indigo"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <h2 className="font-display text-2xl tracking-tight">{meta.label}{list.length > 1 ? "s" : ""}</h2>
                    <span className="text-graphite text-sm">· {list.length}</span>
                  </div>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {list.map((acc) => (
                      <DemoCard
                        key={acc.email}
                        acc={acc}
                        busy={busy === acc.email}
                        onSignIn={() => handleSignIn(acc.email)}
                        onCopy={() => copyEmail(acc.email)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-16 pt-8 border-t border-stone-200 flex items-center justify-between flex-wrap gap-3">
          <div className="text-sm text-graphite">
            Have your own credentials?{" "}
            <Link to="/login" className="text-ink font-medium underline underline-offset-2">Sign in here →</Link>
          </div>
          <Link to="/">
            <Button variant="ghost" className="h-9 text-graphite hover:text-ink">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to home
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}

function DemoCard({ acc, busy, onSignIn, onCopy }) {
  return (
    <article
      className="rounded-xl border border-stone-200 bg-white p-5 hover:border-ink/30 hover:shadow-[0_12px_40px_-24px_rgba(10,10,10,0.18)] transition-all group"
      data-testid={`demo-card-${acc.email}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            onClick={onCopy}
            className="text-sm font-medium text-ink truncate hover:text-amber transition-colors block max-w-full text-left"
            title="Click to copy email"
            data-testid={`copy-email-${acc.email}`}
          >
            {acc.email}
          </button>
          <div className="text-xs text-graphite mt-1 truncate">
            {acc.entity_name || ROLE_META[acc.role]?.label || acc.role}
          </div>
        </div>
        <Copy
          className="h-3.5 w-3.5 text-graphite/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1 cursor-pointer hover:text-ink"
          onClick={onCopy}
        />
      </div>
      <Button
        onClick={onSignIn}
        disabled={busy}
        className="mt-4 w-full h-10 bg-ink hover:bg-ink/90 text-paper text-sm"
        data-testid={`signin-as-${acc.email}`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>Sign in as this user <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>
        )}
      </Button>
    </article>
  );
}
