export type CmsRow = {
  npi: string;
  year: number;
  hcpcs_code: string;
  place_of_service: string;
  line_srvc_cnt: number;
  average_Medicare_allowed_amt: number;
};

export type YearlyMetrics = {
  year: number;

  serviceEntropy: number;
  topServiceCode: string;
  topServiceShare: number;

  weightedAllowedMean: number;
  highIntensityShare: number;

  posEntropy: number;
  topPOS: string;
  topPOSShare: number;
};

export type DriftResult = {
  npi: string;
  years: number[];
  metricsByYear: YearlyMetrics[];

  serviceMixDrift: number;
  intensityDrift: number;
  posDrift: number;

  driftScore: number;
  stabilityIndex: number;
  label: "Stable" | "Watch" | "Drift Risk";

  executiveSummary: string;
  drivers: string[];
};
