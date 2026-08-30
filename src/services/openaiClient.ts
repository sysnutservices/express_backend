import OpenAI, { toFile } from "openai";

// Generic OpenAI plumbing only — no product-specific prompts here. Prompt
// content and image-type logic live in services/productImage/, which is the
// only caller of editImage(). Mirrors imagekit.ts owning ImageKit.

let client: OpenAI | null = null;
let clientKey: string | null = null;
function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  // Rebuilds when the key changes at runtime (the admin "Set API Key" UI
  // updates process.env directly, without a process restart) rather than
  // only checking `!client` once.
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

// Cheap validity check for the "Test Connection" admin UI — retrieves the
// model, which costs nothing, instead of running a real (billed) image edit.
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, message: "OPENAI_API_KEY is not set." };
  }
  try {
    await getClient().models.retrieve("gpt-image-2");
    return { success: true, message: "Connected — gpt-image-2 is available for this API key." };
  } catch (err) {
    const classified = classifyOpenAIError(err);
    if (classified.status === 401) return { success: false, message: "Invalid API key." };
    if (classified.status === 404) {
      return { success: false, message: "Key looks valid, but gpt-image-2 isn't accessible for this account (Organization Verification may be required)." };
    }
    return { success: false, message: "Could not reach OpenAI. Please check the key and try again." };
  }
}

export interface OpenAIEditResult {
  buffer: Buffer;
  mimeType: string;
  usage: Record<string, unknown> | null;
}

// One edit call — the ONE OpenAI operation per processing attempt. The
// original photo goes to OpenAI at full resolution, unresized/uncropped;
// `size` is the requested OUTPUT canvas (see
// productImage/productImageEditor.ts — currently always "1024x1024").
//
// No mask. v1.2 briefly added a hard OpenAI edit mask (opaque = preserve,
// transparent = editable) for product-pixel safety, but that blocked the
// beautification this pipeline exists to do (brightness/glare/dust
// cleanup can't touch "preserved" pixels), and was confirmed live to not
// even reliably hold gpt-image-2 to it anyway. Product identity now rides
// on the prompt alone, same as v1.1 and earlier — see the v2.0 comment in
// productImagePrompts.ts for the full reasoning, and productImageEditor.ts
// for what actually protects identity now (manual review before publish,
// not a runtime pixel check).
export async function editImage(originalBuffer: Buffer, mimeType: string, prompt: string, size: string): Promise<OpenAIEditResult> {
  const openai = getClient();
  const file = await toFile(originalBuffer, "source", { type: mimeType });

  const response = await openai.images.edit({
    model: "gpt-image-2",
    image: file,
    prompt,
    size: size as any,
    quality: "high",
    // input_fidelity is documented in the SDK's types as supported for
    // "gpt-image-1.5 and later", but the live API rejects it for
    // gpt-image-2 specifically (400: "does not support the 'input_fidelity'
    // parameter") — confirmed by an actual call, not the docs.
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");

  return {
    buffer: Buffer.from(b64, "base64"),
    mimeType: "image/png",
    // Stored as opaque JSON rather than mapped to named fields — the exact
    // usage shape isn't a stable contract; imageCostControl.estimateCost
    // reads out of it defensively.
    usage: (response.usage as unknown as Record<string, unknown>) ?? null,
  };
}

export interface ClassifiedOpenAIError {
  transient: boolean;
  status?: number;
  message: string;
}

// Retry looping lives in productImageOrchestrator (each attempt needs its
// own usage row), not here — this only classifies.
export function classifyOpenAIError(err: unknown): ClassifiedOpenAIError {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
  const isNetworkOrTimeout =
    status === undefined &&
    /timeout|network|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message);
  return {
    transient: (status !== undefined && transientStatuses.has(status)) || isNetworkOrTimeout,
    status,
    message,
  };
}
