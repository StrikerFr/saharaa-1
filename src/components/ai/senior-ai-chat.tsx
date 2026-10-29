import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, ChevronDown, ChevronUp, MessageSquare, Send, Sparkles, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { askSeniorAI } from "@/lib/ai-assistant.functions";

interface SeniorAIChatProps {
  seniorId: string;
  seniorName: string;
  compact?: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export function SeniorAIChat({ seniorId, seniorName, compact = false }: SeniorAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const askFn = useServerFn(askSeniorAI);

  const mutation = useMutation({
    mutationFn: async (questionText: string) => {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      return await askFn({
        data: {
          seniorId,
          question: questionText,
          history,
        },
      });
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    },
    onError: (err: any) => {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            err?.message ||
            "Unable to retrieve care records at this moment. Please check your connection and try again.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, mutation.isPending]);

  function handleSend(textToSend?: string) {
    const q = (textToSend || input).trim();
    if (!q || mutation.isPending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    mutation.mutate(q);
  }

  const SUGGESTED_QUESTIONS = [
    `How is ${seniorName} doing today?`,
    `Did ${seniorName} take morning medicine today?`,
    `How has blood pressure & health been past month?`,
    `Are there any active alerts or missed routines?`,
  ];

  return (
    <div className="flex flex-col rounded-2xl border border-primary/20 bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-primary/5 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Ask Sahaara AI</h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Live Records
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Direct answers about {seniorName}&apos;s today update, past months health, or routine adherence.
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="size-8 p-0 text-muted-foreground hover:text-foreground"
          aria-label={isExpanded ? "Collapse AI Chat" : "Expand AI Chat"}
        >
          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      </div>

      {isExpanded && (
        <div className="flex flex-col p-4 sm:p-5 gap-3.5">
          {/* Quick suggestions if no messages yet */}
          {messages.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Quick questions to ask:</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_QUESTIONS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSend(q)}
                    disabled={mutation.isPending}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground/80 hover:bg-muted hover:border-primary/40 transition-colors text-left"
                  >
                    💬 {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Chat scroll area */}
          {messages.length > 0 && (
            <div
              ref={scrollRef}
              className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1 text-sm"
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                      <Bot className="size-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed text-xs sm:text-sm whitespace-pre-line shadow-xs ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-muted/60 text-foreground border border-border"
                    }`}
                  >
                    {m.content}
                    <div
                      className={`mt-1 text-[10px] text-right ${
                        m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                      }`}
                    >
                      {m.timestamp}
                    </div>
                  </div>
                  {m.role === "user" && (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground mt-0.5">
                      <User className="size-4" />
                    </div>
                  )}
                </div>
              ))}

              {mutation.isPending && (
                <div className="flex gap-2.5 items-start">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-0.5">
                    <Bot className="size-4 animate-spin" />
                  </div>
                  <div className="rounded-2xl bg-muted/60 px-4 py-3 border border-border w-2/3 flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Input field */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2 pt-1"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Ask about ${seniorName}'s health, today's schedule, or medicines...`}
              disabled={mutation.isPending}
              maxLength={500}
              className="h-10 text-xs sm:text-sm bg-background"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!input.trim() || mutation.isPending}
              loading={mutation.isPending}
              className="h-10 px-3.5 gap-1.5 shrink-0"
            >
              <Send className="size-4" />
              <span className="hidden sm:inline">Ask</span>
            </Button>
          </form>

          {/* Grounding note */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
            <span>Answers generated on-demand from verified care records & routine logs.</span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="hover:text-foreground underline"
              >
                Clear chat
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
