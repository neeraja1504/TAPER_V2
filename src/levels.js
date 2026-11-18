/* Translation levels, the weekly plan, and which sentences switch to English.
 *
 * A level is { termMode, share }:
 *   termMode  "native"  technical terms translated
 *             "gloss"   translated, English in brackets
 *             "english" technical terms kept in English (always the first step toward English)
 *   share     0–100: percentage of sentences shown in the original English
 *
 * Every level is assembled locally from ONE translation of the paper, so changing level
 * never costs LLM credits. Sentences switch to English shortest-first, and the set only
 * grows as the share grows: a sentence that is English at 30% is still English at 60%.
 */

export const TERM_MODES = {
  native: "Technical terms translated",
  gloss: "Translated, English term in brackets",
  english: "Technical terms in English"
};
export const TERM_ORDER = ["native", "gloss", "english"];

export const LEVELS = [
  { name: "All native: everything translated",       termMode: "native",  share: 0 },
  { name: "Native, English terms in brackets",       termMode: "gloss",   share: 0 },
  { name: "Native text, technical terms in English", termMode: "english", share: 0 },
  { name: "Mixed: 25% of sentences in English",      termMode: "english", share: 25 },
  { name: "Mixed: 50% of sentences in English",      termMode: "english", share: 50 },
  { name: "Mixed: 75% of sentences in English",      termMode: "english", share: 75 },
  { name: "All English",                             termMode: "english", share: 100 }
];

export const levelKey = l => `${l.termMode}-${l.share}`;
export function levelName(l) {
  const preset = LEVELS.find(p => p.termMode === l.termMode && p.share === l.share);
  if (preset) return preset.name;
  return `${TERM_MODES[l.termMode] || l.termMode}, ${l.share}% of sentences in English`;
}
export function clampLevel(l) {
  const termMode = TERM_ORDER.includes(l?.termMode) ? l.termMode : "english";
  let share = Math.round(Number(l?.share) / 5) * 5;
  if (!Number.isFinite(share)) share = 0;
  share = Math.max(0, Math.min(100, share));
  return { termMode, share };
}

/* Default plan: week 1 keeps technical terms in English, then the English share grows
   evenly to 100% in the last week. */
export function defaultPlan(weeks = 12) {
  weeks = Math.max(1, Math.min(52, Math.round(weeks)));
  return Array.from({ length: weeks }, (_, i) => {
    const share = weeks === 1 ? 100 : Math.round((100 * i / (weeks - 1)) / 5) * 5;
    return { week: i + 1, termMode: "english", share, focus: i === 0 ? "Learn the English technical terms" : share >= 100 ? "Read the whole paper in English" : "" };
  });
}

/* Cleans an AI- or user-provided plan: one row per week, levels clamped. With monotone=true the
   plan never steps back toward the native language (used for AI drafts). */
export function normalizePlan(plan, weeks, monotone = false) {
  const base = defaultPlan(weeks);
  const byWeek = new Map((Array.isArray(plan) ? plan : []).map(r => [Number(r.week), r]));
  let prev = { termMode: "native", share: 0 };
  return base.map(row => {
    const src = byWeek.get(row.week);
    let l = src ? clampLevel(src) : { termMode: row.termMode, share: row.share };
    if (monotone) {
      if (TERM_ORDER.indexOf(l.termMode) < TERM_ORDER.indexOf(prev.termMode)) l.termMode = prev.termMode;
      if (l.share < prev.share) l.share = prev.share;
      if (l.share > 0) l.termMode = "english";
    }
    prev = l;
    return { week: row.week, ...l, focus: String(src?.focus ?? row.focus ?? "").slice(0, 200) };
  });
}

export function currentWeek(profile, now = Date.now()) {
  const weeks = profile?.weeks || 12;
  if (profile?.weekOverride) return Math.max(1, Math.min(weeks, profile.weekOverride));
  const start = profile?.startDate ? Date.parse(profile.startDate) : NaN;
  if (!Number.isFinite(start)) return 1;
  const w = Math.floor((now - start) / (7 * 864e5)) + 1;
  return Math.max(1, Math.min(weeks, w));
}

export function planLevel(profile, week = currentWeek(profile)) {
  const plan = normalizePlan(profile?.plan, profile?.weeks || 12);
  const row = plan[Math.max(0, Math.min(plan.length - 1, week - 1))];
  return { termMode: row.termMode, share: row.share };
}

/* Sentence ids shown in English for this share. Shortest sentences go first, so early
   English is the easiest English. Ties keep document order. */
export function englishSet(sents, share) {
  const order = sents.map((s, i) => ({ id: s.id, i, w: s.en.length }))
    .sort((a, b) => a.w - b.w || a.i - b.i);
  const n = Math.round(sents.length * Math.max(0, Math.min(100, share)) / 100);
  return new Set(order.slice(0, n).map(o => o.id));
}
