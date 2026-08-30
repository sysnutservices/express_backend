// Runnable self-check for descriptionGenerator.ts's pure logic — data
// formatting and the violation-detection backstop — no network call,
// matching the codebase's no-framework selftest convention. The actual
// OpenAI call isn't exercised here (needs a real OPENAI_API_KEY and costs
// money), same reason imageProcessing.selftest.ts doesn't call the real
// PhotoRoom API.
// Run: npx ts-node src/services/descriptionGenerator.selftest.ts (or `npm test`)
import assert from "assert";
import { formatProductData, findViolations } from "./descriptionGenerator";

function main() {
  // 1. Only fields actually provided appear — this is the data-layer half
  //    of "do not invent specifications" (the other half is the prompt
  //    instruction itself); a missing field must never surface as an
  //    empty/placeholder line the model could mistake for real data.
  const minimal = formatProductData({ title: "Dell Latitude 5400", brand: "Dell" });
  assert.ok(minimal.includes("Title: Dell Latitude 5400"));
  assert.ok(minimal.includes("Brand: Dell"));
  assert.ok(!minimal.includes("Category:"));
  assert.ok(!minimal.includes("Condition:"));
  assert.ok(!minimal.includes("Specifications:"));

  // 2. A spec object with some blank values only lists the non-blank ones —
  //    an empty string in a form field must not become a fabricated "RAM: "
  //    line.
  const withSpecs = formatProductData({
    title: "Lenovo ThinkPad T480",
    brand: "Lenovo",
    category: "Business Laptops",
    condition: "Refurbished",
    specs: { processor: "Intel Core i5 8th Gen", ram: "", storage: "256GB SSD", display: "", graphics: "" },
    performanceTier: "balanced",
    useCases: ["Office work", "Student"],
  });
  assert.ok(withSpecs.includes("Category: Business Laptops"));
  assert.ok(withSpecs.includes("Condition: Refurbished"));
  assert.ok(withSpecs.includes("Performance tier: balanced"));
  assert.ok(withSpecs.includes("Best for: Office work, Student"));
  assert.ok(withSpecs.includes("Specifications:"));
  assert.ok(withSpecs.includes("- processor: Intel Core i5 8th Gen"));
  assert.ok(withSpecs.includes("- storage: 256GB SSD"));
  assert.ok(!withSpecs.includes("- ram:"), "a blank spec value must not appear at all");
  assert.ok(!withSpecs.includes("- display:"));
  assert.ok(!withSpecs.includes("- graphics:"));

  // 3. findViolations: regression test on the exact failures three live
  //    runs caught, across two rounds — literal-phrase matching kept
  //    getting dodged by paraphrase, which is why these are regex concept
  //    matches now, not exact strings.
  const latitudeInput = { title: "Dell Latitude 5420", brand: "Dell", condition: "Refurbished" };

  // Round 1: the exact wording quoted in the prompt itself.
  const round1Draft =
    "Whether you're drafting reports or attending meetings, this laptop offers a balanced performance " +
    "perfect for handling your daily office tasks. As this Dell Latitude model is refurbished, it has " +
    "been thoroughly tested and verified to meet quality standards.";
  const round1 = findViolations(round1Draft, latitudeInput);
  assert.ok(round1.some((v) => /whether you/i.test(v)), "must catch \"whether you're\"");
  assert.ok(round1.some((v) => /perfect/i.test(v)), "must catch \"perfect for\"");
  assert.ok(round1.some((v) => /testing\/verification/i.test(v)), "must catch the unconfirmed testing claim");

  // Round 2: the model paraphrased around every literal string that round 1
  // would have blocked — a real live result, not a hypothetical.
  const round2Draft =
    "Designed for those who crave both entertainment and productivity, this laptop delivers reliably. " +
    "This refurbished unit has been thoroughly tested to meet quality standards, and in excellent " +
    "condition it has also been tested to ensure peak performance.";
  const round2 = findViolations(round2Draft, latitudeInput);
  assert.ok(round2.some((v) => /designed/i.test(v)), "must catch \"Designed for\" (not just \"designed to\")");
  assert.ok(round2.some((v) => /testing\/verification/i.test(v)), "must catch the reworded testing claims");

  // 4. A clean draft with no banned phrases and no unconfirmed claims must
  //    report zero violations on those two checks — the check isn't just
  //    permanently triggered. (Deliberately short, so filtered to just the
  //    style/claim checks here — length is its own concern, tested in 7.)
  const cleanDraft =
    "The Dell Latitude 5420 is a dependable business laptop. It handles office work, video calls and " +
    "everyday tasks without any fuss. This unit is refurbished.";
  assert.deepStrictEqual(
    findViolations(cleanDraft, latitudeInput).filter((v) => !/too short|too long|missing the required/i.test(v)),
    []
  );

  // 5. A claim that IS actually backed by the input data is not a
  //    violation — e.g. an admin who genuinely entered a warranty/battery/
  //    testing spec must be allowed to have that claim appear.
  const warrantyInput = { title: "HP ProBook", brand: "HP", specs: { warranty: "1 Year Warranty" } };
  const draftWithRealWarranty = "This HP ProBook comes with a 1 year warranty for peace of mind.";
  assert.deepStrictEqual(
    findViolations(draftWithRealWarranty, warrantyInput).filter((v) => !/too short|too long|missing the required/i.test(v)),
    []
  );

  const testedInput = { title: "Acer Aspire 5", brand: "Acer", condition: "Refurbished and tested" };
  const draftWithRealTestingClaim = "This Acer Aspire 5 has been tested and works reliably.";
  assert.deepStrictEqual(
    findViolations(draftWithRealTestingClaim, testedInput).filter((v) => !/too short|too long|missing the required/i.test(v)),
    []
  );

  // 6. "ideal for" / "reliable performance" — the Variation Engine section's
  //    own named phrases, missed on the first pass and confirmed live in
  //    real generated output (an HP listing used "Ideal for those who...",
  //    a ThinkPad listing used "...need reliable performance...").
  const genericInput = { title: "Generic Laptop", brand: "Generic" };
  assert.ok(
    findViolations("Ideal for students and professionals alike.", genericInput).some((v) => /ideal for/i.test(v))
  );
  assert.ok(
    findViolations("This machine offers reliable performance every day.", genericInput).some((v) => /reliable performance/i.test(v))
  );

  // 7b. "verify"/"inspect" bare-verb gap — confirmed live: a ThinkPad E14 run
  //     produced "undergo a series of rigorous tests and inspections to
  //     verify their functionality" and findViolations reported NONE,
  //     because the old pattern only matched "verified"/"verification".
  const verifyDraft =
    "This refurbished laptop has undergone a series of rigorous tests and inspections to verify their functionality.";
  assert.ok(
    findViolations(verifyDraft, latitudeInput).some((v) => /testing\/verification/i.test(v)),
    "must catch bare \"verify\"/\"inspections\", not just \"verified\""
  );

  // 7. Word count — target dropped from 400-650 to 250-400 (2026-08-30
  //    rewrite: the old length made every listing read like a generic
  //    article). Checked with slack, same reasoning as before: gpt-4o
  //    doesn't reliably hit a target word count without this being enforced,
  //    not just stated in the prompt.
  const shortDraft = "This is a short laptop description that is nowhere near the required word count target.";
  const shortViolations = findViolations(shortDraft, genericInput);
  assert.ok(shortViolations.some((v) => /too short/i.test(v)), "a short draft must be flagged");

  const longDraft = Array(730).fill("word").join(" ");
  const longViolations = findViolations(longDraft, genericInput);
  assert.ok(longViolations.some((v) => /too long/i.test(v)), "an overly long draft must be flagged");

  const rightLengthDraft = Array(300).fill("word").join(" ");
  const rightLengthViolations = findViolations(rightLengthDraft, genericInput);
  assert.ok(!rightLengthViolations.some((v) => /too short|too long/i.test(v)), "a draft within 150-430 words must not be flagged for length");

  // 8. Structure — the store owner's exact target format: "### Title –
  //    specs" heading, then prose, then a "### Key Specifications" bullet
  //    section. A draft missing either piece must be flagged; the store
  //    owner's own example (adapted: dropped one sentence that itself broke
  //    the "don't infer from the product series" rule) must pass clean.
  const structuredInput = {
    title: "Dell Latitude 5410",
    brand: "Dell",
    condition: "Refurbished",
    specs: {
      processor: "Intel Core i5 10th Generation",
      ram: "8GB",
      storage: "256GB",
      display: "14-inch Full HD",
      os: "Windows 10",
    },
  };
  const wellFormedExample = `### Dell Latitude 5410 Refurbished Laptop – Intel Core i5 10th Gen, 8GB RAM, 256GB SSD, 14" Full HD

The Dell Latitude 5410 is a practical business laptop built for everyday work and productivity. With an Intel Core i5 10th Gen processor, 8GB RAM and 256GB storage, it is well suited for office applications, web browsing, email, online classes, accounting software and general day-to-day use.

Its 14-inch Full HD display gives you a good balance between working space and portability. The size is comfortable for documents, spreadsheets, browsing and video calls without making the laptop unnecessarily bulky.

The 8GB RAM is suitable for regular multitasking, while the 256GB storage provides enough space for your essential files, applications and documents.

### Key Specifications

* **Processor:** Intel Core i5 10th Generation
* **RAM:** 8GB
* **Storage:** 256GB
* **Display:** 14-inch Full HD
* **Operating System:** Windows 10
* **Condition:** Refurbished

This refurbished Dell Latitude 5410 is a good option for anyone looking for a capable business laptop at a lower price than buying a new device. It works well for everyday productivity, study and professional use.`;
  assert.deepStrictEqual(findViolations(wellFormedExample, structuredInput), [], "the store owner's target format must pass with zero violations");

  const missingHeading = wellFormedExample.replace(/^###[^\n]*\n\n/, "");
  assert.ok(
    findViolations(missingHeading, structuredInput).some((v) => /missing the required "### Title"/i.test(v)),
    "a draft missing the opening ### heading must be flagged"
  );

  const missingKeySpecs = wellFormedExample.replace(/### Key Specifications[\s\S]*?\n\n/, "");
  assert.ok(
    findViolations(missingKeySpecs, structuredInput).some((v) => /missing the required "Key Specifications"/i.test(v)),
    "a draft missing the Key Specifications section must be flagged when specs were supplied"
  );

  console.log("descriptionGenerator.selftest: all assertions passed");
}

main();
