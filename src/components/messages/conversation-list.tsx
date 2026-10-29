import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Filter,
  HeartHandshake,
  RefreshCw,
  Search,
  UserCheck,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConversationSummary } from "@/lib/whatsapp.server";
import type { ConversationFilterType } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

export interface ConversationListProps {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: ConversationFilterType;
  onFilterChange: (f: ConversationFilterType) => void;
  search: string;
  onSearchChange: (s: string) => void;
  isLoading: boolean;
  isFetching: boolean;
  onRefresh: () => void;
  unreadTotal: number;
}

/** Formats a timestamp into human-friendly relative or local time. */
function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  isLoading,
  isFetching,
  onRefresh,
  unreadTotal,
}: ConversationListProps) {
  const [localSearch, setLocalSearch] = useState(search);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchChange(localSearch);
  };

  const handleClearSearch = () => {
    setLocalSearch("");
    onSearchChange("");
  };

  return (
    <aside
      aria-label="Conversations List"
      className="flex h-full flex-col border-b border-border bg-card md:border-b-0 md:border-r"
    >
      {/* Header & Refresh */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Conversations</h2>
          {unreadTotal > 0 && (
            <Badge variant="default" className="h-5 px-1.5 text-xs font-semibold">
              {unreadTotal} new
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh conversations"
          title="Refresh conversations"
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw
            className={cn("size-4", isFetching && "animate-spin text-primary")}
            aria-hidden="true"
          />
        </Button>
      </div>

      {/* Search Input */}
      <div className="border-b border-border/70 p-3">
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search phone, senior, or preview..."
            value={localSearch}
            onChange={(e) => {
              setLocalSearch(e.target.value);
              onSearchChange(e.target.value);
            }}
            className="h-9 pl-9 pr-8 text-xs"
            aria-label="Search conversations"
          />
          {localSearch && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>
      </div>

      {/* Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filter conversations"
        className="flex gap-1 overflow-x-auto border-b border-border/70 p-2 text-xs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          onClick={() => onFilterChange("all")}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap",
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "unread"}
          onClick={() => onFilterChange("unread")}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap",
            filter === "unread"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          Unread
          {unreadTotal > 0 && (
            <span className="grid size-4 place-items-center rounded-full bg-white/20 text-[10px] font-bold">
              {unreadTotal}
            </span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "authorized"}
          onClick={() => onFilterChange("authorized")}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap",
            filter === "authorized"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          Verified
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "pending"}
          onClick={() => onFilterChange("pending")}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap",
            filter === "pending"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          Pending
        </button>
      </div>

      {/* Conversations Scroll List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3 p-2">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-sm text-muted-foreground">
            <Filter className="mb-2 size-6 text-muted-foreground/60" aria-hidden="true" />
            <p className="font-medium text-foreground">No conversations found</p>
            <p className="mt-1 text-xs">
              {search
                ? "No matching conversations for your search."
                : filter === "unread"
                  ? "No unread conversations right now."
                  : "Incoming WhatsApp messages will appear here automatically."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50" role="list">
            {conversations.map((c) => {
              const isSelected = c.id === selectedId;
              const hasUnread = c.unreadCount > 0;
              const isVerified = !!c.senior && c.identity?.status === "active";
              const displayName =
                c.identity?.displayName ||
                (c.senior ? `${c.senior.displayName}'s Contact` : c.maskedPhoneNumber);

              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "w-full text-left transition-colors flex items-start gap-3 p-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                      isSelected
                        ? "bg-primary-soft/60 border-l-4 border-primary"
                        : "hover:bg-muted/50 border-l-4 border-transparent",
                      hasUnread && !isSelected && "bg-background font-medium",
                    )}
                  >
                    {/* Avatar Icon */}
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold",
                        isVerified
                          ? "bg-primary-soft text-primary"
                          : "bg-warning-soft text-warning",
                      )}
                      aria-hidden="true"
                    >
                      {c.identity?.relationshipType === "senior" ? (
                        <UserRound className="size-5" />
                      ) : c.identity?.relationshipType === "family_member" ? (
                        <HeartHandshake className="size-5" />
                      ) : (
                        <AlertCircle className="size-5" />
                      )}
                    </span>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {displayName}
                        </span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {formatTime(c.lastMessageAt)}
                        </span>
                      </div>

                      {/* Senior Context or Phone */}
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        {c.senior ? (
                          <span className="truncate text-primary">
                            Senior: {c.senior.displayName}
                          </span>
                        ) : (
                          <span className="truncate font-mono">{c.maskedPhoneNumber}</span>
                        )}

                        {c.identity?.status === "active" && (
                          <UserCheck
                            className="size-3 text-success shrink-0"
                            aria-label="Verified"
                          />
                        )}
                      </div>

                      {/* Last Message Preview & Unread Pill */}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {c.lastMessagePreview || "No messages yet"}
                        </p>
                        {hasUnread && (
                          <Badge
                            variant="default"
                            className="h-4.5 px-1.5 text-[10px] font-bold shrink-0"
                          >
                            {c.unreadCount}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer Info */}
      <div className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">
        <span>
          {conversations.length} total conversation{conversations.length === 1 ? "" : "s"}
        </span>
      </div>
    </aside>
  );
}
