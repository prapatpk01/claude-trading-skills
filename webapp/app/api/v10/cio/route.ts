import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Json = Record<string, any>;

async function readJson(origin: string, path: string): Promise<{ ok: boolean; status: number; data: Json }> {
  try {
    const response = await fetch(new URL(path, origin), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error: any) {
    return { ok: false, status: 500, data: { error: error?.message ?? "Request failed" } };
  }
}

function macroRegimeLabel(data: Json): string {
  const regime = data?.regime;
  if (typeof regime === "string") return regime;
  if (regime && typeof regime === "object") {
    return String(regime.label ?? regime.classification ?? regime.regime ?? "UNKNOWN");
  }
  return String(data?.current?.regime ?? "UNKNOWN");
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const [macro, integrity, buffer, optimizer, allocation, system] = await Promise.all([
    readJson(origin, "/api/macro/intelligence"),
    readJson(origin, "/api/portfolio/integrity"),
    readJson(origin, "/api/portfolio/cash-buffer"),
    readJson(origin, "/api/portfolio/optimizer"),
    readJson(origin, "/api/portfolio/opportunity-allocation"),
    readJson(origin, "/api/system/health"),
  ]);

  const macroEvidencePct = Number(
    macro.data?.evidenceCompletenessPct ?? macro.data?.evidenceCompleteness ?? 0,
  );
  const automaticExecution =
    allocation.data?.policy?.automaticExecution ?? allocation.data?.automaticExecution;
  const systemChecks = system.data?.checks ?? {};

  const controls = {
    macroEvidence: macro.ok && Number.isFinite(macroEvidencePct) && macroEvidencePct >= 60,
    portfolioIntegrity: integrity.ok && !["FAILED", "BLOCKED"].includes(String(integrity.data?.status ?? "")),
    verifiedNav: buffer.ok && buffer.data?.verified === true && Number.isFinite(Number(buffer.data?.totalNav)),
    liquidityPolicy: buffer.ok && buffer.data?.posture !== "UNVERIFIED",
    optimizerReady: optimizer.ok && optimizer.data?.status !== "BLOCKED",
    allocationGoverned: allocation.ok && automaticExecution !== true,
    secureRuntime:
      system.ok &&
      systemChecks.databaseReachable === true &&
      systemChecks.serviceRoleConfigured === true &&
      systemChecks.serverWritesProtected === true,
  };

  const passed = Object.values(controls).filter(Boolean).length;
  const total = Object.keys(controls).length;
  const readinessPct = Math.round((passed / total) * 100);
  const blockers: string[] = [];
  if (!controls.macroEvidence) blockers.push("Macro evidence is incomplete or unavailable.");
  if (!controls.portfolioIntegrity) blockers.push("Portfolio integrity requires review.");
  if (!controls.verifiedNav) blockers.push("Verified NAV is unavailable.");
  if (!controls.liquidityPolicy) blockers.push("Liquidity policy cannot be verified.");
  if (!controls.optimizerReady) blockers.push("Portfolio optimizer is blocked.");
  if (!controls.allocationGoverned) blockers.push("Capital allocation governance is unavailable.");
  if (!controls.secureRuntime) blockers.push("Secure database runtime is unavailable.");

  const macroScore = Number(macro.data?.regime?.score ?? macro.data?.score ?? macro.data?.current?.score);
  const regime = macroRegimeLabel(macro.data);
  const bufferPosture = String(buffer.data?.posture ?? "UNVERIFIED");
  const optimizerStatus = String(optimizer.data?.status ?? "BLOCKED");
  const approvedCandidates = Array.isArray(allocation.data?.allocations) ? allocation.data.allocations.length : 0;

  let posture = "HOLD / VERIFY";
  if (blockers.length === 0 && bufferPosture === "OVERFUNDED" && approvedCandidates > 0) posture = "SELECTIVE DEPLOYMENT";
  else if (blockers.length === 0 && optimizerStatus === "READY") posture = "MAINTAIN POLICY";
  else if (bufferPosture === "UNDERFUNDED") posture = "RAISE LIQUIDITY";
  else if (Number.isFinite(macroScore) && macroScore < 38) posture = "CAPITAL PRESERVATION";

  const decisions = [
    {
      desk: "CIO",
      action: posture,
      reason: blockers.length ? "Resolve governance and evidence blockers before increasing risk." : "Portfolio controls are aligned with current policy.",
    },
    {
      desk: "Macro",
      action: Number.isFinite(macroScore) && macroScore >= 55 ? "SELECTIVE RISK" : "DEFENSIVE BIAS",
      reason: `${regime}${Number.isFinite(macroScore) ? ` · score ${macroScore}` : ""}`,
    },
    {
      desk: "Treasury",
      action: bufferPosture,
      reason: `Liquidity buffer posture is ${bufferPosture}.`,
    },
    {
      desk: "Portfolio",
      action: optimizerStatus,
      reason: `Optimizer status is ${optimizerStatus}; automatic execution remains disabled.`,
    },
    {
      desk: "Opportunity",
      action: approvedCandidates > 0 ? "COMMITTEE QUEUE" : "NO APPROVED DEPLOYMENT",
      reason: `${approvedCandidates} candidate(s) currently satisfy the allocation bridge.`,
    },
  ];

  return NextResponse.json({
    version: "v10.0",
    system: "Sentinel Investment AI CIO",
    asOf: new Date().toISOString(),
    status: blockers.length === 0 ? "READY_FOR_HUMAN_REVIEW" : "REVIEW_REQUIRED",
    readinessPct,
    controls,
    blockers,
    posture,
    decisions,
    governance: {
      automaticExecution: false,
      humanApprovalRequired: true,
      evidenceFirst: true,
      auditTrailRequired: true,
    },
    sources: {
      macro: macro.status,
      integrity: integrity.status,
      cashBuffer: buffer.status,
      optimizer: optimizer.status,
      allocation: allocation.status,
      systemHealth: system.status,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
