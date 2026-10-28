// Daily routine server functions. Reads run through the caller's RLS session;
// writes go through SECURITY DEFINER functions that derive the actor and audit.
// The AI helper only proposes updates; nothing is written until a human confirms.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { userMessage, ProviderError } from "@/lib/ai/provider-errors";
import {
  buildRoutinePrompt,
  parseRoutineAi,
  ROUTINE_AI_JSON_SCHEMA,
  ROUTINE_AI_SYSTEM_PROMPT,
  type RoutineAiResult,
} from "@/lib/ai/routine";
import {
  addDays,
  formatTime,
  isDueOn,
  ROUTINE_CATEGORIES,
  ROUTINE_SOURCES,
  type RoutineItem,
  type RoutineLog,
} from "@/lib/routine";

type Untyped = {
  from(t: string): {
    select(c: string): {
      eq(c: string, v: string): Untyped2;
    };
  };
  rpc(f: string, a: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
};
type Untyped2 = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  gte(c: string, v: string): Untyped2;
  lte(c: string, v: string): Untyped2;
  order(c: string, o?: { ascending: boolean }): Untyped2;
};
const u = (c: unknown) => c as Untyped;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const NOT_READY =
  "Daily routine isn't set up in the database yet. Run supabase/phase8_routine.sql in the SQL editor.";

function friendly(msg: string): string {
  if (/does not exist|schema cache|Could not find/i.test(msg)) return NOT_READY;
  if (/forbidden|permission/i.test(msg)) return "You don't have access to this senior.";
  return "Couldn't save that. Please try again.";
}

export type RoutineData =
  | { ok: true; timeZone: string; items: RoutineItem[]; logs: RoutineLog[] }
  | { ok: false; message: string };

export const getRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ seniorId: z.string().uuid(), from: dateStr, to: dateStr }).parse(d),
  )
  .handler(async ({ data, context }): Promise<RoutineData> => {
    const db = context.supabase;
    const { data: senior } = await db
      .from("seniors")
      .select("time_zone")
      .eq("id", data.seniorId)
      .maybeSingle();
    if (!senior) return { ok: false, message: "You don't have access to this senior." };
    const [items, logs] = await Promise.all([
      u(db)
        .from("care_routine_items")
        .select("id, senior_id, category, title, details, scheduled_time, days_of_week, active")
        .eq("senior_id", data.seniorId)
        .order("scheduled_time"),
      u(db)
        .from("care_routine_logs")
        .select("id, item_id, local_date, status, done_at, note, source, created_at")
        .eq("senior_id", data.seniorId)
        .gte("local_date", data.from)
        .lte("local_date", data.to)
        .order("created_at", { ascending: false }),
    ]);
    if (items.error || logs.error)
      return { ok: false, message: friendly((items.error ?? logs.error)!.message) };
    return {
      ok: true,
      timeZone: senior.time_zone,
      items: (items.data ?? []) as RoutineItem[],
      logs: (logs.data ?? []) as RoutineLog[],
    };
  });

const itemInput = z.object({
  seniorId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  category: z.enum(Object.keys(ROUTINE_CATEGORIES) as [keyof typeof ROUTINE_CATEGORIES]),
  title: z.string().trim().min(1).max(120),
  details: z.string().max(500).nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  active: z.boolean(),
});

export const saveRoutineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => itemInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await u(context.supabase).rpc("save_routine_item", {
      _senior: data.seniorId,
      _item: data.itemId,
      _category: data.category,
      _title: data.title,
      _details: data.details,
      _time: data.time,
      _days: [...new Set(data.days)].sort(),
      _active: data.active,
    });
    if (error) return { ok: false as const, message: friendly(error.message) };
    return { ok: true as const };
  });

const logInput = z.object({
  itemId: z.string().uuid(),
  date: dateStr,
  status: z.enum(["done", "missed", "skipped", "pending"]),
  doneAt: z.string().datetime().nullable(),
  note: z.string().max(500).nullable(),
  source: z.enum(ROUTINE_SOURCES),
  clientRequestId: z.string().uuid(),
});

export const logRoutine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ entries: z.array(logInput).min(1).max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    for (const e of data.entries) {
      const { error } = await u(context.supabase).rpc("log_routine", {
        _item: e.itemId,
        _date: e.date,
        _status: e.status,
        _done_at: e.status === "done" ? e.doneAt : null,
        _note: e.note,
        _source: e.source,
        _client_request_id: e.clientRequestId,
      });
      if (error) return { ok: false as const, message: friendly(error.message) };
    }
    return { ok: true as const };
  });

export type InterpretResult = ({ ok: true } & RoutineAiResult) | { ok: false; message: string };

export const interpretRoutineUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ seniorId: z.string().uuid(), date: dateStr, text: z.string().trim().min(2).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<InterpretResult> => {
    const res = await u(context.supabase)
      .from("care_routine_items")
      .select("id, category, title, scheduled_time, days_of_week, active")
      .eq("senior_id", data.seniorId);
    if (res.error) return { ok: false, message: friendly(res.error.message) };
    const items = ((res.data ?? []) as RoutineItem[]).filter((i) => isDueOn(i, data.date));
    if (items.length === 0)
      return { ok: false, message: "No routine items are scheduled for this day yet." };
    if (data.date > addDays(new Date().toISOString().slice(0, 10), 1))
      return { ok: false, message: "Can't record a future day." };
    const ids = new Set(items.map((i) => i.id));
    try {
      const { groqConfig, summarize } = await import("@/lib/ai/groq.server");
      const r = await summarize(
        ROUTINE_AI_SYSTEM_PROMPT,
        buildRoutinePrompt(
          data.date,
          items.map((i) => ({
            id: i.id,
            title: i.title,
            category: i.category,
            time: formatTime(i.scheduled_time),
          })),
          data.text,
        ),
        ROUTINE_AI_JSON_SCHEMA,
        (raw) => parseRoutineAi(raw, ids).ok,
        groqConfig(),
      );
      const parsed = parseRoutineAi(r.raw, ids);
      if (!parsed.ok) return { ok: false, message: "The AI reply couldn't be understood. Try rephrasing." };
      return { ok: true, ...parsed.value };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("provider_error", "groq");
      return { ok: false, message: userMessage(pe) };
    }
  });
