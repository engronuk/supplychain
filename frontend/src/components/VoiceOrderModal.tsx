// VoiceOrderModal.tsx — Web Speech API based voice ordering
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, Square, Loader2, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import retailerAnalyticsService from "@/services/retailerAnalyticsService";

interface Product {
  id: string;
  name: string;
}

interface ParsedItem {
  product_id: string;
  product_name: string;
  quantity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  retailerId: string;
  products: Product[];
  onSubmitted?: () => void;
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50,
  a: 1, an: 1,
};

function tokensToNumber(token: string): number | null {
  const n = parseInt(token, 10);
  if (!isNaN(n)) return n;
  if (NUM_WORDS[token.toLowerCase()] !== undefined) return NUM_WORDS[token.toLowerCase()];
  return null;
}

/**
 * Heuristic parser: splits the spoken sentence by " and "/comma, then for each
 * segment finds a (number, productMatch) pair using fuzzy contains over product names.
 */
function parseOrder(transcript: string, products: Product[]): ParsedItem[] {
  if (!transcript) return [];
  const text = transcript.toLowerCase().replace(/[.!?]/g, "");
  const segments = text.split(/\s+(?:and|,|then|plus)\s+/);
  const out: ParsedItem[] = [];
  const seen = new Set<string>();

  for (const seg of segments) {
    if (!seg.trim()) continue;
    const tokens = seg.trim().split(/\s+/);
    let qty: number | null = null;
    for (const tk of tokens) {
      const n = tokensToNumber(tk);
      if (n !== null) {
        qty = n;
        break;
      }
    }
    if (qty == null) qty = 1;

    // Find the product whose name has the most overlapping word matches
    let best: { p: Product; score: number } | null = null;
    for (const p of products) {
      const pname = p.name.toLowerCase();
      let score = 0;
      for (const tk of tokens) {
        if (tk.length < 3) continue;
        if (pname.includes(tk)) score += tk.length;
      }
      // also try whole-segment substring match
      const segLower = seg.toLowerCase();
      const firstWord = pname.split(/\s+/)[0];
      if (firstWord.length > 3 && segLower.includes(firstWord)) score += firstWord.length * 2;
      if (best == null || score > best.score) best = { p, score };
    }
    if (best && best.score >= 4 && !seen.has(best.p.id)) {
      out.push({ product_id: best.p.id, product_name: best.p.name, quantity: qty });
      seen.add(best.p.id);
    }
  }
  return out;
}

export default function VoiceOrderModal({ open, onOpenChange, retailerId, products, onSubmitted }: Props) {
  const [supported, setSupported] = useState<boolean>(true);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const W: any = window;
    const Speech = W.SpeechRecognition || W.webkitSpeechRecognition;
    setSupported(!!Speech);
  }, []);

  useEffect(() => {
    if (!open) {
      stopListening();
      setTranscript("");
      setItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const exampleProducts = useMemo(() => products.slice(0, 3).map((p) => p.name), [products]);

  function startListening() {
    const W: any = window;
    const Speech = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Speech) {
      setSupported(false);
      return;
    }
    const rec = new Speech();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript + " ";
      }
      setTranscript(text.trim());
      const parsed = parseOrder(text, products);
      if (parsed.length) setItems(parsed);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e: any) => {
      setListening(false);
      if (e.error !== "aborted" && e.error !== "no-speech") {
        toast.error(`Voice error: ${e.error}`);
      }
    };
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  function stopListening() {
    try {
      recRef.current?.stop();
    } catch {
      /* */
    }
    recRef.current = null;
    setListening(false);
  }

  async function submit() {
    const payload = items
      .filter((i) => i.quantity > 0)
      .map((i) => ({ product_id: i.product_id, quantity: i.quantity }));
    if (!payload.length) {
      toast.error("No items detected. Try again or edit manually.");
      return;
    }
    setSubmitting(true);
    const res = await retailerAnalyticsService.submitReorder(retailerId, {
      items: payload,
      note: "Voice order",
    });
    setSubmitting(false);
    if (res.queued) toast.success("Saved offline — will sync when online.");
    else toast.success(`Voice order sent (${payload.length} item${payload.length === 1 ? "" : "s"}).`);
    onOpenChange(false);
    onSubmitted && onSubmitted();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="voice-order-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
              <Mic className="h-4 w-4 text-white" />
            </div>
            Voice Order
          </DialogTitle>
          <DialogDescription>
            {supported
              ? `Say something like: "Order 5 ${exampleProducts[0] || "OMO"} and 3 ${exampleProducts[1] || "Lifebuoy"}"`
              : "Voice ordering needs a Chromium-based browser. Add items manually below."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 min-h-[80px]">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-1">
              Transcript
            </div>
            <div className="text-[14px] text-slate-800 italic min-h-[24px]">
              {transcript || (
                <span className="text-slate-400 not-italic">
                  Tap the mic to start dictating your order.
                </span>
              )}
            </div>
          </div>

          {items.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3" data-testid="voice-parsed-items">
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-2 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Parsed {items.length} item{items.length === 1 ? "" : "s"}
              </div>
              <ul className="space-y-2">
                {items.map((it, idx) => (
                  <li key={it.product_id} className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-medium text-slate-800 truncate">{it.product_name}</span>
                    <Input
                      type="number"
                      min={0}
                      value={it.quantity}
                      onChange={(e) =>
                        setItems((arr) =>
                          arr.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value || 0) } : x))
                        )
                      }
                      className="w-20 h-8"
                    />
                    <button
                      onClick={() => setItems((arr) => arr.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-600 p-1"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-center">
            {!listening ? (
              <Button
                onClick={startListening}
                disabled={!supported}
                className="h-14 w-14 rounded-full bg-rose-500 hover:bg-rose-600 text-white shadow-lg"
                data-testid="voice-start-btn"
                aria-label="Start"
              >
                <Mic className="h-6 w-6" />
              </Button>
            ) : (
              <Button
                onClick={stopListening}
                className="h-14 w-14 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-lg animate-pulse"
                data-testid="voice-stop-btn"
                aria-label="Stop"
              >
                <Square className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={submitting || items.length === 0}
            className="bg-slate-900 hover:bg-slate-800"
            data-testid="voice-submit"
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Confirm order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
