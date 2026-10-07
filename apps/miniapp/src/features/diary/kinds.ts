import {
  Droplet,
  HeartPulse,
  Pill,
  Scale,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { DiaryLog } from "./useDiary";

/**
 * Значок вида — чтобы запись узнавалась раньше, чем прочитана. Один на ленту
 * записей и на выбор «что записать»: значок, по которому человек нашёл вид в
 * выборе, он же видит у записи в ленте.
 */
export const KIND_ICON: Record<DiaryLog["kind"], LucideIcon> = {
  seizures: Zap,
  ketones: Droplet,
  weight: Scale,
  medications: Pill,
  meals: UtensilsCrossed,
  "side-effects": HeartPulse,
};
