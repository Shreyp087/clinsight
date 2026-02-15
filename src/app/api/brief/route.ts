// src/app/api/brief/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type GeminiResp = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

function stripMarkdown(s: string) {
  return (s ?? "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function pct(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "Not available in the dataset.";
}

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? `${Math.round(n)}` : "Not available in the dataset.";
}

function bulletCount(text: string) {
  return text.split("\n").filter((l) => l.trim().startsWith("•")).length;
}

function ensureThreeBullets(text: string) {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const bullets = lines.filter((l) => l.trim().startsWith("•")).slice(0, 3);
  const body = lines.filter((l) => !l.trim().startsWith("•")).join("\n").trim();

  const fillers = [
    "• Review top service code share and entropy changes (first vs last year).",
    "• Validate whether changes align with documented operational or case-mix shifts.",
    "• If unexplained, run a light-touch sample review and document findings.",
  ];

  const out = [...bullets];
  while (out.length < 3) out.push(fillers[out.length]);

  return [body, ...out].filter(Boolean).join("\n").trim();
}

function ensureLimitationAtEnd(text: string) {
  const cleaned = text.replace(/Behavioral signal, not clinical correctness\.\s*$/i, "").trim();
  return `${cleaned}\nBehavioral signal, not clinical correctness.`;
}

// Simple hallucination guard: if the model mentions these, it’s inventing beyond your JSON.
function looksHallucinated(text: string) {
  const banned = [
    "mri",
    "ct",
    "lower back",
    "icd",
    "cpt",
    "radiation",
    "referral",
    "guideline",
    "peer average",
    "specialist",
    "clinic",
    "pain",
    "q1",
    "q2",
    "q3",
    "q4",
  ];
  const t = text.toLowerCase();
  return banned.some((w) => t.includes(w));
}

function fallbackBrief(drift: any, npi: string) {
  const label = drift?.label ?? "Watch";
  const stability = drift?.stabilityIndex ?? "Not available in the dataset.";
  const years = Array.isArray(drift?.years) && drift.years.length ? drift.years.join("–") : "selected period";
  const svc = drift?.serviceMixDrift ?? "Not available in the dataset.";
  const inten = drift?.intensityDrift ?? "Not available in the dataset.";
  const pos = drift?.posDrift ?? "Not available in the dataset.";
  const drivers = Array.isArray(drift?.drivers) ? drift.drivers.slice(0, 3) : [];

  const metrics = Array.isArray(drift?.metricsByYear) ? drift.metricsByYear : [];
  const first = metrics[0] ?? {};
  const last = metrics[metrics.length - 1] ?? {};

  return ensureLimitationAtEnd(
    ensureThreeBullets(
      [
        `Executive Brief — Provider ${npi}`,
        `Status: ${label} (Stability Index: ${stability}%) across ${years}.`,
        `Drift signals: Service Mix Drift ${svc}%, Intensity Drift ${inten}%, Place-of-Service Drift ${pos}%.`,
        `Top service code: ${last?.topServiceCode ?? "Not available in the dataset."}; share changed from ${pct(first?.topServiceShare)} to ${pct(last?.topServiceShare)}.`,
        `Service diversity (entropy) changed from ${num(first?.serviceEntropy)} to ${num(last?.serviceEntropy)}.`,
        `Intensity proxy (weighted allowed mean) changed from ${num(first?.weightedAllowedMean)} to ${num(last?.weightedAllowedMean)}.`,
        `Top POS: ${last?.topPOS ?? "Not available in the dataset."}; share changed from ${pct(first?.topPOSShare)} to ${pct(last?.topPOSShare)}.`,
        drivers.length ? `Primary drivers: ${drivers.join(" ")}` : `Primary drivers: Not available in the dataset.`,
        `Interpretation: this is a behavioral pattern shift signal for oversight; it does not assess clinical correctness.`,
        "",
        "• Review top service code share + entropy shift (first vs last year).",
        "• Confirm whether intensity/POS changes align with operational context.",
        "• If unexplained, run a small sample review and document rationale.",
      ].join("\n")
    )
  );
}

async function callGemini(apiKey: string, prompt: string) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 700 },
    }),
  });

  const raw = await resp.text();
  if (!resp.ok) return { ok: false as const, status: resp.status, raw };

  const parsed = JSON.parse(raw) as GeminiResp;
  const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text).filter(Boolean).join("\n").trim();

  return {
    ok: true as const,
    text,
    finishReason: parsed?.candidates?.[0]?.finishReason,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { drift, npi } = await req.json();
    const npiStr = String(npi ?? drift?.npi ?? "").trim();
    if (!npiStr) {
      return NextResponse.json({ error: true, message: "Missing npi in request body." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: true, message: "Missing GEMINI_API_KEY. Add it to .env.local and restart npm run dev." },
        { status: 500 }
      );
    }

    const metrics = Array.isArray(drift?.metricsByYear) ? drift.metricsByYear : [];
    const first = metrics[0] ?? null;
    const last = metrics[metrics.length - 1] ?? null;

    // Minimal facts-only packet to reduce hallucinations
    const facts = {
      npi: npiStr,
      years: drift?.years,
      label: drift?.label,
      stabilityIndex: drift?.stabilityIndex,
      serviceMixDrift: drift?.serviceMixDrift,
      intensityDrift: drift?.intensityDrift,
      posDrift: drift?.posDrift,
      drivers: drift?.drivers,
      firstYear: first,
      lastYear: last,
    };

    const basePrompt = `
Write for non-technical hospital leadership.

CRITICAL: Use ONLY the facts in the JSON. Do NOT infer diseases, imaging types, referrals, guidelines, CPT/ICD codes, quarters, peer comparisons, or anything not in JSON.
If a detail is missing, write: "Not available in the dataset."

Output format (STRICT):
- Line 1 exactly: Executive Brief — Provider ${npiStr}
- 6–9 short sentences, plain text, no headings, no markdown
- Then exactly 3 bullets starting with "•"
- Final line exactly: Behavioral signal, not clinical correctness.

You MUST mention:
- years
- label + stabilityIndex
- serviceMixDrift + intensityDrift + posDrift
- topServiceCode + topServiceShare (first vs last) if present
- weightedAllowedMean (first vs last) if present
- topPOS + topPOSShare (first vs last) if present
- drivers

JSON facts:
${JSON.stringify(facts, null, 2)}
`.trim();

    // Attempt 1
    const g1 = await callGemini(apiKey, basePrompt);

    if (!g1.ok || !g1.text) {
      return NextResponse.json({
        brief: fallbackBrief(drift, npiStr),
        warning: `Gemini error ${g1.ok ? "empty" : g1.status}; served fallback.`,
        raw: g1.ok ? undefined : g1.raw,
      });
    }

    let out = stripMarkdown(g1.text);
    out = ensureThreeBullets(out);
    out = ensureLimitationAtEnd(out);

    // If it still hallucinates, try once more with “ultra strict”
    if (looksHallucinated(out)) {
      const strictPrompt = `
Rewrite the brief using ONLY the JSON facts. Remove ANY invented clinical details (no MRI/CT, no conditions, no guidelines, no referrals, no peer comparisons, no quarters).
If unknown, say: "Not available in the dataset."

Keep the same STRICT format rules.

JSON facts:
${JSON.stringify(facts, null, 2)}
`.trim();

      const g2 = await callGemini(apiKey, strictPrompt);
      if (g2.ok && g2.text) {
        let out2 = stripMarkdown(g2.text);
        out2 = ensureThreeBullets(out2);
        out2 = ensureLimitationAtEnd(out2);
        // If still hallucinating, fallback
        if (!looksHallucinated(out2)) out = out2;
      }
    }

    // Final safety: if still hallucinated, fallback
    if (looksHallucinated(out)) {
      return NextResponse.json({
        brief: fallbackBrief(drift, npiStr),
        warning: "Gemini attempted to introduce non-dataset details; served factual fallback brief.",
      });
    }

    return NextResponse.json({ brief: out });
  } catch (err: any) {
    console.error("brief route error:", err);
    return NextResponse.json(
      { error: true, message: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
