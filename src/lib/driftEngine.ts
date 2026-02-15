import type { CmsRow, DriftResult, YearlyMetrics } from "./types";

function freqMapWeighted(items: string[], weights: number[]) {
  const m = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const k = items[i];
    m.set(k, (m.get(k) ?? 0) + weights[i]);
  }
  return m;
}

function entropyFromMap(m: Map<string, number>) {
  const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let H = 0;
  for (const v of m.values()) {
    const p = v / total;
    if (p > 0) H -= p * Math.log2(p);
  }
  return H;
}

function topShareFromMap(m: Map<string, number>) {
  const total = Array.from(m.values()).reduce((a, b) => a + b, 0) || 1;
  let topKey = "N/A";
  let topVal = 0;
  for (const [k, v] of m.entries()) {
    if (v > topVal) {
      topVal = v;
      topKey = k;
    }
  }
  return { key: topKey, share: topVal / total };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function labelFromStability(stabilityIndex: number): DriftResult["label"] {
  if (stabilityIndex >= 80) return "Stable";
  if (stabilityIndex >= 60) return "Watch";
  return "Drift Risk";
}

function buildExecutiveSummary(args: {
  label: DriftResult["label"];
  years: number[];
  topCodeChange: { from: number; to: number; code: string };
  entropyChangePct: number;
  intensityChangePct: number;
  posTopChange: { from: number; to: number; pos: string };
}) {
  const { label, years, topCodeChange, entropyChangePct, intensityChangePct, posTopChange } = args;
  const yrSpan = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : "selected years";

  const concentrationDir =
    topCodeChange.to > topCodeChange.from ? "more concentrated" : "less concentrated";

  const diversityDir =
    entropyChangePct > 0 ? "more diverse" : entropyChangePct < 0 ? "more narrow" : "unchanged";

  const intensityDir =
    intensityChangePct > 0 ? "increased" : intensityChangePct < 0 ? "decreased" : "stayed stable";

  return [
    `Clinical Pattern Stability: ${label} (${yrSpan}).`,
    `Service mix shifted (${concentrationDir}): top service (${topCodeChange.code}) changed from ${Math.round(
      topCodeChange.from * 100
    )}% to ${Math.round(topCodeChange.to * 100)}%.`,
    `Decision diversity changed by ${Math.round(entropyChangePct)}% (${diversityDir}).`,
    `Intensity proxy ${intensityDir} by ${Math.round(Math.abs(intensityChangePct))}% (weighted allowed amount pattern).`,
    `Care setting shifted: top Place of Service (${posTopChange.pos}) moved from ${Math.round(
      posTopChange.from * 100
    )}% to ${Math.round(posTopChange.to * 100)}%.`,
    `This is a behavioral risk signal (pattern shift), not a judgment of clinical correctness.`,
  ].join(" ");
}

export function listNpis(rows: CmsRow[]) {
  return Array.from(new Set(rows.map((r) => r.npi))).sort();
}

export function computeDriftForNpi(rows: CmsRow[], npi: string): DriftResult {
  const r = rows.filter((x) => x.npi === npi);
  const years = Array.from(new Set(r.map((x) => x.year))).sort((a, b) => a - b);

  const metricsByYear: YearlyMetrics[] = years.map((year) => {
    const yr = r.filter((x) => x.year === year);

    const weights = yr.map((x) => x.line_srvc_cnt);
    const svcMap = freqMapWeighted(yr.map((x) => x.hcpcs_code), weights);
    const posMap = freqMapWeighted(yr.map((x) => x.place_of_service), weights);

    const serviceEntropy = entropyFromMap(svcMap);
    const topSvc = topShareFromMap(svcMap);

    const posEntropy = entropyFromMap(posMap);
    const topPos = topShareFromMap(posMap);

    const totalSvc = weights.reduce((a, b) => a + b, 0) || 1;
    const weightedAllowedMean =
      yr.reduce((sum, x) => sum + x.average_Medicare_allowed_amt * x.line_srvc_cnt, 0) / totalSvc;

    const allAllowed = r.map((x) => x.average_Medicare_allowed_amt);
    const p75 = percentile(allAllowed, 75);

    const highSvc = yr
      .filter((x) => x.average_Medicare_allowed_amt >= p75)
      .reduce((sum, x) => sum + x.line_srvc_cnt, 0);

    const highIntensityShare = highSvc / totalSvc;

    return {
      year,
      serviceEntropy,
      topServiceCode: topSvc.key,
      topServiceShare: topSvc.share,
      weightedAllowedMean,
      highIntensityShare,
      posEntropy,
      topPOS: topPos.key,
      topPOSShare: topPos.share,
    };
  });

  // Split periods (works for 2 pseudo-years or real multi-year)
  const mid = Math.max(1, Math.floor(metricsByYear.length / 2));
  const baseline = metricsByYear.slice(0, mid);
  const recent = metricsByYear.slice(mid);

  const avg = (arr: YearlyMetrics[], key: keyof YearlyMetrics) =>
    arr.length ? arr.reduce((s, x) => s + (x[key] as number), 0) / arr.length : 0;

  const baseEntropy = avg(baseline, "serviceEntropy");
  const recEntropy = avg(recent, "serviceEntropy");

  const baseTopShare = avg(baseline, "topServiceShare");
  const recTopShare = avg(recent, "topServiceShare");

  const baseAllowed = avg(baseline, "weightedAllowedMean");
  const recAllowed = avg(recent, "weightedAllowedMean");

  const basePOSEntropy = avg(baseline, "posEntropy");
  const recPOSEntropy = avg(recent, "posEntropy");

  // ✅ Drift should be CHANGE in either direction (not just narrowing)
  const entropyAbs =
    baseEntropy === 0 ? 0 : Math.min(1, Math.abs(recEntropy - baseEntropy) / baseEntropy);

  const topShareAbs =
    baseTopShare === 0 ? 0 : Math.min(1, Math.abs(recTopShare - baseTopShare) / baseTopShare);

  const intensityAbs =
    baseAllowed === 0 ? 0 : Math.min(1, Math.abs(recAllowed - baseAllowed) / baseAllowed);

  const posEntropyAbs =
    basePOSEntropy === 0 ? 0 : Math.min(1, Math.abs(recPOSEntropy - basePOSEntropy) / basePOSEntropy);

  // Weighted drift components
  const serviceMixDrift01 = 0.60 * entropyAbs + 0.40 * topShareAbs;
  const intensityDrift01 = intensityAbs;
  const posDrift01 = posEntropyAbs;

  const serviceMixDrift = Math.round(serviceMixDrift01 * 100);
  const intensityDrift = Math.round(intensityDrift01 * 100);
  const posDrift = Math.round(posDrift01 * 100);

  const drift01 = 0.40 * serviceMixDrift01 + 0.35 * intensityDrift01 + 0.25 * posDrift01;
  const driftScore = Math.round(drift01 * 100);
  const stabilityIndex = Math.max(0, 100 - driftScore);
  const label = labelFromStability(stabilityIndex);

  const drivers: string[] = [];
  if (serviceMixDrift >= 25) drivers.push("Service mix shifted (procedure pattern change detected).");
  if (intensityDrift >= 25) drivers.push("Service intensity proxy shifted (allowed amount pattern changed).");
  if (posDrift >= 25) drivers.push("Care setting distribution shifted (Place of Service mix changed).");
  if (drivers.length === 0) drivers.push("No major drift drivers detected across the selected window.");

  const first = metricsByYear[0];
  const last = metricsByYear[metricsByYear.length - 1];

  const executiveSummary = buildExecutiveSummary({
    label,
    years,
    topCodeChange: {
      from: first?.topServiceShare ?? 0,
      to: last?.topServiceShare ?? 0,
      code: last?.topServiceCode ?? "N/A",
    },
    entropyChangePct: baseEntropy === 0 ? 0 : ((recEntropy - baseEntropy) / baseEntropy) * 100,
    intensityChangePct: baseAllowed === 0 ? 0 : ((recAllowed - baseAllowed) / baseAllowed) * 100,
    posTopChange: {
      from: first?.topPOSShare ?? 0,
      to: last?.topPOSShare ?? 0,
      pos: last?.topPOS ?? "N/A",
    },
  });

  return {
    npi,
    years,
    metricsByYear,
    serviceMixDrift,
    intensityDrift,
    posDrift,
    driftScore,
    stabilityIndex,
    label,
    executiveSummary,
    drivers,
  };
}
