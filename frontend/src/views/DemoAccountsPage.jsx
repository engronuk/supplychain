import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { AuthApi } from "@/lib/api";
import { useSession } from "@/context/SessionContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Search,
  Building2,
  Warehouse as WarehouseIcon,
  Store,
  ShieldCheck,
  Truck,
  PackageOpen,
  Loader2,
  Lock,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

const DEMO_PASSWORD = "TradeKonekt2026!";

const ROLE_META = {
  super_admin:  { Icon: ShieldCheck,    label: "Super Admin",  tint: "amber",
                  desc: "Full platform access and management" },
  manufacturer: { Icon: Building2,      label: "Manufacturer", tint: "indigo",
                  desc: "Manage production, inventory and orders" },
  warehouse:    { Icon: WarehouseIcon,  label: "Warehouse",    tint: "ochre",
                  desc: "Manage stock, receipts and dispatch" },
  distributor:  { Icon: Truck,          label: "Distributor",  tint: "violet",
                  desc: "Manage distribution, sales and deliveries" },
  wholesaler:   { Icon: PackageOpen,    label: "Wholesaler",   tint: "rose",
                  desc: "Manage wholesale business operations" },
  retailer:     { Icon: Store,          label: "Retailer",     tint: "emerald",
                  desc: "Manage retail sales and inventory" },
};

const ROLE_ORDER = ["super_admin", "manufacturer", "warehouse", "distributor", "wholesaler", "retailer"];

const TINT_CLASSES = {
  amber:   { tile: "bg-amber-50",   text: "text-amber-700",   badge: "bg-amber-100 text-amber-700"   },
  indigo:  { tile: "bg-indigo-50",  text: "text-indigo-700",  badge: "bg-indigo-100 text-indigo-700" },
  ochre:   { tile: "bg-orange-50",  text: "text-orange-700",  badge: "bg-orange-100 text-orange-700" },
  violet:  { tile: "bg-violet-50",  text: "text-violet-700",  badge: "bg-violet-100 text-violet-700" },
  rose:    { tile: "bg-rose-50",    text: "text-rose-700",    badge: "bg-rose-100 text-rose-700"     },
  emerald: { tile: "bg-emerald-50", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700"},
  moss:    { tile: "bg-emerald-50", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-700"},
};

const TENANT_LOGO_GRADIENTS = {
  // Brand-inspired gradient cards — used as the company logo placeholder.
  "Flour Mills Nigeria": "from-emerald-500 via-emerald-600 to-emerald-800",
  "Unilever":            "from-indigo-500 via-indigo-600 to-blue-700",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DemoAccountsPage() {
  const navigate = useNavigate();
  const { signIn } = useSession();

  const [tenants, setTenants] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState(1);              // 1 = tenant, 2 = role, 3 = user
  const [tenant, setTenant] = useState(null);
  const [role, setRole] = useState(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    Promise.all([AuthApi.demoTenants(), AuthApi.demoAccounts()])
      .then(([t, a]) => { setTenants(t || []); setAccounts(a || []); })
      .catch(() => toast.error("Failed to load demo portal data"))
      .finally(() => setLoading(false));
  }, []);

  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter((t) =>
      [t.name, t.short_name, t.type_label].join(" ").toLowerCase().includes(q),
    );
  }, [tenants, search]);

  const usersForCurrentStep = useMemo(() => {
    if (!tenant || !role) return [];
    if (role === "super_admin") {
      return accounts.filter((a) => a.role === "super_admin");
    }
    return accounts.filter(
      (a) => a.role === role && a.manufacturer_id === tenant.id,
    );
  }, [accounts, tenant, role]);

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

  const back = () => {
    if (step === 3) { setRole(null); setStep(2); }
    else if (step === 2) { setTenant(null); setStep(1); }
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50"
      data-testid="demo-accounts-page"
    >
      {/* Header */}
      <header className="border-b border-slate-200/80 bg-white/70 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-900 text-white grid place-items-center font-bold">
              T
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900 tracking-tight">
                TradeKonekt
              </div>
              <div className="text-xs text-slate-500">Demo Portal</div>
            </div>
          </div>
          {step !== 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={back}
              data-testid="demo-back-btn"
              className="gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              {step === 2 ? "Back to Companies" : "Back to Roles"}
            </Button>
          )}
          {step === 1 && (
            <a
              href="/login"
              className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5"
            >
              <ShieldCheck className="h-4 w-4" />
              Sign in directly
            </a>
          )}
        </div>
      </header>

      {/* Loading state */}
      {loading ? (
        <div className="py-32 flex items-center justify-center text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading demo portal…
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-6 pt-10 pb-24">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <Step1Tenants
                key="s1"
                tenants={filteredTenants}
                search={search}
                onSearch={setSearch}
                onPick={(t) => { setTenant(t); setStep(2); }}
              />
            )}
            {step === 2 && tenant && (
              <Step2Roles
                key="s2"
                tenant={tenant}
                accounts={accounts}
                onPick={(r) => { setRole(r); setStep(3); }}
              />
            )}
            {step === 3 && tenant && role && (
              <Step3Users
                key="s3"
                tenant={tenant}
                role={role}
                users={usersForCurrentStep}
                busy={busy}
                onSignIn={handleSignIn}
              />
            )}
          </AnimatePresence>
        </main>
      )}

      {/* Step indicator */}
      <ProgressIndicator step={step} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress indicator (bottom bar)
// ---------------------------------------------------------------------------
function ProgressIndicator({ step }) {
  const steps = [
    { n: 1, label: "Select Company", sub: "Choose a company to explore the demo." },
    { n: 2, label: "Select Role",    sub: "Choose a role within the selected company." },
    { n: 3, label: "Select User",    sub: "Choose a user account to launch the demo." },
  ];
  return (
    <footer className="fixed bottom-0 inset-x-0 z-10 border-t border-slate-200/80 bg-white/80 backdrop-blur">
      <div className="max-w-7xl mx-auto px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {steps.map((s, idx) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div
              key={s.n}
              className="flex items-start gap-3"
              data-testid={`progress-step-${s.n}`}
            >
              <div
                className={[
                  "h-8 w-8 rounded-full grid place-items-center text-xs font-semibold shrink-0 transition-all",
                  active ? "bg-blue-600 text-white shadow-md shadow-blue-600/30 scale-110" : "",
                  done   ? "bg-emerald-500 text-white" : "",
                  !active && !done ? "bg-slate-200 text-slate-500" : "",
                ].join(" ")}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : s.n}
              </div>
              <div className="min-w-0">
                <div
                  className={[
                    "text-xs font-semibold uppercase tracking-wider",
                    active ? "text-blue-600" : done ? "text-emerald-600" : "text-slate-400",
                  ].join(" ")}
                >
                  {s.label}
                </div>
                <div className="text-sm text-slate-500 truncate">{s.sub}</div>
              </div>
              {idx < steps.length - 1 && (
                <ArrowRight className="hidden md:block h-4 w-4 text-slate-300 ml-auto self-center" />
              )}
            </div>
          );
        })}
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Select Company
// ---------------------------------------------------------------------------
function Step1Tenants({ tenants, search, onSearch, onPick }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      data-testid="step-1"
    >
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          TradeKonekt Demo Portal
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          Welcome to TradeKonekt Demo
        </h1>
        <p className="mt-3 text-lg text-slate-600 leading-relaxed">
          Experience the power of our supply chain network. Select a company to
          explore a role-based demo.
        </p>
      </div>

      {/* Search */}
      <div className="mt-8 max-w-xl">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search companies…"
            className="w-full rounded-2xl border border-slate-200 bg-white px-11 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            data-testid="tenant-search"
          />
        </div>
      </div>

      {/* Tenant cards */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {tenants.map((t) => (
          <TenantCard key={t.id} tenant={t} onPick={() => onPick(t)} />
        ))}
        {tenants.length === 0 && (
          <div className="col-span-full text-center text-slate-500 py-16 border border-dashed border-slate-300 rounded-2xl">
            No companies match your search.
          </div>
        )}
      </div>

      {/* Security footer */}
      <div className="mt-10 max-w-3xl rounded-2xl border border-slate-200 bg-white/60 backdrop-blur p-5 flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-blue-50 grid place-items-center text-blue-600">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-slate-900">
            Secure. Isolated. Enterprise-grade.
          </div>
          <div className="text-sm text-slate-600 mt-1">
            Your data is protected. Tenants are never shared.
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function TenantCard({ tenant, onPick }) {
  const gradient = TENANT_LOGO_GRADIENTS[tenant.name] || "from-slate-700 via-slate-800 to-slate-900";
  const isFlour = tenant.name === "Flour Mills Nigeria";
  return (
    <motion.article
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm hover:shadow-xl hover:border-slate-300 transition-all"
      data-testid={`tenant-card-${tenant.code}`}
    >
      <div className="p-6 flex items-start gap-5">
        {/* Logo placeholder */}
        <div className={`shrink-0 h-28 w-28 rounded-2xl bg-gradient-to-br ${gradient} grid place-items-center text-white shadow-lg shadow-slate-900/10 relative overflow-hidden`}>
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_30%_20%,white,transparent_50%)]" />
          <div className="text-2xl font-black tracking-tight relative">
            {tenant.initials}
          </div>
        </div>
        {/* Body */}
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-slate-900 tracking-tight truncate">
            {tenant.name}
          </h3>
          <div className={`text-sm font-medium mt-0.5 ${isFlour ? "text-emerald-700" : "text-indigo-700"}`}>
            {tenant.type_label}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <Stat icon={WarehouseIcon} value={tenant.tier_counts.warehouse}    label="Warehouse" />
            <Stat icon={Truck}         value={tenant.tier_counts.distributor}  label="Distributors" />
            <Stat icon={PackageOpen}   value={tenant.tier_counts.wholesaler}   label="Wholesalers" />
            <Stat icon={Store}         value={tenant.tier_counts.retailer}     label="Retailers" />
          </div>
        </div>
      </div>

      <div className="px-6 pb-4">
        <p className="text-sm text-slate-600 leading-relaxed">{tenant.tagline}</p>
      </div>

      <div className="px-6 pb-6">
        <Button
          onClick={onPick}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl h-11 group/btn"
          data-testid={`enter-${tenant.code}`}
        >
          <span>Enter {tenant.short_name} Demo</span>
          <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
        </Button>
      </div>
    </motion.article>
  );
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="rounded-lg">
      <div className="inline-flex items-center gap-1 text-slate-500 text-[11px]">
        <Icon className="h-3 w-3" />
      </div>
      <div className="text-lg font-bold text-slate-900 leading-none mt-0.5">
        {value?.toLocaleString?.() ?? value ?? 0}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Select Role
// ---------------------------------------------------------------------------
function Step2Roles({ tenant, accounts, onPick }) {
  const gradient = TENANT_LOGO_GRADIENTS[tenant.name] || "from-slate-700 via-slate-800 to-slate-900";
  // Build role -> count map combining tier counts (real org counts) for the
  // big number and user counts (demo users) for visibility.
  const counts = {
    super_admin:  tenant.users_by_role.super_admin || 0,
    manufacturer: 1,                                // always 1 manufacturer per tenant
    warehouse:    tenant.tier_counts.warehouse || 0,
    distributor:  tenant.tier_counts.distributor || 0,
    wholesaler:   tenant.tier_counts.wholesaler || 0,
    retailer:     tenant.tier_counts.retailer || 0,
  };
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      data-testid="step-2"
    >
      {/* Company banner */}
      <div className={`rounded-3xl bg-gradient-to-r ${gradient} text-white p-8 flex items-center gap-6 shadow-xl shadow-slate-900/10`}>
        <div className="h-20 w-20 rounded-2xl bg-white/15 backdrop-blur grid place-items-center text-white text-2xl font-black tracking-tight">
          {tenant.initials}
        </div>
        <div>
          <div className="text-xs uppercase tracking-widest text-white/70">Selected company</div>
          <h2 className="text-3xl font-bold mt-1">{tenant.name}</h2>
          <div className="text-sm text-white/80 mt-1">{tenant.type_label}</div>
          <p className="text-sm text-white/70 mt-2 max-w-2xl">
            Explore the demo experience based on your role in the supply chain.
          </p>
        </div>
      </div>

      <h3 className="mt-10 text-2xl font-bold text-slate-900 tracking-tight">Choose a role</h3>
      <p className="text-sm text-slate-500 mt-1">Select the role you want to sign in as.</p>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {ROLE_ORDER.map((r) => {
          const meta = ROLE_META[r];
          const tint = TINT_CLASSES[meta.tint];
          const total = counts[r];
          // Disable roles with zero tier counts to mirror real data.
          const disabled = total === 0;
          return (
            <motion.button
              key={r}
              whileHover={!disabled ? { y: -2 } : {}}
              whileTap={!disabled ? { scale: 0.985 } : {}}
              disabled={disabled}
              onClick={() => onPick(r)}
              className={[
                "text-left bg-white border border-slate-200 rounded-2xl p-5 shadow-sm transition-all",
                disabled
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:shadow-lg hover:border-slate-300 cursor-pointer",
              ].join(" ")}
              data-testid={`role-card-${r}`}
            >
              <div className="flex items-start justify-between">
                <div className={`h-14 w-14 rounded-2xl ${tint.tile} grid place-items-center ${tint.text}`}>
                  <meta.Icon className="h-7 w-7" />
                </div>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${tint.badge}`}>
                  {total?.toLocaleString?.() ?? total}
                </span>
              </div>
              <div className="mt-4">
                <div className="text-lg font-semibold text-slate-900">{meta.label}</div>
                <div className="text-sm text-slate-500 mt-1 leading-snug">{meta.desc}</div>
              </div>
            </motion.button>
          );
        })}
      </div>

      <div className="mt-10 max-w-3xl rounded-2xl border border-blue-200 bg-blue-50/60 p-5 flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-blue-100 grid place-items-center text-blue-700">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-blue-900">Tenant Isolation</div>
          <div className="text-sm text-blue-800/90 mt-1">
            You are now in the <strong>{tenant.name}</strong> demo environment.
            You will only see data related to this company.
          </div>
        </div>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Select User
// ---------------------------------------------------------------------------
function Step3Users({ tenant, role, users, busy, onSignIn }) {
  const meta = ROLE_META[role];
  const tint = TINT_CLASSES[meta.tint];
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      data-testid="step-3"
    >
      {/* Context banner */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 flex items-center gap-5 shadow-sm">
        <div className={`h-16 w-16 rounded-2xl ${tint.tile} grid place-items-center ${tint.text}`}>
          <meta.Icon className="h-8 w-8" />
        </div>
        <div className="flex-1">
          <div className="text-xs uppercase tracking-widest text-slate-400">
            {tenant.name}
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{meta.label}</h2>
          <div className="text-sm text-slate-500 mt-1">
            Select a user account to sign in and experience the demo.
          </div>
        </div>
      </div>

      <h3 className="mt-10 text-xl font-bold text-slate-900 tracking-tight">
        Available users
      </h3>
      <p className="text-sm text-slate-500 mt-1">
        Choose {meta.label === "Super Admin" ? "an" : "a"}{" "}
        {meta.label.toLowerCase()} to continue.
      </p>

      {/* User cards */}
      <div className="mt-6 grid grid-cols-1 gap-3">
        {users.map((u) => (
          <UserCard
            key={u.email}
            user={u}
            busy={busy === u.email}
            onSignIn={() => onSignIn(u.email)}
            tint={tint}
          />
        ))}
        {users.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
            No demo user is provisioned for this role on this tenant yet.
          </div>
        )}
      </div>

      <div className="mt-8 max-w-3xl rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-emerald-100 grid place-items-center text-emerald-700">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-emerald-900">Secure &amp; Isolated</div>
          <div className="text-sm text-emerald-800/90 mt-1">
            You are signing in as {meta.label === "Super Admin" ? "a Super Admin" : `a ${meta.label.toLowerCase()}`} within the{" "}
            <strong>{tenant.name}</strong> environment. Your data is protected.
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function UserCard({ user, busy, onSignIn, tint }) {
  // Derive a 2-letter monogram from the entity name (or email).
  const monogram = (user.entity_name || user.name || user.email)
    .replace(/[^a-zA-Z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "T";
  // Extract location from "Name · Location" suffix in entity_name.
  const [displayName, location] = (user.entity_name || "").split(" · ");
  return (
    <motion.article
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className="bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all"
      data-testid={`user-card-${user.email}`}
    >
      <div className={`h-14 w-14 rounded-2xl ${tint.tile} ${tint.text} grid place-items-center text-base font-bold shrink-0`}>
        {monogram}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold text-slate-900 truncate">
          {displayName || user.name || user.email}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{user.email}</div>
        {location && (
          <div className="mt-1.5">
            <span className={`text-[11px] inline-flex items-center px-2 py-0.5 rounded-md ${tint.badge}`}>
              {location}
            </span>
          </div>
        )}
      </div>
      <Button
        onClick={onSignIn}
        disabled={busy}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-10 px-5 shrink-0"
        data-testid={`signin-${user.email}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Sign In
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </>
        )}
      </Button>
    </motion.article>
  );
}
