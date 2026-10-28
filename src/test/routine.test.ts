import { describe, expect, it } from "vitest";

import { parseRoutineAi } from "@/lib/ai/routine";
import {
  adherenceSeries,
  buildDay,
  isoWeekday,
  summarizeDay,
  zonedTimeToIso,
  type RoutineItem,
  type RoutineLog,
} from "@/lib/routine";

const item = (id: string, time: string, extra: Partial<RoutineItem> = {}): RoutineItem => ({
  id,
  senior_id: "s",
  category: "medication",
  title: id,
  details: null,
  scheduled_time: time,
  days_of_week: [1, 2, 3, 4, 5, 6, 7],
  active: true,
  ...extra,
});
const log = (item_id: string, status: RoutineLog["status"], created_at: string, local_date = "2026-10-28"): RoutineLog => ({
  id: created_at,
  item_id,
  local_date,
  status,
  done_at: null,
  note: null,
  source: "coordinator",
  created_at,
});

describe("daily routine", () => {
  it("newest log wins, so a correction replaces the shown status", () => {
    const d = buildDay([item("a", "08:00")], [log("a", "missed", "1"), log("a", "done", "2")], "2026-10-28", 600);
    expect(d[0]?.status).toBe("done");
  });

  it("only flags overdue an hour after the scheduled time today", () => {
    expect(buildDay([item("a", "08:00")], [], "2026-10-28", 8 * 60 + 59)[0]?.overdue).toBe(false);
    expect(buildDay([item("a", "08:00")], [], "2026-10-28", 9 * 60 + 1)[0]?.overdue).toBe(true);
  });

  it("skips items not scheduled on that weekday or paused", () => {
    expect(isoWeekday("2026-10-28")).toBe(3); // Wednesday
    const d = buildDay([item("mon", "08:00", { days_of_week: [1] }), item("off", "08:00", { active: false })], [], "2026-10-28", 0);
    expect(d).toHaveLength(0);
  });

  it("counts medicines taken separately", () => {
    const s = summarizeDay(buildDay([item("a", "08:00"), item("b", "20:00"), item("m", "13:00", { category: "meal" })], [log("a", "done", "1"), log("m", "done", "2")], "2026-10-28", 0));
    expect(s.medsTotal).toBe(2);
    expect(s.medsDone).toBe(1);
    expect(s.done).toBe(2);
  });

  it("chart treats unrecorded items as not recorded, never as missed", () => {
    const [day] = adherenceSeries([item("a", "08:00")], [], "2026-10-28", 1);
    expect(day?.missed).toBe(0);
    expect(day?.notRecorded).toBe(1);
  });

  it("converts local time to UTC for Asia/Kolkata", () => {
    expect(zonedTimeToIso("2026-10-28", "09:00", "Asia/Kolkata")).toBe("2026-10-28T03:30:00.000Z");
  });

  it("AI suggestions drop unknown item ids", () => {
    const raw = JSON.stringify({
      updates: [
        { item_id: "a", status: "done", time: "09:00", note: null },
        { item_id: "invented", status: "done", time: null, note: null },
      ],
      unmatched: [],
    });
    const r = parseRoutineAi(raw, new Set(["a"]));
    expect(r.ok && r.value.updates.map((u) => u.item_id)).toEqual(["a"]);
  });
});
