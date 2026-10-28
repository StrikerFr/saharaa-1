// User-facing wording for engine output. Neutral, operational, non-diagnostic.
import type { QualityStatus, ReviewPriority } from "./engine";

export const PRIORITY_LABEL: Record<
  ReviewPriority,
  { label: string; tone: "info" | "warning" | "neutral"; help: string }
> = {
  unable_to_assess: {
    label: "Unable to assess reliably",
    tone: "neutral",
    help: "Too few rules could be evaluated with the entries available. This is not reassurance.",
  },
  no_signal_detected: {
    label: "No signal detected in evaluated scope",
    tone: "neutral",
    help: "None of the evaluated rules found a change. This does not mean the person is safe or that no risk exists.",
  },
  review_suggested: {
    label: "Review suggested",
    tone: "info",
    help: "A change was found in one area of this person's records.",
  },
  review_recommended: {
    label: "Review recommended",
    tone: "warning",
    help: "Changes were found in two or more separate areas of this person's records.",
  },
  prompt_review_recommended: {
    label: "Prompt review recommended",
    tone: "warning",
    help: "Changes were found in three or more separate areas of this person's records.",
  },
};

export const QUALITY_LABEL: Record<QualityStatus, string> = {
  adequate: "Data adequate for the evaluated rules",
  limited: "Data limitations apply",
  insufficient: "Insufficient data",
};

export const DOMAIN_LABEL: Record<string, string> = {
  heart_rate: "Heart rate",
  blood_pressure: "Blood pressure",
  weight: "Weight",
  sleep: "Sleep",
  intake: "Food & fluid intake",
  mobility: "Mobility",
  medication: "Medication events",
  reporting: "How often entries are made",
};
