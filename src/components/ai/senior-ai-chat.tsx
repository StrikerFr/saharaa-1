import { useState, useRef, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Maximize2,
  Minimize2,
  MessageSquare,
  Send,
  Sparkles,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { askSeniorAI, cleanSeniorDisplayName } from "@/lib/ai-assistant.functions";

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

interface FormattedBlock {
  type: "heading" | "list" | "callout" | "paragraph";
  headingText?: string;
  items?: string[];
  text?: string;
}

/**
 * Parses markdown inline formatting (**bold**, *emphasis*, status badges).
 * Guarantees zero raw asterisks remain visible.
 */
function renderFormattedInline(raw: string) {
  if (!raw) return null;

  // 1. Split on **bold**
  const boldTokens = raw.split(/(\*\*[^*]+\*\*)/g);

  return boldTokens.map((bToken, bIdx) => {
    if (bToken.startsWith("**") && bToken.endsWith("**") && bToken.length > 4) {
      const boldContent = bToken.slice(2, -2);
      return (
        <strong key={bIdx} className="font-semibold text-foreground">
          {renderSingleItalicsAndBadges(boldContent)}
        </strong>
      );
    }
    return <span key={bIdx}>{renderSingleItalicsAndBadges(bToken)}</span>;
  });
}

/**
 * Handles *emphasis*, *STATUS*, and keyword status badges.
 */
function renderSingleItalicsAndBadges(text: string) {
  // Split on *italic* or *STATUS*
  const italicTokens = text.split(/(\*[^*]+\*)/g);

  return italicTokens.map((token, idx) => {
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      const inner = token.slice(1, -1).trim();
      const lower = inner.toLowerCase();

      // Check if it is a status keyword like *PENDING*, *needs_review*, etc.
      if (lower === "pending") {
        return (
          <span
            key={idx}
            className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border mx-0.5 align-middle"
          >
            Pending
          </span>
        );
      }
      if (lower === "needs_review" || lower === "prompt_review_recommended") {
        return (
          <span
            key={idx}
            className="inline-flex items-center rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning-foreground border border-warning/30 mx-0.5 align-middle"
          >
            {inner.replace(/_/g, " ")}
          </span>
        );
      }
      return (
        <em key={idx} className="font-medium text-foreground/90 not-italic bg-muted/50 px-1 py-0.5 rounded text-[11px]">
          {inner.replace(/_/g, " ")}
        </em>
      );
    }

    // Keyword badges without asterisks
    const statusRegex =
      /(\bmissed\b|\btaken\b|\bcompleted\b|\belevated\b|\bhigher than usual\b|\bdelayed\b|\boverdue\b|\bpending\b)/gi;
    const parts = token.split(statusRegex);

    if (parts.length <= 1) {
      return token;
    }

    return parts.map((p, pIdx) => {
      const lower = p.toLowerCase();
      if (lower === "missed" || lower === "delayed" || lower === "overdue") {
        return (
          <span
            key={pIdx}
            className="inline-flex items-center rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning-foreground border border-warning/30 mx-0.5 align-middle"
          >
            {p}
          </span>
        );
      }
      if (lower === "taken" || lower === "completed") {
        return (
          <span
            key={pIdx}
            className="inline-flex items-center rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-semibold text-success-foreground border border-success/30 mx-0.5 align-middle"
          >
            {p}
          </span>
        );
      }
      if (lower === "elevated" || lower === "higher than usual") {
        return (
          <span
            key={pIdx}
            className="inline-flex items-center rounded bg-critical-soft px-1.5 py-0.5 text-[11px] font-semibold text-critical-foreground border border-critical/30 mx-0.5 align-middle"
          >
            {p}
          </span>
        );
      }
      if (lower === "pending") {
        return (
          <span
            key={pIdx}
            className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border mx-0.5 align-middle"
          >
            {p}
          </span>
        );
      }
      return p;
    });
  });
}

/**
 * Structured, professional markdown renderer for care assistant responses.
 */
function CareAssistantMessageContent({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const rawLines = content.split("\n");
    const result: FormattedBlock[] = [];
    let currentList: string[] = [];

    function flushList() {
      if (currentList.length > 0) {
        result.push({ type: "list", items: [...currentList] });
        currentList = [];
      }
    }

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]?.trim() ?? "";
      if (!line) {
        flushList();
        continue;
      }

      // 1. Heading detection (Markdown headers, bold alone, or bullet before uppercase header)
      const isBulletHeader = /^[•\-*]\s+([A-Z\s&]{4,40}|Today's.*|Upcoming.*|Completed.*|Health.*|Recent.*|Active.*):?$/i.test(line);
      const isPlainHeader = line.startsWith("#") || (line.startsWith("**") && line.endsWith("**") && line.length < 80);

      if (isBulletHeader || isPlainHeader) {
        flushList();
        const cleanTitle = line
          .replace(/^[•\-*]\s+/, "")
          .replace(/^#{1,4}\s+/, "")
          .replace(/^\*\*/, "")
          .replace(/\*\*$/, "")
          .replace(/:$/, "")
          .trim();
        result.push({ type: "heading", headingText: cleanTitle });
        continue;
      }

      // 2. Callout / Summary takeaway (Overall, ... or Summary: ...)
      if (/^(?:overall|summary|in summary|key takeaway)[:,\s]/i.test(line)) {
        flushList();
        result.push({ type: "callout", text: line });
        continue;
      }

      // 3. Bullet list items
      if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        const cleanItem = line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "");
        currentList.push(cleanItem);
        continue;
      }

      // 4. Regular paragraph line
      flushList();
      result.push({ type: "paragraph", text: line });
    }

    flushList();
    return result;
  }, [content]);

  return (
    <div className="flex flex-col gap-2.5 text-card-foreground leading-relaxed text-xs sm:text-sm tabular-nums">
      {blocks.map((block, idx) => {
        if (block.type === "heading") {
          return (
            <div
              key={idx}
              className="mt-3.5 first:mt-0 mb-1 flex items-center gap-2 border-b border-border/70 pb-1.5 text-xs font-semibold uppercase tracking-wider text-primary"
            >
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
              <span>{block.headingText}</span>
            </div>
          );
        }

        if (block.type === "list" && block.items) {
          return (
            <ul key={idx} className="my-1 flex flex-col gap-2 pl-0.5">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="flex items-start gap-2.5 text-card-foreground/95">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/70" />
                  <div className="flex-1">{renderFormattedInline(item)}</div>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "callout" && block.text) {
          return (
            <div
              key={idx}
              className="mt-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs sm:text-sm font-medium text-foreground flex items-start gap-2.5 shadow-2xs"
            >
              <Sparkles className="size-4 text-primary shrink-0 mt-0.5" />
              <div className="leading-relaxed flex-1">{renderFormattedInline(block.text)}</div>
            </div>
          );
        }

        // Paragraph
        return (
          <p key={idx} className="my-0.5 leading-relaxed text-card-foreground/90">
            {renderFormattedInline(block.text || "")}
          </p>
        );
      })}
    </div>
  );
}

export function SeniorAIChat({ seniorId, seniorName, compact = false }: SeniorAIChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fullScreenScrollRef = useRef<HTMLDivElement>(null);

  const cleanName = cleanSeniorDisplayName(seniorName);
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
          timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
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
          timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        },
      ]);
    },
  });

  // Scroll to bottom on updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (fullScreenScrollRef.current) {
      fullScreenScrollRef.current.scrollTop = fullScreenScrollRef.current.scrollHeight;
    }
  }, [messages, mutation.isPending, isFullscreen]);

  // Handle ESC key and background scroll lock in fullscreen mode
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isFullscreen]);

  function handleSend(textToSend?: string) {
    const q = (textToSend || input).trim();
    if (!q || mutation.isPending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      timestamp: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput("");
    mutation.mutate(q);
  }

  const SUGGESTED_QUESTIONS = [
    `How is ${cleanName} doing today?`,
    `Did ${cleanName} take morning medicine today?`,
    `How has blood pressure & health been over past month?`,
    `Are there any active care alerts or missed routines?`,
  ];

  return (
    <>
      {/* 1. Inline View */}
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
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary border border-primary/20">
                  Verified Records
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Direct answers about {cleanName}&apos;s schedule, medicine adherence, and health records.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(true)}
              className="h-8 gap-1.5 px-2.5 text-xs font-medium text-foreground hover:bg-primary/10 hover:border-primary/40"
              title="Expand to Full Screen View"
            >
              <Maximize2 className="size-3.5 text-primary" />
              <span className="hidden sm:inline">Full Screen</span>
            </Button>
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
        </div>

        {isExpanded && (
          <div className="flex flex-col p-4 sm:p-5 gap-4">
            {/* Quick suggestions if no messages yet */}
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">Suggested questions:</p>
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

            {/* Chat scroll area: expanded height up to 600px */}
            {messages.length > 0 && (
              <div
                ref={scrollRef}
                className="flex min-h-[300px] max-h-[600px] flex-col gap-4 overflow-y-auto pr-1 text-sm"
              >
                {messages.map((m) => (
                  <div key={m.id}>
                    {m.role === "user" ? (
                      <div className="flex gap-2.5 justify-end items-start">
                        <div className="flex flex-col items-end gap-1 max-w-[85%] sm:max-w-[75%]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                            <span className="text-[11px] font-medium text-foreground/80">You</span>
                          </div>
                          <div className="rounded-2xl bg-primary px-4 py-2.5 text-xs sm:text-sm font-medium text-primary-foreground shadow-xs">
                            {m.content}
                          </div>
                        </div>
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground mt-1 shadow-2xs">
                          <User className="size-3.5" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 justify-start items-start">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1 shadow-2xs">
                          <Sparkles className="size-3.5" />
                        </div>
                        <div className="flex flex-col gap-1 max-w-[95%] sm:max-w-[90%]">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-primary">Sahaara Care Assistant</span>
                            <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                          </div>
                          <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs">
                            <CareAssistantMessageContent content={m.content} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {mutation.isPending && (
                  <div className="flex gap-2.5 items-start">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1">
                      <Sparkles className="size-3.5 animate-spin" />
                    </div>
                    <div className="flex flex-col gap-1 max-w-[75%]">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold text-primary">Sahaara Care Assistant</span>
                        <span className="text-[10px] text-muted-foreground">Analyzing verified care records...</span>
                      </div>
                      <div className="rounded-2xl bg-card p-4 border border-border flex flex-col gap-2">
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3.5 w-4/5" />
                        <Skeleton className="h-3.5 w-3/5" />
                      </div>
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
                placeholder={`Ask about ${cleanName}'s health, today's schedule, or medicines...`}
                disabled={mutation.isPending}
                className="flex-1 text-xs sm:text-sm bg-background border-border"
              />
              <Button
                type="submit"
                disabled={mutation.isPending || !input.trim()}
                size="sm"
                className="gap-1.5 px-3.5 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="size-3.5" />
                <span className="hidden sm:inline">Ask</span>
              </Button>
            </form>

            {/* Footer with Fullscreen prompt */}
            <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                Grounded in live records
              </span>
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="text-primary hover:underline font-medium flex items-center gap-1"
              >
                <Maximize2 className="size-3" />
                Need more space? Open Full Screen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 2. Fullscreen Modal View */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-2 sm:p-4 md:p-6 animate-in fade-in-0 duration-150">
          <div className="relative flex h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border bg-primary/5 px-4 py-3.5 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">Sahaara AI Care Assistant</h2>
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
                      {cleanName}
                    </span>
                    <span className="hidden sm:inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground border border-border">
                      Verified Records
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Full-screen view • Today&apos;s routine adherence, vitals, and verified health history.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFullscreen(false)}
                  className="h-8 gap-1.5 px-3 text-xs font-medium hover:bg-muted"
                >
                  <Minimize2 className="size-3.5 text-muted-foreground" />
                  <span className="hidden sm:inline">Exit Full Screen</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsFullscreen(false)}
                  className="size-8 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            {/* Modal Body & Messages */}
            <div
              ref={fullScreenScrollRef}
              className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 flex flex-col gap-5 bg-background/40"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center my-auto py-12 text-center max-w-md mx-auto">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
                    <Sparkles className="size-6" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground mb-1">
                    Ask anything about {cleanName}&apos;s care
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                    Get instant, grounded answers about daily medicines, meals, hydration, vital signs, or health trends over the past month.
                  </p>
                  <div className="flex flex-col w-full gap-2">
                    {SUGGESTED_QUESTIONS.map((q, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSend(q)}
                        disabled={mutation.isPending}
                        className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs text-foreground/80 hover:bg-muted hover:border-primary/40 transition-colors text-left shadow-2xs"
                      >
                        💬 {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div key={m.id} className="w-full max-w-4xl mx-auto">
                    {m.role === "user" ? (
                      <div className="flex gap-3 justify-end items-start">
                        <div className="flex flex-col items-end gap-1 max-w-[80%]">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                            <span className="text-[11px] font-medium text-foreground/80">You</span>
                          </div>
                          <div className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-xs">
                            {m.content}
                          </div>
                        </div>
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground mt-1 shadow-2xs">
                          <User className="size-4" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 justify-start items-start">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1 shadow-2xs">
                          <Sparkles className="size-4" />
                        </div>
                        <div className="flex flex-col gap-1 w-full flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-primary">Sahaara Care Assistant</span>
                            <span className="text-[10px] text-muted-foreground">{m.timestamp}</span>
                          </div>
                          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
                            <CareAssistantMessageContent content={m.content} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}

              {mutation.isPending && (
                <div className="w-full max-w-4xl mx-auto flex gap-3 items-start">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1">
                    <Sparkles className="size-4 animate-spin" />
                  </div>
                  <div className="flex flex-col gap-1 w-full max-w-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-primary">Sahaara Care Assistant</span>
                      <span className="text-[10px] text-muted-foreground">Checking live records...</span>
                    </div>
                    <div className="rounded-2xl bg-card p-5 border border-border flex flex-col gap-2.5">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-4 w-3/5" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Sticky Input Bar */}
            <div className="border-t border-border bg-card p-4 sm:p-5 flex flex-col gap-2.5">
              {messages.length > 0 && (
                <div className="flex flex-wrap gap-1.5 overflow-x-auto pb-1">
                  {SUGGESTED_QUESTIONS.slice(0, 3).map((q, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSend(q)}
                      disabled={mutation.isPending}
                      className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`Ask about ${cleanName}'s health, today's schedule, or medicines...`}
                  disabled={mutation.isPending}
                  className="flex-1 text-sm bg-background border-border h-10"
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={mutation.isPending || !input.trim()}
                  className="gap-2 px-5 bg-primary text-primary-foreground hover:bg-primary/90 h-10"
                >
                  <Send className="size-4" />
                  <span>Send</span>
                </Button>
              </form>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span>Press ESC or click Exit to return to the dashboard</span>
                <span>Non-clinical decision support • Consult doctor for medical advice</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
