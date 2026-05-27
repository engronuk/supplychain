import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { AuthApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2, Eye, EyeOff, ShieldCheck, AlertCircle, Network, Building2, Warehouse, Store } from "lucide-react";

const ROLE_ICON = {
  super_admin: ShieldCheck,
  manufacturer: Building2,
  distributor: Warehouse,
  retailer: Store,
};

const ROLE_LABEL = {
  super_admin: "Super Admin",
  manufacturer: "Manufacturer",
  distributor: "Distributor",
  retailer: "Retailer",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, user, bootstrapping } = useSession();
  const [search] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [demoAccounts, setDemoAccounts] = useState([]);
  const expired = search.get("expired") === "1";

  useEffect(() => {
    if (!bootstrapping && user) navigate("/dashboard", { replace: true });
  }, [user, bootstrapping, navigate]);

  useEffect(() => {
    AuthApi.demoAccounts().then(setDemoAccounts).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      await signIn({ email: email.trim().toLowerCase(), password });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.detail || "Sign-in failed. Please try again.";
      setError(typeof msg === "string" ? msg : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (acc) => {
    setEmail(acc.email);
    setPassword("TradeKonekt2026!");
    setError("");
  };

  return (
    <div className="min-h-screen bg-[#FAFAF7] text-ink flex" data-testid="login-page">
      {/* Left rail — brand canvas */}
      <aside className="hidden lg:flex lg:w-[44%] xl:w-[40%] bg-ink text-paper relative overflow-hidden flex-col p-12">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <div className="h-9 w-9 rounded-lg bg-paper text-ink flex items-center justify-center font-display text-xl font-semibold">T</div>
          <span className="font-display text-2xl tracking-tight">TradeKonekt</span>
        </Link>

        <div className="mt-auto">
          <p className="text-paper/60 uppercase tracking-[0.18em] text-xs font-medium mb-5">For commerce networks at national scale</p>
          <h2 className="font-display text-4xl xl:text-5xl leading-[1.05] tracking-tight">
            Sign in to your<br/>
            <span className="italic text-amber">distribution intelligence</span><br/>
            workspace.
          </h2>
          <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 text-sm">
            <div>
              <div className="text-amber font-display text-3xl">3,080</div>
              <div className="text-paper/70 mt-1">connected retailers</div>
            </div>
            <div>
              <div className="text-amber font-display text-3xl">91</div>
              <div className="text-paper/70 mt-1">distributor depots</div>
            </div>
            <div>
              <div className="text-amber font-display text-3xl">12</div>
              <div className="text-paper/70 mt-1">intel signal streams</div>
            </div>
            <div>
              <div className="text-amber font-display text-3xl">5 min</div>
              <div className="text-paper/70 mt-1">anomaly latency</div>
            </div>
          </div>
        </div>

        {/* Decorative grid */}
        <svg className="absolute inset-0 -z-0 opacity-[0.05]" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="gridLogin" width="42" height="42" patternUnits="userSpaceOnUse">
              <path d="M 42 0 L 0 0 0 42" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#gridLogin)" />
        </svg>
      </aside>

      {/* Right — Sign in form */}
      <main className="flex-1 flex items-center justify-center px-6 py-10 lg:py-16">
        <div className="w-full max-w-md">
          <Link to="/" className="lg:hidden inline-flex items-center gap-2 mb-8">
            <div className="h-8 w-8 rounded-md bg-ink text-paper flex items-center justify-center font-display text-lg font-semibold">T</div>
            <span className="font-display text-xl tracking-tight">TradeKonekt</span>
          </Link>

          <div className="mb-8">
            <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium">Authentication</div>
            <h1 className="font-display text-4xl tracking-tight mt-1">Welcome back.</h1>
            <p className="text-graphite text-base mt-3">
              Use your work email and password to enter the orchestration workspace.
            </p>
          </div>

          {expired && (
            <div className="mb-5 flex items-start gap-2 rounded-md border border-amber/30 bg-amber/10 px-3 py-2.5 text-sm text-ink" data-testid="session-expired-msg">
              <AlertCircle className="h-4 w-4 mt-0.5 text-amber" />
              <div>Your session expired. Please sign in again.</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
            <div>
              <Label htmlFor="email" className="text-ink text-sm font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                className="mt-2 h-11 bg-white border-stone-300 focus-visible:border-ink focus-visible:ring-ink/10"
                data-testid="login-email-input"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-ink text-sm font-medium">Password</Label>
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="text-xs text-graphite hover:text-ink inline-flex items-center gap-1"
                  data-testid="toggle-password-visibility"
                >
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {showPwd ? "Hide" : "Show"}
                </button>
              </div>
              <Input
                id="password"
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="mt-2 h-11 bg-white border-stone-300 focus-visible:border-ink focus-visible:ring-ink/10"
                data-testid="login-password-input"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" data-testid="login-error">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>{error}</div>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-11 bg-ink hover:bg-ink/90 text-paper text-base font-medium"
              data-testid="login-submit-btn"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="ml-2 h-4 w-4" /></>}
            </Button>
          </form>

          {/* Demo accounts */}
          {demoAccounts.length > 0 && (
            <div className="mt-10 border-t border-stone-200 pt-6" data-testid="demo-accounts-section">
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium">Demo workspace · POC</div>
                <div className="text-xs text-graphite">Tap to autofill</div>
              </div>
              <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                {demoAccounts.map((acc) => {
                  const Icon = ROLE_ICON[acc.role] || Network;
                  return (
                    <button
                      key={acc.email}
                      type="button"
                      onClick={() => fillDemo(acc)}
                      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-md border border-stone-200 bg-white hover:bg-stone-50 hover:border-stone-300 transition-colors group"
                      data-testid={`demo-account-${acc.email}`}
                    >
                      <div className="h-8 w-8 rounded-md bg-stone-100 text-graphite group-hover:text-ink group-hover:bg-stone-200 flex items-center justify-center transition-colors">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink font-medium truncate">{acc.email}</div>
                        <div className="text-xs text-graphite truncate">
                          {ROLE_LABEL[acc.role]}{acc.entity_name ? ` · ${acc.entity_name}` : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-graphite">
                All demo accounts share password <span className="font-mono bg-stone-100 px-1.5 py-0.5 rounded text-ink">TradeKonekt2026!</span>
              </p>
            </div>
          )}

          <div className="mt-8 text-xs text-graphite">
            By signing in you agree to TradeKonekt's commercial terms.{" "}
            <Link to="/" className="underline hover:text-ink">Back to home</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
