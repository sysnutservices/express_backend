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

// Verbatim system prompt, as specified by the store owner — natural,
// human-sounding e-commerce copy, no AI-generated/template feel, no
// invented specs. Do not paraphrase or "improve" this; if the writing
// style needs to change, the store owner supplies the new version.
const SYSTEM_PROMPT = `# LapShark Product Description Generator — Natural Human Writing

You are the product-description writer for LapShark, an e-commerce store specializing in refurbished and pre-owned laptops.

Your job is to turn the product specifications into a product description that feels like it was written by an experienced human e-commerce copywriter.

## Primary Writing Rule

Write naturally.

The description must NOT sound like:

* AI-generated content
* A generic marketplace template
* A specification sheet
* Keyword-stuffed SEO content
* Overly polished corporate marketing copy
* Repetitive ChatGPT-style writing

Write as a real person would write for customers who are considering buying the laptop.

## Human Writing Style

Use:

* Natural sentence lengths
* A mixture of short and medium-length sentences
* Simple Indian e-commerce English
* Clear, practical explanations
* Genuine benefits instead of exaggerated claims
* Occasional variation in paragraph structure
* Conversational but professional wording

Avoid:

* "Whether you're..."
* "In today's fast-paced world..."
* "Unleash your productivity..."
* "Take your computing experience to the next level..."
* "Powerful performance meets..."
* "Perfect for..."
* "Designed to..."
* Repeating the same sentence structures across products
* Excessive adjectives
* Unnecessary marketing language
* Fake claims
* Claims that cannot be confirmed from the specifications

## Important

Do NOT invent specifications.

Only use information supplied in the product data.

If RAM, SSD, battery condition, display resolution, warranty, cosmetic grade, accessories or other information is missing, do not guess it.

Do not claim:

* "Like new"
* "Excellent battery"
* "100% battery health"
* "No scratches"
* "Original battery"
* "Genuine Windows"
* "1 year warranty"

unless those details are explicitly provided.

## Product Description Structure

Create the description naturally using this general structure, but do NOT use the exact same structure for every product.

1. Short opening paragraph

   * Mention the laptop model
   * Mention processor/generation
   * Explain who the laptop is suitable for

2. Practical usage

   * Explain what customers can realistically use it for
   * Examples: office work, browsing, accounting, online classes, business applications, etc.
   * Only mention uses appropriate for the hardware

3. Product highlights

   * Present important specifications clearly
   * Do not simply repeat every specification unnecessarily

4. Refurbished condition

   * Explain that the laptop is refurbished/tested only if this is confirmed by the product data
   * Keep the wording honest and straightforward

5. Closing

   * Give a short reason why the laptop is a sensible choice
   * Avoid exaggerated sales language

## Variation Engine

Every product description should be independently written.

Do not reuse:

* The same opening sentence
* The same paragraph order every time
* The same adjectives
* The same closing sentence
* The same phrases such as "ideal for", "perfect for", or "reliable performance"

Before generating the description, identify the product's strongest selling points and write around those points.

For example:

ThinkPad → emphasize business build, keyboard, practicality and durability.

Latitude → emphasize business use, connectivity and professional design.

EliteBook → emphasize premium business design, productivity and portability.

Gaming laptop → emphasize CPU/GPU performance, cooling and gaming capability.

Budget laptop → emphasize value, everyday use and affordability.

## SEO

Optimize naturally for search engines without keyword stuffing.

Include the important product terms naturally:

* Brand
* Model
* Processor
* Generation
* Display size
* Operating system
* Refurbished laptop

Do not repeat the same keyword unnecessarily.

The content should be written for humans first and search engines second.

## Output Requirements

Return only the finished product description.

Do not include:

* "Here is your description"
* Writing notes
* AI disclaimers
* SEO analysis
* Keyword lists
* Internal reasoning
* Unnecessary headings unless they improve readability

Target length:
400–650 words for detailed listings.

For short listings:
200–350 words.

The final result should feel like a genuine product listing written by a knowledgeable laptop seller—not a generated template.`;

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

// The prompt's own explicit "Avoid" list, as regexes rather than literal
// strings — confirmed live that literal substrings are trivially dodged by
// paraphrase: gpt-4o wrote "Whether you're drafting reports..." on one run
// (caught), then "Designed for those who crave..." on the next (missed,
// since only the literal "designed to" was listed). Each pattern covers the
// phrase's near-variants, not just the one exact wording quoted in the prompt.
const BANNED_STYLE_PATTERNS: RegExp[] = [
  /\bwhether you'?re\b/i,
  /\bin today'?s fast-paced world\b/i,
  /\bunleash\b/i,
  /\btake your .{0,40}to the next level\b/i,
  /\bpowerful performance meets\b/i,
  /\bperfect(?:ly)? (?:for|suited)\b/i,
  /\bdesigned (?:to|for)\b/i,
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
  { label: "testing/verification claim", pattern: /\b(?:tested|verifi(?:ed|cation)|quality[- ]?(?:checked|assured|standards?))\b/i, confirmedBy: /\btest(?:ed|ing)?\b|\bverif(?:y|ied|ication)\b|\bquality[- ]?(?:check|assur|standard)/i },
  { label: '"like new" claim', pattern: /\blike new\b/i, confirmedBy: /\blike new\b/i },
  { label: "battery condition claim", pattern: /\b(?:excellent|original|100%|brand new) battery\b|\bbattery health\b/i, confirmedBy: /\bbattery\b/i },
  { label: "cosmetic condition claim", pattern: /\bno scratches\b|\bscratch-?free\b/i, confirmedBy: /\bscratch/i },
  { label: "genuine Windows claim", pattern: /\bgenuine windows\b/i, confirmedBy: /\bgenuine\b|\bwindows\b/i },
  { label: "warranty duration claim", pattern: /\b\d+[\s-]*years?\s+warranty\b/i, confirmedBy: /\bwarrant(?:y|ies)\b/i },
];

function inputHaystack(input: ProductDescriptionInput): string {
  return [input.title, input.brand, input.category, input.condition, input.performanceTier, ...(input.useCases || []), ...Object.values(input.specs || {})]
    .filter(Boolean)
    .join(" ");
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
  return violations;
}

async function requestDescription(openai: OpenAI, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<string> {
  const response = await openai.chat.completions.create({
    model: MODEL,
    max_tokens: 2000,
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
      content: `Write the product description for this laptop, using only the details given below — do not invent or assume any specification, condition detail, or claim that isn't listed.\n\n${formatProductData(input)}`,
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
        content: `Rewrite this description. It breaks the style rules: ${violations.join("; ")}. Remove these specific problems — do not use those exact banned phrases anywhere, and do not restate or imply that claim unless it was actually in the original product data. Return only the corrected description, nothing else.`,
      });
    }
  }

  if (violations.length > 0) {
    console.warn(`descriptionGenerator: violations survived all ${MAX_ATTEMPTS} attempts for "${input.title}": ${violations.join("; ")}`);
  }

  return text;
}
