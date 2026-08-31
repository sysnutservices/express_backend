import OpenAI from "openai";

// Generic OpenAI client plumbing only — no product-specific prompt/logic
// here beyond the one system prompt below, mirrors imagekit.ts owning its
// external service. Text generation only — this is unrelated to the
// removed ai_edit image-editing pipeline (see productImageOrchestrator.ts's
// top comment); it was Claude originally, switched to OpenAI because that's
// the credential actually available (OPENAI_API_KEY, already in .env from
// the old image pipeline) rather than asking for a separate Anthropic key.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  if (!client) client = new OpenAI({ apiKey });
  return client;
}

// Verbatim system prompt, as specified by the store owner (rewritten
// 2026-08-30 — the previous version still read like generic AI marketing
// copy: "Picture this", "harmonious blend of", inferred manufacturer-wide
// claims not actually in the product data, 7+ paragraph listings). Do not
// paraphrase or "improve" this; if the writing style needs to change, the
// store owner supplies the new version.
const SYSTEM_PROMPT = `# LapShark Product Description Generator

You are the product-description writer for LapShark, an e-commerce store selling refurbished and pre-owned laptops. Write the way a real laptop seller writes a listing for one specific unit — not a copywriter, not a blog, not a marketing article.

## Never use these phrases or anything close to them

* "Picture this:"
* "Imagine..."
* "In today's..."
* "harmonious blend of..."
* "esteemed lineup"
* "standout business laptop"
* "versatile choice"
* "unleash"
* "take your productivity to the next level"
* "without sacrificing quality"
* "perfect companion"
* "dependable partner"
* "well-rounded capabilities"
* "excels in environments where..."
* "whether you're..."
* "for students..." / "office professionals will..." as a sentence opener
* generic manufacturer praise ("Dell is known for...", "HP has a reputation for...")
* generic industry statements ("in the fast-evolving laptop industry...")

Do not invent new phrases that carry the same AI-marketing flavor as the ones above. If a sentence sounds like it could be pasted into any laptop's listing unchanged, rewrite it to be specific to this one.

## Only write what's in the product data

Every claim must come from the specifications, condition, and other fields given to you below. Do not infer specs, features, or quality from:

* The brand name
* The product series (e.g. Latitude, ThinkPad, EliteBook)
* Other models
* Manufacturer reputation
* General knowledge about that product family

If a specification is missing, leave it out — do not guess it and do not describe it in general terms instead.

Bad: "Dell Latitude laptops generally offer various ports."
Good: only mention ports if the ports are actually listed in the data.

Bad: "Dell business laptops provide advanced security features."
Good: only mention a security feature if it's listed for this product.

Do not write about what the manufacturer is generally known for. The customer is buying this specific laptop — stick to what it is, what it has, and what that means for them.

## Refurbished / condition wording

Only say "professionally refurbished" if the product data confirms the unit is refurbished/tested. Only say "excellent condition" if the condition field is literally "Excellent". Never say "without sacrificing quality" or similar unless an actual quality guarantee is present in the data. Don't claim "like new", a specific battery health, "no scratches", "genuine Windows", or a warranty duration unless that exact detail is given.

## Structure

Output Markdown in exactly this shape:

1. \`### {Brand} {Model} Refurbished Laptop – {Processor}, {RAM}, {Storage}, {Display}\` — one heading line naming the laptop and its headline specs, using only specs actually given (drop any part of that dash list you don't have data for; don't say "Refurbished" here unless the condition data confirms it).
2. 2-3 short paragraphs (no sub-headings between them): what the laptop is and who it suits, real-world usage it actually supports, and what the specs mean for the buyer.
3. \`### Key Specifications\` heading, then a bullet list, one spec per line, formatted \`* **Label:** value\` — only specs actually provided, not padded out. Every LapShark listing's RAM and storage can be upgraded on request, so always append \` (Upgradable)\` to the RAM and Storage lines specifically (only those two lines) — e.g. \`* **RAM:** 8GB (Upgradable)\`.
4. One short closing paragraph, no heading: a plain, practical reason to buy it. No recap of the whole description.

### Example (format only — write fresh, product-specific content every time, never reuse this wording)

\`\`\`
### Dell Latitude 5410 Refurbished Laptop – Intel Core i5 10th Gen, 8GB RAM, 256GB SSD, 14" Full HD

The Dell Latitude 5410 is a practical business laptop built for everyday work and productivity. With an Intel Core i5 10th Gen processor, 8GB RAM and 256GB storage, it is well suited for office applications, web browsing, email, online classes, accounting software and general day-to-day use.

Its 14-inch Full HD display gives you a good balance between working space and portability. The size is comfortable for documents, spreadsheets, browsing and video calls without making the laptop unnecessarily bulky.

The 8GB RAM is suitable for regular multitasking, while the 256GB storage provides enough space for your essential files, applications and documents.

### Key Specifications

* **Processor:** Intel Core i5 10th Generation
* **RAM:** 8GB (Upgradable)
* **Storage:** 256GB (Upgradable)
* **Display:** 14-inch Full HD
* **Operating System:** Windows 10
* **Condition:** Refurbished

This refurbished Dell Latitude 5410 is a good option for anyone looking for a capable business laptop at a lower price than buying a new device. It works well for everyday productivity, study and professional use.
\`\`\`

## Sentence style

Plain and direct. Say what the spec does for the customer, nothing more.

Prefer: "The 8GB RAM is suitable for regular multitasking."
Not: "With its impressive 8GB RAM configuration, users can experience seamless multitasking capabilities across a wide range of demanding applications."

Prefer: "The 14-inch Full HD display provides a comfortable workspace for documents, browsing and video calls."
Not: "The vibrant display delivers an immersive visual experience that enhances productivity and entertainment."

No fictional scenarios ("Picture this: you start your day...", "Imagine sitting in a coffee shop..."). Describe the product, don't tell a story.

## Length

Target 250-400 words. Stop as soon as everything relevant is covered — if that's 250 words, stop at 250. Do not pad to reach the top of the range.

## Output

Return only the finished description, in the exact Markdown shape above. No preamble ("Here is your description"), no notes, no extra headings.`;

export interface ProductDescriptionInput {
  title: string;
  brand: string;
  category?: string;
  condition?: string;
  specs?: Record<string, string>;
  performanceTier?: string;
  useCases?: string[];
}

// Builds the user-turn content strictly from what the admin actually
// entered — never fills in a spec that's missing, matching the prompt's
// own "do not invent specifications" rule at the data layer too, not just
// by instruction.
export function formatProductData(input: ProductDescriptionInput): string {
  const lines = [`Title: ${input.title}`, `Brand: ${input.brand}`];
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.condition) lines.push(`Condition: ${input.condition}`);
  if (input.performanceTier) lines.push(`Performance tier: ${input.performanceTier}`);
  if (input.useCases?.length) lines.push(`Best for: ${input.useCases.join(", ")}`);

  const specEntries = Object.entries(input.specs || {}).filter(([, v]) => v && String(v).trim());
  if (specEntries.length > 0) {
    lines.push("Specifications:");
    for (const [key, value] of specEntries) lines.push(`- ${key}: ${value}`);
  }
  return lines.join("\n");
}

// gpt-4o: a solid, widely-available choice for natural-sounding copywriting.
// Not pinned to anything newer since none was requested — swap this one
// string if a different/newer OpenAI model is preferred.
const MODEL = "gpt-4o";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The prompt's own explicit banned-phrase list, as regexes rather than
// literal strings — confirmed live that literal substrings are trivially
// dodged by paraphrase: gpt-4o wrote "Whether you're drafting reports..."
// on one run (caught), then "Designed for those who crave..." on the next
// (missed, since only the literal "designed to" was listed). Each pattern
// covers the phrase's near-variants, not just the one exact wording quoted
// in the prompt. "for students"/"office professionals will" are anchored to
// sentence starts, not banned everywhere — a legitimate mid-sentence
// mention ("...suitable for students and freelancers") shouldn't trip it,
// only the AI habit of opening a sentence by addressing an audience segment.
const BANNED_STYLE_PATTERNS: RegExp[] = [
  /\bpicture this\b/i,
  /\bimagine\b/i,
  /\bin today'?s\b/i,
  /\bharmonious blend\b/i,
  /\besteemed\b/i,
  /\bstandout\b/i,
  /\bversatile choice\b/i,
  /\bunleash\b/i,
  /\btake your .{0,40}to the next level\b/i,
  /\bwithout sacrificing\b/i,
  /\bperfect companion\b/i,
  /\bdependable partner\b/i,
  /\bwell-rounded\b/i,
  /\bexcels? in environments where\b/i,
  /\bwhether you'?re\b/i,
  /(^|[.!?]\s+|\n\s*)for students\b/i,
  /(^|[.!?]\s+|\n\s*)office professionals will\b/i,
  /\b(?:known for|renowned for|reputation for|trusted name in)\b/i,
  /\bin the (?:laptop|technology|tech) industry\b/i,
  /\bindustry[- ]leading\b/i,
  // Carried over from the previous prompt's own banned list.
  /\bpowerful performance meets\b/i,
  /\bperfect(?:ly)? (?:for|suited)\b/i,
  /\bdesigned (?:to|for)\b/i,
  /\bideal for\b/i,
  /\breliable performance\b/i,
];

// The prompt's own explicit "Do not claim" list, generalized to regex
// concept-matches rather than exact phrases — confirmed live that "tested
// and verified" (the literal phrase first caught) just resurfaces reworded
// ("thoroughly tested to meet quality standards", "tested to ensure peak
// performance") once that one string is blocked. `confirmedBy` is checked
// against the raw INPUT data — if the admin actually supplied something in
// that same concept area (mentions "test", "battery", "scratch", etc.),
// the claim is allowed through; otherwise it's a fabrication the prompt's
// own "claims that cannot be confirmed from the specifications" rule bans.
interface ClaimRule {
  label: string;
  pattern: RegExp;
  confirmedBy: RegExp;
}
const UNCONFIRMED_CLAIM_RULES: ClaimRule[] = [
  // \w* stems (verif\w*, inspect\w*) rather than an enumerated suffix list —
  // confirmed live that a bare "verify" (not "verified") slipped through
  // enumerated suffixes, in a sentence about "tests and inspections" that
  // "inspect" itself wasn't even covering.
  { label: "testing/verification claim", pattern: /\btested\b|\bverif\w*\b|\binspect\w*\b|\bquality[- ]?(?:checked|assured|standards?)\b/i, confirmedBy: /\btest(?:ed|ing)?\b|\bverif\w*\b|\binspect\w*\b|\bquality[- ]?(?:check|assur|standard)/i },
  { label: '"like new" claim', pattern: /\blike new\b/i, confirmedBy: /\blike new\b/i },
  { label: "battery condition claim", pattern: /\b(?:excellent|original|100%|brand new) battery\b|\bbattery health\b/i, confirmedBy: /\bbattery\b/i },
  { label: "cosmetic condition claim", pattern: /\bno scratches\b|\bscratch-?free\b/i, confirmedBy: /\bscratch/i },
  { label: "genuine Windows claim", pattern: /\bgenuine windows\b/i, confirmedBy: /\bgenuine\b|\bwindows\b/i },
  { label: "warranty duration claim", pattern: /\b\d+[\s-]*years?\s+warranty\b/i, confirmedBy: /\bwarrant(?:y|ies)\b/i },
  // "Professionally refurbished" is true of every LapShark listing (it's the
  // whole business), but only once a condition grade was actually supplied —
  // otherwise there's nothing in this specific product's data to hang the
  // claim on.
  { label: '"professionally refurbished" claim', pattern: /\bprofessionally refurbished\b/i, confirmedBy: /\brefurb\w*\b|\bcondition\b/i },
];

function inputHaystack(input: ProductDescriptionInput): string {
  return [input.title, input.brand, input.category, input.condition, input.performanceTier, ...(input.useCases || []), ...Object.values(input.specs || {})]
    .filter(Boolean)
    .join(" ");
}

// The prompt's own target: 250-400 words for a real listing, not a
// generic-article length. Floor set well below that on purpose — the word
// count here is of the whole Markdown output (heading + bullets included),
// and the store owner's own reference example, all five specs used, comes
// out to ~185 words that way; a product with fewer known specs will land
// even lower. "Shorter than filler" is correct per the prompt's own rule,
// so the floor exists only to catch a genuinely thin one-liner, not to
// force padding up toward 250.
const MIN_WORDS = 150;
const MAX_WORDS = 430;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Pure, independently testable — the actual enforcement logic, not just a
// hope. Returns a human-readable violation per hit, or an empty array when
// the draft is clean.
export function findViolations(text: string, input: ProductDescriptionInput): string[] {
  const violations: string[] = [];
  for (const pattern of BANNED_STYLE_PATTERNS) {
    if (pattern.test(text)) violations.push(`banned phrase matching ${pattern}`);
  }

  const haystack = inputHaystack(input);
  for (const rule of UNCONFIRMED_CLAIM_RULES) {
    if (rule.pattern.test(text) && !rule.confirmedBy.test(haystack)) {
      violations.push(`unconfirmed ${rule.label} (not present in the supplied product data)`);
    }
  }

  // "Excellent condition" is only true when the condition field is
  // literally "Excellent" — checked against the field itself, not just
  // presence of the word anywhere in the input (a spec value could contain
  // "excellent" for an unrelated reason).
  if (/\bexcellent condition\b/i.test(text) && (input.condition || "").trim().toLowerCase() !== "excellent") {
    violations.push('unconfirmed "excellent condition" claim (condition grade is not Excellent)');
  }

  // Generic manufacturer-wide claim: "<Brand> laptops generally/typically
  // offer/provide/are known..." — the exact pattern the prompt's own BAD
  // examples call out, built against this product's actual brand rather
  // than a fixed brand list.
  if (input.brand) {
    const brandClaim = new RegExp(`\\b${escapeRegex(input.brand)}\\b[^.]{0,80}\\b(?:generally|typically|usually|often|known for|renowned)\\b`, "i");
    if (brandClaim.test(text)) violations.push(`generic manufacturer-wide claim about ${input.brand} not tied to this product's own data`);
  }

  // Structure check: when spec data was actually supplied, the required
  // "Key Specifications" bullet section has to show up somewhere.
  const hasSpecs = Object.values(input.specs || {}).some((v) => v && String(v).trim());
  if (hasSpecs && !/key specifications/i.test(text)) {
    violations.push('missing the required "Key Specifications" section');
  }
  // The opening "### Title – headline specs" heading is the other required
  // structural element — checked as "starts with a markdown heading" rather
  // than matching the exact title text, since the model rewords the dash
  // summary per product.
  if (!/^\s*###\s+\S/.test(text)) {
    violations.push('missing the required "### Title" opening heading');
  }

  // Every listing's RAM/storage is upgradable — the prompt's example shows
  // this, but (like every other style rule here) that's a hope, not a
  // guarantee, so it's enforced the same deterministic way. Only checked
  // when the model actually wrote that bullet line (it's omitted entirely
  // when the admin didn't supply that spec).
  if (/\*\*ram:\*\*/i.test(text) && !/\*\*ram:\*\*[^\n]*upgradable/i.test(text)) {
    violations.push('RAM spec line missing the required "(Upgradable)" tag');
  }
  if (/\*\*storage:\*\*/i.test(text) && !/\*\*storage:\*\*[^\n]*upgradable/i.test(text)) {
    violations.push('Storage spec line missing the required "(Upgradable)" tag');
  }

  const words = wordCount(text);
  if (words < MIN_WORDS) violations.push(`too short: ${words} words (target 250-400)`);
  if (words > MAX_WORDS) violations.push(`too long: ${words} words (target 250-400)`);
  return violations;
}

async function requestDescription(openai: OpenAI, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 1200,
    temperature: 0.8,
    messages,
  });
  const text = response.choices[0]?.message?.content;
  if (!text || !text.trim()) {
    throw new Error("Description generator returned no text");
  }
  return text.trim();
}

// 1 initial attempt + up to 2 corrective retries. One retry wasn't always
// enough — live-tested and confirmed a banned phrase ("designed to") can
// still survive a single correction. Each retry stays in the same
// conversation, naming exactly what's still wrong, rather than starting
// cold each time.
const MAX_ATTEMPTS = 3;

// The one entry point — builds the strict, only-what-was-given product
// data block, sends it against the store owner's system prompt, and
// returns the finished description text. If a draft violates the prompt's
// own explicit rules, corrects it inside the same conversation — a real,
// deterministic backstop, not just a longer system prompt hoping the model
// complies. If violations survive every attempt, the last draft is
// returned anyway (the admin still reviews before Save) but logged, so a
// persistently-failing case is visible instead of silent.
export async function generateProductDescription(input: ProductDescriptionInput): Promise<string> {
  if (!input.title || !input.brand) {
    throw new Error("title and brand are required to generate a description");
  }
  const openai = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Write the product description for this laptop, using only the details given below — do not invent or assume any specification, condition detail, or claim that isn't listed, and do not infer anything from the brand or product line in general. Use the exact shape from the system prompt: a "### Title – headline specs" heading, 2-3 short paragraphs, a "### Key Specifications" bullet section, then one short closing paragraph. Target 250-400 words total — stop as soon as it's covered, do not pad toward 400.\n\n${formatProductData(input)}`,
    },
  ];

  let text = "";
  let violations: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    text = await requestDescription(openai, messages);
    violations = findViolations(text, input);
    if (violations.length === 0) break;
    if (attempt < MAX_ATTEMPTS) {
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `Rewrite this description. It breaks the style rules: ${violations.join("; ")}. Remove these specific problems — do not use those exact banned phrases anywhere, do not restate or imply a claim unless it was actually in the original product data, and do not generalize about what the brand is known for. Return only the corrected description, nothing else.`,
      });
    }
  }

  if (violations.length > 0) {
    console.warn(`descriptionGenerator: violations survived all ${MAX_ATTEMPTS} attempts for "${input.title}": ${violations.join("; ")}`);
  }

  return text;
}
