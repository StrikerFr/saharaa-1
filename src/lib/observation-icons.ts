import type { LucideIcon } from "lucide-react";
import {
  Droplet,
  Footprints,
  Gauge,
  HeartPulse,
  Moon,
  NotebookPen,
  Pill,
  Scale,
  Utensils,
} from "lucide-react";
import type { ObservationType } from "./seniors";

/** One icon per observation type, used everywhere observations are shown. */
export const OBSERVATION_ICON: Record<ObservationType, LucideIcon> = {
  heart_rate: HeartPulse,
  blood_pressure: Gauge,
  weight: Scale,
  sleep_duration: Moon,
  mobility: Footprints,
  appetite: Utensils,
  hydration: Droplet,
  medication_event: Pill,
  care_note: NotebookPen,
};
