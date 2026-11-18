// Domain types. Pure data, no IO. The scheduler, tracking and export all work from these.

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

export const CATEGORIES = {
  deep: { color: "#7b5cd6", label: "Deep work" },
  learn: { color: "#3d8fd9", label: "Learning / study" },
  work: { color: "#5b6b84", label: "Work" },
  class: { color: "#e05252", label: "Class / lecture" },
  health: { color: "#3fae6a", label: "Health / exercise" },
  prayer: { color: "#2c3e50", label: "Prayer" },
  faith: { color: "#b8860b", label: "Faith / spiritual" },
  relationships: { color: "#e8739a", label: "Family / friends" },
  personal: { color: "#e8b23a", label: "Personal projects" },
  admin: { color: "#1fb3a6", label: "Plan / review / admin" },
  routine: { color: "#9aa3ad", label: "Meals / routine" },
  rest: { color: "#b9c2cf", label: "Rest / free" },
  sleep: { color: "#3b4252", label: "Sleep" },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

export type Horizon = "life" | "year" | "quarter" | "month" | "week";
export const HORIZONS: Horizon[] = ["life", "year", "quarter", "month", "week"];

export interface Goal {
  id: string;
  horizon: Horizon;
  title: string;
  /** How they will know it is done (specific outcome or measure). */
  measure?: string;
  /** YYYY-MM-DD, or free text ("end of June"). */
  deadline?: string;
  /** The value it serves, in their words. */
  why?: string;
  parentId?: string;
  area?: string;
  /** outcome = hit a result; learning = discover a method/skill; habit = keep a behaviour. */
  kind?: "outcome" | "learning" | "habit";
  /** Self-efficacy 0-100: how sure they are they can do it. */
  confidence?: number;
  status?: "active" | "paused" | "done" | "dropped";
}

export const PRAYERS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;
export type PrayerName = (typeof PRAYERS)[number];
export type SalahName = Exclude<PrayerName, "sunrise">;

/** "HH:MM", or relative to a prayer time (only resolvable when the faith module is on). */
export type TimeRule = string | { anchor: PrayerName; offsetMin: number };

export interface SleepRule {
  bed: TimeRule;
  wake?: TimeRule;
  /** Used to derive wake when wake is not given: wake = bed + hours. */
  hours?: number;
  /** Optional different times on some days (e.g. weekend). Applies to the night starting that day for `bed`, the morning of that day for `wake`. */
  override?: { days: Day[]; bed?: TimeRule; wake?: TimeRule };
}

export interface FixedCommitment {
  id: string;
  title: string;
  days: Day[];
  start: string; // HH:MM
  end: string; // HH:MM
  category?: Category;
  /** Travel time blocked before and after. */
  travelMin?: number;
  note?: string;
}

export type PrayerMethod =
  | "UmmAlQura"
  | "MuslimWorldLeague"
  | "Egyptian"
  | "Karachi"
  | "Dubai"
  | "Kuwait"
  | "Qatar"
  | "Singapore"
  | "Turkey"
  | "Tehran"
  | "NorthAmerica"
  | "MoonsightingCommittee";

export interface FaithSettings {
  enabled: boolean;
  prayers?: {
    method?: PrayerMethod;
    madhab?: "shafi" | "hanafi";
    /** Minute offsets per prayer, e.g. to match a local app. */
    adjustments?: Partial<Record<PrayerName, number>>;
    /** Block length per prayer (default 20). */
    durations?: Partial<Record<SalahName, number>>;
    /** The block starts this many minutes before the adhan (default 5). */
    preMin?: number;
    /** Replace Friday Dhuhr with Jumu'ah (default true). */
    jumuah?: boolean;
  };
  notes?: string;
}

export interface Profile {
  name?: string;
  about?: string;
  timezone?: string; // IANA, e.g. "Europe/Berlin"
  location?: { city?: string; country?: string; lat?: number; lon?: number };
  weekStart?: Day;
  values?: { name: string; why?: string }[];
  vision?: string;
  goals?: Goal[];
  sleep?: SleepRule;
  fixed?: FixedCommitment[];
  /** True once they confirmed the fixed-commitment list is complete (possibly empty). */
  fixedConfirmed?: boolean;
  constraintsNotes?: string[];
  energy?: {
    chronotype?: "morning" | "evening" | "neither";
    peak?: { start: string; end: string };
    low?: { start: string; end: string };
    focusMaxMin?: number;
    notes?: string;
  };
  capacity?: { weeklyFreeHours?: number; notes?: string };
  habits?: { running?: string[]; wanted?: string[] };
  obstacles?: string[];
  /** Track record: past attempts and what really happened. */
  history?: string[];
  preferences?: string[];
  faith?: FaithSettings;
  ifThen?: IfThen[];
  lessons?: Lesson[];
  updatedAt?: string;
}

export interface IfThen {
  id: string;
  if: string;
  then: string;
  blockId?: string;
  createdAt?: string;
}

export interface Lesson {
  id: string;
  text: string;
  evidence?: string;
  date: string;
}

export type BlockWindow = "peak" | "morning" | "midday" | "afternoon" | "evening" | "any";
/** "wake" | "bed" | a prayer | "block:<id>" | "fixed:<id>" */
export type AnchorRef = string;

export interface BlockSpec {
  id: string;
  title: string;
  category: Category;
  goalId?: string;
  durationMin: number;
  /** Exact days. Otherwise timesPerWeek (default: every day). */
  days?: Day[];
  timesPerWeek?: number;
  window?: BlockWindow;
  earliest?: string;
  latest?: string;
  after?: { ref: AnchorRef; gapMin?: number; maxDelayMin?: number };
  before?: { ref: AnchorRef; gapMin?: number };
  /** Span the whole free gap between after and before (durationMin = minimum). */
  fill?: boolean;
  priority?: 1 | 2 | 3;
  core?: boolean;
  energy?: "high" | "medium" | "low";
  ifThen?: string;
  note?: string;
}

/** The scheduling-relevant parts of the profile, frozen into each adopted plan version. */
export type ProfileSnapshot = Pick<
  Profile,
  "timezone" | "location" | "weekStart" | "sleep" | "fixed" | "energy" | "faith"
>;

export interface Plan {
  version: number;
  createdAt: string;
  adoptedAt?: string;
  approach: string;
  goals: Goal[];
  blocks: BlockSpec[];
  snapshot?: ProfileSnapshot;
  chatId?: string;
}

export type BlockSource = "block" | "fixed" | "prayer" | "sleep";

export interface ScheduledBlock {
  /** Stable per day: "block:deep-thesis", "prayer:fajr", "fixed:lectures", "sleep:night"... */
  key: string;
  start: number; // minutes from 00:00
  end: number;
  title: string;
  category: Category;
  source: BlockSource;
  refId?: string;
  goalId?: string;
  core: boolean;
  tracked: boolean;
  note?: string;
  ifThen?: string;
  /** Sits inside another block (e.g. a prayer break during work); not counted as separate time. */
  overlay?: boolean;
}

export interface DaySchedule {
  date: string; // YYYY-MM-DD
  day: Day;
  wake: number;
  /** Minutes from this day's 00:00; > 1440 when bedtime is after midnight. */
  bed: number;
  prayers?: Partial<Record<PrayerName, number>>;
  blocks: ScheduledBlock[];
  warnings: string[];
  planVersion?: number;
}

export interface Unplaced {
  blockId: string;
  title: string;
  wanted: number;
  placed: number;
  reasons: string[];
}

export interface WeekStats {
  awakeMin: number;
  scheduledMin: number; // planned non-sleep minutes (blocks + fixed + prayers)
  freeMin: number;
  freePct: number;
  byCategory: Partial<Record<Category, number>>;
  byGoal: Record<string, number>;
  freeByDay: Record<string, number>;
}

export interface WeekSchedule {
  start: string;
  days: DaySchedule[];
  unplaced: Unplaced[];
  stats: WeekStats;
  warnings: string[];
}

export type MarkStatus = "done" | "half" | "skip";

export interface Mark {
  status: MarkStatus;
  at: string;
  title: string;
  core: boolean;
  category: Category;
}

/** date -> block key -> mark */
export type Tracking = Record<string, Record<string, Mark>>;
