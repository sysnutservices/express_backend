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
  //    report zero violations — the check isn't just permanently triggered.
  const cleanDraft =
    "The Dell Latitude 5420 is a dependable business laptop. It handles office work, video calls and " +
    "everyday tasks without any fuss. This unit is refurbished.";
  assert.deepStrictEqual(findViolations(cleanDraft, latitudeInput), []);

  // 5. A claim that IS actually backed by the input data is not a
  //    violation — e.g. an admin who genuinely entered a warranty/battery/
  //    testing spec must be allowed to have that claim appear.
  const warrantyInput = { title: "HP ProBook", brand: "HP", specs: { warranty: "1 Year Warranty" } };
  const draftWithRealWarranty = "This HP ProBook comes with a 1 year warranty for peace of mind.";
  assert.deepStrictEqual(findViolations(draftWithRealWarranty, warrantyInput), []);

  const testedInput = { title: "Acer Aspire 5", brand: "Acer", condition: "Refurbished and tested" };
  const draftWithRealTestingClaim = "This Acer Aspire 5 has been tested and works reliably.";
  assert.deepStrictEqual(findViolations(draftWithRealTestingClaim, testedInput), []);

  console.log("descriptionGenerator.selftest: all assertions passed");
}

main();
