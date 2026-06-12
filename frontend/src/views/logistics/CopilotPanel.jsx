// Konekt Copilot — multi-turn AI co-pilot grounded in live control-tower
// data (fleet, routes, events, predictions). Sessions persist server-side.
import { useEffect, useRef, useState } from "react";
import { Bot, SendHorizonal, Sparkles, User } from "lucide-react";
import { toast } from "sonner";
import { Api } from "../../lib/api";

const SUGGESTIONS = [
  "Which trucks are at risk right now?",
  "Summarize today's exceptions",
  "How are my planned routes performing?",
  "Which regions need attention this week?",
];

// Minimal markdown: **bold** only — replies are otherwise plain text.
const renderContent = (text) =>
  String(text).split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part);

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

  const send = (text) => {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput("");
    setMessages((prev) => [...(prev || []), { role: "user", content: msg }]);
    setBusy(true);
    Api.copilotChat({ message: msg })
      .then((d) => setMessages((prev) => [...(prev || []), { role: "assistant", content: d.reply }]))
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
          <div className="text-[10px] text-slate-500 mt-0.5">grounded in your live control tower</div>
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
              Ask me anything about your fleet, routes, exceptions or delivery performance.
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
              <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words ${
                m.role === "user"
                  ? "bg-emerald-600/20 border border-emerald-500/30 text-emerald-100"
                  : "bg-slate-800/70 border border-slate-700/60 text-slate-200"
              }`}>
                {renderContent(m.content)}
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
          placeholder="Ask the copilot…"
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
