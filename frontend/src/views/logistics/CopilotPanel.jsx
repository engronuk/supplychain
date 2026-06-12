// Konekt Copilot — multi-turn AI co-pilot grounded in live control-tower
// data (fleet, routes, events, predictions). Sessions persist server-side.
// The copilot can also propose system ACTIONS (re-route, resolve, dispatch,
// acknowledge) which the dispatcher confirms before execution.
import { useEffect, useRef, useState } from "react";
import {
  Bot, CheckCheck, CircleCheck, CircleX, Loader2, Route as RouteIcon,
  SendHorizonal, Sparkles, Truck, User, Wrench, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Api } from "../../lib/api";

const SUGGESTIONS = [
  "Which trucks are at risk right now?",
  "Summarize today's exceptions",
  "Re-route any truck that's off its approved route",
  "Which regions need attention this week?",
];

// Minimal markdown for Gemini replies: **bold**, `code`, and bullet lists.
const renderInline = (text, keyBase) =>
  String(text).split(/(\*\*.+?\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyBase}-${i}`} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyBase}-${i}`} className="font-mono text-[11px] bg-slate-900/80 px-1 py-0.5 rounded text-emerald-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });

const renderContent = (text) =>
  String(text).split("\n").map((line, i) => {
    const bullet = line.match(/^\s*(?:[*\-•]|\d+\.)\s+(.*)/);
    if (bullet) {
      return (
        <div key={i} className="flex gap-1.5 pl-1">
          <span className="text-violet-400 shrink-0">•</span>
          <span className="min-w-0">{renderInline(bullet[1], i)}</span>
        </div>
      );
    }
    if (line.trim() === "") return <div key={i} className="h-1.5" />;
    return <div key={i}>{renderInline(line, i)}</div>;
  });

const ACTION_META = {
  reroute_vehicle:    { icon: RouteIcon, label: "Re-route truck" },
  resolve_exception:  { icon: Wrench,    label: "Resolve exception" },
  dispatch_adhoc:     { icon: Truck,     label: "Dispatch delivery" },
  acknowledge_events: { icon: CheckCheck, label: "Acknowledge events" },
};

const ActionCard = ({ action, onUpdate }) => {
  const [working, setWorking] = useState(false);
  const meta = ACTION_META[action.type] || { icon: Zap, label: action.type };
  const Icon = meta.icon;

  const run = (call, errTitle) => {
    setWorking(true);
    call(action.id)
      .then((d) => onUpdate(d.action))
      .catch((e) => toast.error(errTitle, {
        description: e?.response?.data?.detail || e?.message,
      }))
      .finally(() => setWorking(false));
  };

  return (
    <div
      className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5"
      data-testid="copilot-action-card"
    >
      <div className="flex items-center gap-2">
        <span className="h-5 w-5 rounded-md bg-violet-500/15 border border-violet-500/30 grid place-items-center shrink-0">
          <Icon className="h-3 w-3 text-violet-300" />
        </span>
        <span className="text-[10px] font-semibold text-violet-200 uppercase tracking-wider">
          {meta.label}
        </span>
        <span
          className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
            action.status === "executed"
              ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10"
              : action.status === "failed"
                ? "text-rose-300 border-rose-500/40 bg-rose-500/10"
                : action.status === "dismissed"
                  ? "text-slate-400 border-slate-600 bg-slate-800/60"
                  : "text-amber-300 border-amber-500/40 bg-amber-500/10"
          }`}
          data-testid="copilot-action-status"
        >
          {action.status === "proposed" ? "awaiting confirmation" : action.status}
        </span>
      </div>
      <div className="text-[12px] text-slate-300 mt-1.5">{action.summary}</div>

      {action.status === "executed" && action.result?.message && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-emerald-300" data-testid="copilot-action-result">
          <CircleCheck className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>{action.result.message}</span>
        </div>
      )}
      {action.status === "failed" && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-300" data-testid="copilot-action-error">
          <CircleX className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>{action.result?.message || "Action failed — try again."}</span>
        </div>
      )}

      {(action.status === "proposed" || action.status === "failed") && (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            disabled={working}
            onClick={() => run(Api.copilotExecuteAction, "Action failed")}
            className="h-7 px-3 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-[11px] font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
            data-testid="copilot-action-execute-btn"
          >
            {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {action.status === "failed" ? "Retry" : "Execute"}
          </button>
          {action.status === "proposed" && (
            <button
              type="button"
              disabled={working}
              onClick={() => run(Api.copilotDismissAction, "Couldn't dismiss")}
              className="h-7 px-3 rounded-md border border-slate-700 hover:bg-slate-800 disabled:opacity-50 text-[11px] text-slate-300 transition-colors"
              data-testid="copilot-action-dismiss-btn"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const CopilotPanel = () => {
  const [messages, setMessages] = useState(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    Api.copilotHistory()
      .then((d) => setMessages(d.messages || []))
      .catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const updateAction = (a) =>
    setMessages((prev) => (prev || []).map((m) =>
      m.action?.id === a.id ? { ...m, action: a } : m));

  const send = (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((prev) => [...(prev || []), { role: "user", content: msg }]);
    setBusy(true);
    Api.copilotChat({ message: msg })
      .then((d) => setMessages((prev) => [...(prev || []), {
        role: "assistant", content: d.reply, action: d.action || undefined,
      }]))
      .catch((e) => {
        const detail = e?.response?.data?.detail || e?.message;
        toast.error("Copilot error", { description: detail });
        setMessages((prev) => [...(prev || []), {
          role: "assistant", content: `⚠ ${detail || "Something went wrong — try again."}`,
        }]);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col h-[620px] xl:h-[760px] min-w-0" data-testid="copilot-panel">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2">
        <span className="h-6 w-6 rounded-lg bg-violet-500/15 border border-violet-500/30 grid place-items-center">
          <Bot className="h-3.5 w-3.5 text-violet-300" />
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-100 leading-none">Konekt Copilot</div>
          <div className="text-[10px] text-slate-500 mt-0.5">grounded in your live control tower · can take actions</div>
        </div>
        <span className="ml-auto relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
        </span>
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3" data-testid="copilot-messages">
        {messages === null ? (
          <div className="text-[12px] text-slate-500 text-center pt-8">Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div className="pt-6 text-center space-y-3">
            <Sparkles className="h-5 w-5 text-violet-400 mx-auto" />
            <div className="text-[12px] text-slate-400 px-4">
              Ask me anything about your fleet, routes, exceptions or delivery
              performance — or tell me to re-route a truck, resolve an
              exception or dispatch a delivery.
            </div>
            <div className="space-y-1.5 px-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s} type="button" onClick={() => send(s)}
                  className="block w-full text-left text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-violet-500/40 transition-colors"
                  data-testid="copilot-suggestion"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`} data-testid="copilot-message">
              {m.role !== "user" && (
                <span className="h-5 w-5 rounded-md bg-violet-500/15 border border-violet-500/30 grid place-items-center shrink-0 mt-0.5">
                  <Bot className="h-3 w-3 text-violet-300" />
                </span>
              )}
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed break-words ${
                m.role === "user"
                  ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-100"
                  : "bg-slate-800/70 border border-slate-700/60 text-slate-200"
              }`}>
                {renderContent(m.content)}
                {m.action && <ActionCard action={m.action} onUpdate={updateAction} />}
              </div>
              {m.role === "user" && (
                <span className="h-5 w-5 rounded-md bg-emerald-500/15 border border-emerald-500/30 grid place-items-center shrink-0 mt-0.5">
                  <User className="h-3 w-3 text-emerald-300" />
                </span>
              )}
            </div>
          ))
        )}
        {busy && (
          <div className="flex gap-2" data-testid="copilot-thinking">
            <span className="h-5 w-5 rounded-md bg-violet-500/15 border border-violet-500/30 grid place-items-center shrink-0 mt-0.5">
              <Bot className="h-3 w-3 text-violet-300" />
            </span>
            <div className="rounded-xl px-3 py-2 bg-slate-800/70 border border-slate-700/60">
              <span className="inline-flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce" />
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        className="p-2.5 border-t border-slate-800 flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the copilot — or tell it what to do…"
          className="flex-1 h-9 rounded-lg bg-slate-900 border border-slate-700 px-3 text-[12px] text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50"
          data-testid="copilot-input"
        />
        <button
          type="submit" disabled={busy || !input.trim()}
          className="h-9 w-9 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 grid place-items-center transition-colors"
          data-testid="copilot-send-btn"
        >
          <SendHorizonal className="h-4 w-4 text-white" />
        </button>
      </form>
    </div>
  );
};
