export type ContextMode = 'compact' | 'standard' | 'full';

export interface Profile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsVision: boolean;
  contextMode: ContextMode;
  contextWindow: number;
  maxScreenshots: number;
}

export interface Settings {
  activeProfileId: string | null;
  stepLimit: number;
  riskyKeywords: string[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One element in a page snapshot. `rect` is in top-level viewport CSS pixels. */
export interface ElementInfo {
  id: number;
  tag: string;
  role: string;
  name: string;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  href?: string;
  autocomplete?: string;
  fieldName?: string;
  options?: string[];
  inForm: boolean;
  isSubmit: boolean;
  download: boolean;
  context?: string;
  /** For radios/checkboxes: the question or group they belong to (fieldset legend or group label). */
  group?: string;
  rect: Rect;
}

export interface PageSnapshot {
  url: string;
  title: string;
  restricted: boolean;
  elements: ElementInfo[];
  headings: string[];
  scrollY: number;
  scrollMaxY: number;
  viewport: { w: number; h: number };
}

export interface TabInfo {
  index: number;
  tabId: number;
  title: string;
  url: string;
  active: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the model's call could not be parsed. */
  error?: string;
}

export interface Attachment {
  name: string;
  kind: 'image' | 'text';
  dataUrl?: string;
  text?: string;
}

/** What the model saw before a step. `detail` is rendered at capture time for the profile's mode. */
export interface ObservationRecord {
  url: string;
  title: string;
  summary: string;
  detail: string;
  tabs: string;
  screenshot?: string;
}

export type Turn =
  | { kind: 'user'; text: string; attachments: Attachment[] }
  | {
      kind: 'step';
      id: string;
      label: string;
      reasoning: string;
      call: ToolCall;
      result: string;
      risky: boolean;
      observation?: ObservationRecord;
    }
  | { kind: 'assistant'; text: string };

export type StepTurn = Extract<Turn, { kind: 'step' }>;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  profileId: string;
  turns: Turn[];
}

export interface ConversationMeta {
  id: string;
  title: string;
  updatedAt: number;
}

/** Where an action will land, resolved before policy checks. */
export interface ActionTarget {
  tabId: number;
  origin: string;
  element?: ElementInfo;
  point?: { x: number; y: number };
}

export interface Observation {
  snapshot: PageSnapshot;
  tabs: TabInfo[];
  screenshot?: string;
}
