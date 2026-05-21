// RetailerAssistantBubble.tsx — floating AI chat bubble for retailers.
// Chat (Gemini 2.5 Flash by default; auto-escalates to Claude Sonnet 4.5 for
// complex queries) + voice (OpenAI Whisper STT for transcription,
// speechSynthesis for TTS). Strictly retailer-scoped on the backend.
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useSession } from "@/context/SessionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  X,
  Mic,
  Square,
  Send,
  Volume2,
  VolumeX,
  Loader2,
  MessageCircle,
  Bot,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  ts: number;
  action?: any;
}

interface Props {
  /** Optional callback when the assistant emits a UI action (open_smart_reorder, etc.) */
  onUiAction?: (action: { action: string; [k: string]: any }) => void;
  /** Optional refresh callback after a server-side action (e.g. reorder created). */
  onRefresh?: () => void;
}

const SUGGESTIONS = [
  "What is running out soon?",
  "How are sales today?",
  "Restock my best sellers",
  "Show me my pending shipments",
];

export default function RetailerAssistantBubble({ onUiAction, onRefresh }: Props) {
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ttsOn, setTtsOn] = useState<boolean>(() => localStorage.getItem("retailer:tts") === "1");
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const retailerId = session.entity.id;
  const retailerName = session.entity.name;
  const sessionKey = `retailer:assistant:${retailerId}`;

  // Restore prior chat for this retailer
  useEffect(() => {
    try {
      const raw = localStorage.getItem(sessionKey);
      if (raw) setTurns(JSON.parse(raw));
    } catch {
      /* */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retailerId]);

  useEffect(() => {
    try {
      localStorage.setItem(sessionKey, JSON.stringify(turns.slice(-30)));
    } catch {
      /* */
    }
  }, [turns, sessionKey]);

  useEffect(() => {
    localStorage.setItem("retailer:tts", ttsOn ? "1" : "0");
  }, [ttsOn]);

  useEffect(() => {
    // auto-scroll to bottom on new message
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  const speakSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const recordSupported = useMemo(() => {
    return typeof window !== "undefined"
      && !!navigator.mediaDevices?.getUserMedia
      && typeof window.MediaRecorder !== "undefined";
  }, []);

  function speak(text: string) {
    if (!ttsOn || !speakSupported || !text) return;
    try {
      const utter = new SpeechSynthesisUtterance(stripMarkdown(text).slice(0, 600));
      utter.rate = 1.05;
      utter.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch {
      /* */
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const userTurn: ChatTurn = { role: "user", content: trimmed, ts: Date.now() };
    setTurns((arr) => [...arr, userTurn]);
    setInput("");
    setThinking(true);
    try {
      const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }));
      const { data } = await axios.post(`${API}/retailer/${retailerId}/assistant`, {
        message: trimmed,
        history,
      });
      const assistantTurn: ChatTurn = {
        role: "assistant",
        content: data.reply || "(no response)",
        ts: Date.now(),
        action: data.action || undefined,
      };
      setTurns((arr) => [...arr, assistantTurn]);
      speak(assistantTurn.content);

      // Auto-handle UI-only actions
      if (data.action) {
        const a = data.action;
        if (a.action === "reorder") {
          // server-side execute
          try {
            const res = await axios.post(`${API}/retailer/${retailerId}/assistant/execute`, {
              action: a,
            });
            if (res.data?.ok) {
              toast.success(
                `Reorder placed (${res.data.items_count} item${res.data.items_count === 1 ? "" : "s"})`
              );
              onRefresh && onRefresh();
            } else {
              toast.error("Couldn't place that reorder — try Smart Reorder.");
            }
          } catch {
            toast.error("Couldn't place that reorder.");
          }
        } else if (
          a.action === "open_smart_reorder" ||
          a.action === "open_voice_order" ||
          a.action === "show_low_stock"
        ) {
          onUiAction && onUiAction(a);
        }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Assistant unavailable right now.";
      setTurns((arr) => [
        ...arr,
        { role: "assistant", content: msg, ts: Date.now() },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function pickMimeType(): string | undefined {
    // Browsers vary widely. Pick the first supported one Whisper can handle.
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const t of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return undefined;
  }

  async function startRecording() {
    if (!recordSupported) {
      toast.error("Voice input isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      const mimeType = pickMimeType();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blobType = mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: blobType });
        audioStreamRef.current?.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
        if (blob.size < 500) {
          toast.warning("Didn't catch that — try again.");
          return;
        }
        await transcribeAndSend(blob);
      };
      rec.start();
      mediaRecRef.current = rec;
      setRecording(true);
    } catch (e: any) {
      const msg = e?.name === "NotAllowedError"
        ? "Microphone permission denied"
        : "Couldn't access microphone";
      toast.error(msg);
      setRecording(false);
    }
  }

  function stopRecording() {
    try {
      mediaRecRef.current?.stop();
    } catch {
      /* */
    }
    setRecording(false);
  }

  async function transcribeAndSend(blob: Blob) {
    setTranscribing(true);
    try {
      const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
      const fd = new FormData();
      fd.append("audio", blob, `clip.${ext}`);
      const { data } = await axios.post(
        `${API}/retailer/${retailerId}/assistant/transcribe`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const text = (data?.text || "").trim();
      if (!text) {
        toast.warning("Couldn't transcribe that — try speaking more clearly.");
        return;
      }
      // Pop into the input box for review, then auto-send.
      setInput(text);
      await send(text);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Voice transcription failed.";
      toast.error(msg);
    } finally {
      setTranscribing(false);
    }
  }

  function clearChat() {
    setTurns([]);
    try {
      localStorage.removeItem(sessionKey);
    } catch {
      /* */
    }
  }

  return (
    <>
      {/* Floating bubble */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[60] h-14 w-14 rounded-full bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/30 hover:scale-105 transition-transform flex items-center justify-center group"
          data-testid="assistant-bubble-btn"
          aria-label="Open AI assistant"
        >
          <Sparkles className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-400 border-2 border-white animate-pulse" />
          <span className="absolute right-16 top-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-medium bg-slate-900 text-white px-2.5 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            Ask Sabi
          </span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-[60] w-[min(380px,calc(100vw-24px))] h-[min(560px,calc(100vh-40px))] rounded-2xl bg-white shadow-2xl shadow-slate-900/15 border border-slate-200 flex flex-col overflow-hidden"
          data-testid="assistant-panel"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 text-white flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold leading-tight">Sabi</div>
              <div className="text-[11px] opacity-90 truncate">
                AI for {retailerName}
              </div>
            </div>
            <button
              onClick={() => setTtsOn((v) => !v)}
              className="h-8 w-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
              title={ttsOn ? "Voice replies on" : "Voice replies off"}
              data-testid="assistant-tts-toggle"
            >
              {ttsOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              onClick={clearChat}
              className="h-8 w-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
              title="Clear conversation"
              data-testid="assistant-clear"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="h-8 w-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
              data-testid="assistant-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 bg-slate-50/60">
            {turns.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-6">
                <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-indigo-500" />
                </div>
                <div className="font-medium text-slate-800">Hi, I'm Sabi.</div>
                <div className="mt-1 text-[12px]">
                  Ask me anything about <span className="font-medium">{retailerName}</span>'s stock,
                  sales, or shipments. I can also place reorders for you.
                </div>
                <div className="mt-4 grid grid-cols-1 gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left text-[12.5px] text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                      data-testid={`assistant-suggestion-${s.split(" ")[0].toLowerCase()}`}
                    >
                      <MessageCircle className="inline h-3 w-3 text-slate-400 mr-1.5" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {turns.map((t, i) => (
                <ChatRow key={i} turn={t} retailerName={retailerName} />
              ))}
              {thinking && (
                <div className="flex items-center gap-2 text-slate-500 text-[12px] pl-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sabi is thinking…
                </div>
              )}
              {transcribing && !thinking && (
                <div className="flex items-center gap-2 text-slate-500 text-[12px] pl-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Transcribing…
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-slate-200 bg-white p-2.5">
            <div className="flex items-end gap-2">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={!recordSupported || transcribing}
                className={`h-10 w-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${
                  recording
                    ? "bg-rose-500 text-white animate-pulse"
                    : transcribing
                    ? "bg-amber-100 text-amber-700"
                    : recordSupported
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-slate-50 text-slate-300 cursor-not-allowed"
                }`}
                title={
                  recording ? "Stop recording"
                  : transcribing ? "Transcribing…"
                  : recordSupported ? "Tap to dictate"
                  : "Microphone unavailable"
                }
                data-testid="assistant-mic"
              >
                {recording ? <Square className="h-4 w-4" />
                  : transcribing ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Mic className="h-4 w-4" />}
              </button>
              <Input
                value={input}
                onChange={(e: any) => setInput(e.target.value)}
                onKeyDown={(e: any) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={
                  recording ? "Recording — tap stop when done"
                  : transcribing ? "Transcribing…"
                  : "Ask about your store…"
                }
                className="flex-1 h-10"
                data-testid="assistant-input"
              />
              <Button
                onClick={() => send(input)}
                disabled={!input.trim() || thinking}
                className="h-10 px-3 bg-slate-900 hover:bg-slate-800 text-white"
                data-testid="assistant-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-1.5 text-[10px] text-slate-400 text-center">
              Sabi only sees data for {retailerName}.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatRow({ turn, retailerName }: { turn: ChatTurn; retailerName: string }) {
  const isUser = turn.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center mr-2 flex-shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed shadow-sm ${
          isUser
            ? "bg-slate-900 text-white rounded-br-md"
            : "bg-white border border-slate-200 text-slate-800 rounded-bl-md"
        }`}
        data-testid={`assistant-msg-${turn.role}`}
      >
        <FormattedMessage text={turn.content} />
        {turn.action?.action === "reorder" && (
          <div className="mt-2 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-medium rounded-full px-2 py-0.5">
            <Sparkles className="h-3 w-3" /> Reorder placed
          </div>
        )}
      </div>
    </div>
  );
}

/** Lightweight markdown-ish renderer: bold + bullet lists + line breaks. */
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split(/\n/);
  return (
    <div>
      {lines.map((ln, i) => {
        if (/^\s*[-*]\s+/.test(ln)) {
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-slate-400">•</span>
              <span dangerouslySetInnerHTML={{ __html: bold(ln.replace(/^\s*[-*]\s+/, "")) }} />
            </div>
          );
        }
        if (/^#+\s/.test(ln)) {
          return (
            <div key={i} className="font-semibold mt-1.5" dangerouslySetInnerHTML={{ __html: bold(ln.replace(/^#+\s/, "")) }} />
          );
        }
        if (!ln.trim()) return <div key={i} className="h-1.5" />;
        return <div key={i} dangerouslySetInnerHTML={{ __html: bold(ln) }} />;
      })}
    </div>
  );
}

function bold(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code class=\"bg-slate-100 rounded px-1\">$1</code>");
}

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*#`>_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
