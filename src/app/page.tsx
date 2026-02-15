"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type RiskLabel = "Stable" | "Watch" | "Drift Risk";

function badgeStyles(label: RiskLabel) {
  switch (label) {
    case "Stable":
      return "bg-green-100 text-green-800 border-green-200";
    case "Watch":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "Drift Risk":
    default:
      return "bg-red-100 text-red-800 border-red-200";
  }
}

function cardRing(label: RiskLabel) {
  switch (label) {
    case "Stable":
      return "ring-1 ring-green-200";
    case "Watch":
      return "ring-1 ring-amber-200";
    case "Drift Risk":
    default:
      return "ring-2 ring-red-300 bg-red-50/40";
  }
}

// For drift % cards: low drift = Stable, medium = Watch, high = Drift Risk
function severityFromPct(p: number): RiskLabel {
  if (p <= 20) return "Stable";
  if (p <= 50) return "Watch";
  return "Drift Risk";
}


function buildVoiceScript(drift: any, aiBrief: string) {
  const npi = drift?.npi ?? "this provider";
  const label = drift?.label ?? "Watch";
  const stability = drift?.stabilityIndex ?? "N/A";
  const years =
    Array.isArray(drift?.years) && drift.years.length
      ? `${Math.min(...drift.years)} to ${Math.max(...drift.years)}`
      : "the selected period";

  const svc = drift?.serviceMixDrift ?? "N/A";
  const inten = drift?.intensityDrift ?? "N/A";
  const pos = drift?.posDrift ?? "N/A";

  const top = drift?.metricsByYear?.[drift?.metricsByYear?.length - 1];
  const topCode = top?.topServiceCode ? `Top code is ${top.topServiceCode}.` : "";

  const drivers = Array.isArray(drift?.drivers) ? drift.drivers.slice(0, 2) : [];

  return [
    `Leadership update for provider ${npi}.`,
    `Status is ${label}, with a stability score of ${stability} percent, across ${years}.`,
    `We saw movement in three signals: service mix drift ${svc} percent, intensity drift ${inten} percent, and place-of-service drift ${pos} percent.`,
    topCode,
    drivers.length ? `Primary drivers: ${drivers.join(" ")}.` : `No dominant driver was detected.`,
    `This is a behavioral signal for oversight — not a judgment of clinical correctness.`,
    `Recommended next steps:`,
    `First, review the top shifting procedure codes and their share change.`,
    `Second, validate whether changes align with staffing, workflow, or case mix.`,
    `Third, if unexplained, run a small sample review and document the rationale.`,
  ]
    .filter(Boolean)
    .join(" \n\n"); // adds natural pause breaks
}


export default function Home() {
  const [npis, setNpis] = useState<string[]>([]);
  const [npi, setNpi] = useState<string>("");
  const [data, setData] = useState<any>(null);

  // Gemini + ElevenLabs state
  const [aiBrief, setAiBrief] = useState<string>("");
  const [briefLoading, setBriefLoading] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>("");

  // ✅ Needed for Pause/Play to work reliably
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch("/api/drift")
      .then((r) => r.json())
      .then((j) => {
        setNpis(j.npis ?? []);
        if (j.npis?.length) setNpi(j.npis[0]);
      });
  }, []);

  useEffect(() => {
    if (!npi) return;

    // reset AI outputs when provider changes
    setAiBrief("");

    // stop current audio + cleanup old url
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });

    fetch(`/api/drift?npi=${encodeURIComponent(npi)}`)
      .then((r) => r.json())
      .then(setData);
  }, [npi]);

  // ✅ Cleanup on unmount (prevents blob URL leaks)
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const series = useMemo(() => data?.metricsByYear ?? [], [data]);

  async function generateBrief() {
    if (!data || !npi) return;

    setBriefLoading(true);
    setAiBrief("");
    try {
      const r = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          npi,
          drift: {
            npi: data.npi,
            years: data.years,
            label: data.label,
            stabilityIndex: data.stabilityIndex,
            driftScore: data.driftScore,
            serviceMixDrift: data.serviceMixDrift,
            intensityDrift: data.intensityDrift,
            posDrift: data.posDrift,
            drivers: data.drivers,
            metricsByYear: data.metricsByYear,
            executiveSummary: data.executiveSummary,
          },
        }),
      });

      const j = await r.json();
      if (j?.error) throw new Error(j?.message ?? "Brief generation failed");

      setAiBrief(j.brief ?? "");
    } catch (e: any) {
      setAiBrief(`Error generating brief: ${e?.message ?? "unknown error"}`);
    } finally {
      setBriefLoading(false);
    }
  }

  async function playVoice() 
    {const text = buildVoiceScript(data, aiBrief).trim();
    if (!text) return;

    setVoiceLoading(true);

    try {
      const r = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!r.ok) {
        const err = await r.text();
        throw new Error(err);
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      // Stop any currently playing audio (no overlap)
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Replace audio src (and cleanup old blob URL)
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });

      // Play via the UI <audio> element so pause/play controls work
      setTimeout(() => {
        const el = audioRef.current;
        if (!el) return;
        el.load();
        el.play().catch(() => {});
      }, 0);
    } catch (e: any) {
      alert(`Voice failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setVoiceLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">ClinSight AI</h1>
            <p className="text-slate-600">
              Cognitive Drift Risk Signals (CMS Provider × Service × POS × Intensity)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600">Provider (NPI)</label>
            <select
              className="bg-white border rounded-lg px-3 py-2 text-sm"
              value={npi}
              onChange={(e) => setNpi(e.target.value)}
            >
              {npis.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        </header>

        {data && (
          <>
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <KpiCard
                title="Stability Index"
                value={`${data.stabilityIndex}%`}
                label={data.label as RiskLabel}
                sub="Pattern stability score"
              />

              <KpiCard
                title="Service Mix Drift"
                value={`${data.serviceMixDrift}%`}
                label={severityFromPct(Number(data.serviceMixDrift))}
                sub="Diversity + concentration"
              />

              <KpiCard
                title="Intensity Drift"
                value={`${data.intensityDrift}%`}
                label={severityFromPct(Number(data.intensityDrift))}
                sub="Allowed amount proxy"
              />

              <KpiCard
                title="POS Drift"
                value={`${data.posDrift}%`}
                label={severityFromPct(Number(data.posDrift))}
                sub="Care setting shift"
              />
            </section>

            <section className="bg-white rounded-xl border p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="font-semibold">Executive Summary (Plain Language)</h2>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={generateBrief}
                    disabled={briefLoading}
                    className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    {briefLoading ? "Generating…" : "Generate Management Brief (Gemini)"}
                  </button>

                  <button
                    onClick={playVoice}
                    disabled={voiceLoading || (!aiBrief && !data?.executiveSummary)}
                    className="rounded-lg border bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    {voiceLoading ? "Speaking…" : "Play Voice Brief (ElevenLabs)"}
                  </button>
                </div>
              </div>

              <p className="mt-2 text-slate-700 leading-relaxed">{data.executiveSummary}</p>

              {aiBrief && (
                <div className="mt-4 rounded-xl border bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">Management Brief (AI)</p>

                    <button
                      onClick={() => navigator.clipboard.writeText(aiBrief)}
                      className="text-xs px-3 py-1 rounded-lg border bg-white hover:bg-slate-50"
                    >
                      Copy
                    </button>
                  </div>

                  <div className="mt-3 bg-white border rounded-xl p-5 max-h-[420px] overflow-y-auto">
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                      {aiBrief}
                    </pre>
                  </div>
                </div>
              )}

              {audioUrl && (
                <div className="mt-3">
                  <audio ref={audioRef} controls src={audioUrl} className="w-full" />
                </div>
              )}

              <div className="mt-3">
                <p className="text-sm font-medium text-slate-800">Key drivers</p>
                <ul className="mt-2 list-disc ml-5 text-sm text-slate-700 space-y-1">
                  {data.drivers.map((d: string, i: number) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Note: This flags behavioral pattern shifts; it does not evaluate clinical correctness.
              </p>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ChartCard title="Service Diversity (Entropy) Trend">
                <LineTrend data={series} xKey="year" yKey="serviceEntropy" />
              </ChartCard>
              <ChartCard title="Top Service Share Trend">
                <LineTrend data={series} xKey="year" yKey="topServiceShare" />
              </ChartCard>
              <ChartCard title="Intensity Trend (Weighted Allowed Mean)">
                <LineTrend data={series} xKey="year" yKey="weightedAllowedMean" />
              </ChartCard>
              <ChartCard title="POS Diversity (Entropy) Trend">
                <LineTrend data={series} xKey="year" yKey="posEntropy" />
              </ChartCard>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function KpiCard({
  title,
  value,
  label,
  sub,
}: {
  title: string;
  value: string;
  label: RiskLabel;
  sub: string;
}) {
  return (
    <div className={`bg-white rounded-xl border p-5 ${cardRing(label)}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-600">{title}</p>
        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${badgeStyles(
            label
          )}`}
        >
          {label}
        </span>
      </div>

      <p className="mt-3 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{sub}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <p className="font-medium">{title}</p>
      <div className="mt-4 h-56">{children}</div>
    </div>
  );
}

function LineTrend({ data, xKey, yKey }: { data: any[]; xKey: string; yKey: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Line type="monotone" dataKey={yKey} strokeWidth={2} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}