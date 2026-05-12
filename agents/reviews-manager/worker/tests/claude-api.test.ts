import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { generateReplyDraft, type ReviewInput } from "../src/lib/claude-api";

function getApiKey(): string {
  // 1. Shell env var (inline ANTHROPIC_API_KEY=... npx vitest)
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "xxx") {
    return process.env.ANTHROPIC_API_KEY;
  }
  // 2. Fallback: read from .env file
  try {
    const raw = readFileSync(".env", "utf-8");
    const match = raw.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match && match[1].trim() !== "xxx") return match[1].trim();
  } catch {}
  throw new Error(
    "Pass ANTHROPIC_API_KEY as env var or set it in worker/.env"
  );
}

const API_KEY = getApiKey();

const reviews: Array<{ label: string; input: ReviewInput }> = [
  {
    label: "5★ con staff mencionado (Brayan)",
    input: {
      reviewerName: "Patricia Salinas",
      starRating: 5,
      comment:
        "El servicio de Brayan fue excelente, comida deliciosa, sin duda volvemos.",
    },
  },
  {
    label: "5★ general sin staff",
    input: {
      reviewerName: "Sofia Martínez",
      starRating: 5,
      comment:
        "Lugar precioso para desayunar. La terraza es muy bonita y el café estuvo muy bueno.",
    },
  },
  {
    label: "4★ feedback suave constructivo",
    input: {
      reviewerName: "Carolina Mendoza",
      starRating: 4,
      comment:
        "Buena comida, buen lugar. Solo un detalle: tardaron en traer los huevos pero al final todo bien.",
    },
  },
  {
    label: "3★ queja moderada",
    input: {
      reviewerName: "Roberto Cantú",
      starRating: 3,
      comment:
        "Servicio lento. Estuvimos esperando 25 minutos por nuestra orden. La comida cuando llegó estaba buena pero la experiencia se vio afectada.",
    },
  },
  {
    label: "1★ problema serio",
    input: {
      reviewerName: "Marcos Treviño",
      starRating: 1,
      comment:
        "Encontré un pelo en mi chilaquiles. El mesero ofreció cambiarlos pero la experiencia ya estaba arruinada para toda la familia. No volvemos.",
    },
  },
];

const outputs: Array<Record<string, unknown>> = [];

describe("Claude API — system prompt validation", () => {
  it("5★ con staff mencionado (Brayan)", async () => {
    const result = await generateReplyDraft(API_KEY, reviews[0].input);
    const draft = result.draft;
    const words = draft.split(/\s+/).length;

    outputs.push({ ...reviews[0], draft, wordCount: words, model: result.model, tokensIn: result.inputTokens, tokensOut: result.outputTokens });

    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toMatch(/🙏|🤍|😊|🙌/);
    expect(draft).toContain("AMALAY Coffee & Market");
    expect(draft).toContain("Plaza Duendes, San Pedro Garza García");
    expect(draft).toContain("Brayan");
    expect(words).toBeGreaterThanOrEqual(30);
    expect(words).toBeLessThanOrEqual(60);
  }, 30_000);

  it("5★ general sin staff", async () => {
    const result = await generateReplyDraft(API_KEY, reviews[1].input);
    const draft = result.draft;
    const words = draft.split(/\s+/).length;

    outputs.push({ ...reviews[1], draft, wordCount: words, model: result.model, tokensIn: result.inputTokens, tokensOut: result.outputTokens });

    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toMatch(/🙏|🤍|😊|🙌/);
    expect(draft).toContain("AMALAY Coffee & Market");
    expect(draft).toContain("Plaza Duendes, San Pedro Garza García");
    expect(words).toBeGreaterThanOrEqual(30);
    expect(words).toBeLessThanOrEqual(60);
  }, 30_000);

  it("4★ feedback suave constructivo", async () => {
    const result = await generateReplyDraft(API_KEY, reviews[2].input);
    const draft = result.draft;
    const words = draft.split(/\s+/).length;

    outputs.push({ ...reviews[2], draft, wordCount: words, model: result.model, tokensIn: result.inputTokens, tokensOut: result.outputTokens });

    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toMatch(/🙏|🤍|😊|🙌/);
    expect(draft).toContain("AMALAY Coffee & Market");
    expect(draft).toContain("Plaza Duendes, San Pedro Garza García");
    expect(words).toBeGreaterThanOrEqual(30);
    expect(words).toBeLessThanOrEqual(60);
  }, 30_000);

  it("3★ queja moderada", async () => {
    const result = await generateReplyDraft(API_KEY, reviews[3].input);
    const draft = result.draft;
    const words = draft.split(/\s+/).length;

    outputs.push({ ...reviews[3], draft, wordCount: words, model: result.model, tokensIn: result.inputTokens, tokensOut: result.outputTokens });

    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toMatch(/🙏|🤍|😊|🙌/);
    expect(draft).toContain("AMALAY Coffee & Market");
    expect(draft).toContain("Plaza Duendes, San Pedro Garza García");
    expect(words).toBeGreaterThanOrEqual(30);
    expect(words).toBeLessThanOrEqual(60);
  }, 30_000);

  it("1★ problema serio", async () => {
    const result = await generateReplyDraft(API_KEY, reviews[4].input);
    const draft = result.draft;

    outputs.push({ ...reviews[4], draft, wordCount: draft.split(/\s+/).length, model: result.model, tokensIn: result.inputTokens, tokensOut: result.outputTokens });

    expect(typeof draft).toBe("string");
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("[URGENT_REVIEW]");
    expect(draft).toContain("hola@cafeamalay.com");
  }, 30_000);

  it("dump outputs to file", () => {
    writeFileSync(
      "tests/prompt-outputs.json",
      JSON.stringify(outputs, null, 2),
      "utf-8"
    );
  });
});
