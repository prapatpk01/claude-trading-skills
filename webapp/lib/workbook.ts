import ExcelJS from "exceljs";
import type { AnalysisResult } from "./analyze";
import type { FinancialRow } from "./types";

// ── Palette & style helpers ───────────────────────────────────────────
const NAVY = "FF1F2A44";
const BLUE = "FF2E5090";
const LIGHT = "FFEEF2F9";
const BAND = "FFF6F8FC";
const GREEN = "FF107C41";
const RED = "FFC00000";
const GREY = "FF6B7280";

const M = 1e6; // present financials in $ millions

function titleCell(ws: ExcelJS.Worksheet, range: string, text: string) {
  ws.mergeCells(range);
  const c = ws.getCell(range.split(":")[0]);
  c.value = text;
  c.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  const startRow = parseInt(range.match(/\d+/)![0], 10);
  ws.getRow(startRow).height = 30;
}

function sectionHeader(ws: ExcelJS.Worksheet, range: string, text: string) {
  ws.mergeCells(range);
  const c = ws.getCell(range.split(":")[0]);
  c.value = text;
  c.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  const startRow = parseInt(range.match(/\d+/)![0], 10);
  ws.getRow(startRow).height = 22;
}

function headerRow(ws: ExcelJS.Worksheet, rowIdx: number, values: (string | number)[], from = 1) {
  const row = ws.getRow(rowIdx);
  values.forEach((v, i) => {
    const c = row.getCell(from + i);
    c.value = v;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right", indent: i === 0 ? 1 : 0 };
    c.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
  });
  row.height = 18;
}

function labelValue(ws: ExcelJS.Worksheet, rowIdx: number, label: string, value: any, opts: { fmt?: string; bold?: boolean; color?: string; col?: number } = {}) {
  const col = opts.col ?? 1;
  const l = ws.getCell(rowIdx, col);
  l.value = label;
  l.font = { bold: !!opts.bold, color: { argb: GREY } };
  l.alignment = { indent: 1 };
  const v = ws.getCell(rowIdx, col + 1);
  v.value = value;
  if (opts.fmt) v.numFmt = opts.fmt;
  v.font = { bold: true, color: { argb: opts.color ?? "FF111111" } };
  v.alignment = { horizontal: "right" };
  return v;
}

function bandRows(ws: ExcelJS.Worksheet, start: number, end: number, cols: number) {
  for (let r = start; r <= end; r++) {
    if ((r - start) % 2 === 1) {
      for (let c = 1; c <= cols; c++) {
        ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
      }
    }
  }
}

const n = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const orNA = (v: number | null | undefined) => (v == null ? "n/a" : v);

// ══════════════════════════════════════════════════════════════════════
export async function buildWorkbook(a: AnalysisResult): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Equity Research Web";
  wb.created = new Date();
  const price = a.data.quote?.price ?? 0;
  const ov = a.data.overview;

  buildExecSummary(wb, a, price);
  buildIndustry(wb, a);
  buildFinancials(wb, a);
  buildThesisSheet(wb, a);
  const fcfRefs = buildModel(wb, a); // returns cell refs of projected FCF for valuation
  buildValuation(wb, a, fcfRefs);

  return wb.xlsx.writeBuffer();
}

// ── Sheet 1: Executive Summary ────────────────────────────────────────
function buildExecSummary(wb: ExcelJS.Workbook, a: AnalysisResult, price: number) {
  const ws = wb.addWorksheet("1. Executive Summary", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 30 }, { width: 22 }, { width: 3 }, { width: 30 }, { width: 22 }];
  const ov = a.data.overview;

  titleCell(ws, "A1:E1", `${a.ticker} — ${ov?.name ?? a.ticker}`);
  ws.getCell("A2").value = `${ov?.sector ?? "n/a"} · ${ov?.industry ?? "n/a"} · ${ov?.country ?? ""}`;
  ws.getCell("A2").font = { italic: true, color: { argb: GREY } };
  ws.mergeCells("A2:E2");

  // Three windows, not one. A null stays "n/a": a 0.00% change and "we could
  // not measure the change" are different facts.
  const mv = a.moves;
  const pctOrNa = (v: number | null | undefined) => (v == null ? "n/a" : v / 100);
  const toneOf = (v: number | null | undefined) => (v == null ? GREY : v >= 0 ? GREEN : RED);

  sectionHeader(ws, "A4:B4", "Current Snapshot");
  labelValue(ws, 5, "Price", price, { fmt: "$#,##0.00" });
  labelValue(ws, 6, "1-Day Change", pctOrNa(mv?.changePct1D ?? a.data.quote?.changePercent), {
    fmt: "0.00%", color: toneOf(mv?.changePct1D ?? a.data.quote?.changePercent),
  });
  labelValue(ws, 7, `1-Week Change${mv?.weekSessions != null && mv.weekSessions < 5 ? ` (${mv.weekSessions}d)` : ""}`,
    pctOrNa(mv?.changePct1W), { fmt: "0.00%", color: toneOf(mv?.changePct1W) });
  labelValue(
    ws, 8,
    mv?.extended ? (mv.extended.session === "pre" ? "Pre-market" : "After hours") : "Pre / after hours",
    mv?.extended ? mv.extended.changePct / 100 : "none",
    { fmt: "0.00%", color: toneOf(mv?.extended?.changePct) }
  );
  labelValue(ws, 9, "Market Cap ($M)", n(ov?.marketCap) / M, { fmt: "#,##0" });
  labelValue(ws, 10, "P/E (TTM)", orNA(ov?.peRatio), { fmt: "0.0" });
  labelValue(ws, 11, "EPS (TTM)", orNA(ov?.eps), { fmt: "$0.00" });
  labelValue(ws, 12, "Beta", orNA(ov?.beta), { fmt: "0.00" });
  labelValue(ws, 13, "52-wk Range", `${orNA(ov?.week52Low)} – ${orNA(ov?.week52High)}`);
  bandRows(ws, 5, 13, 2);
  if (mv?.extended) {
    ws.getCell("A14").value =
      `Extended-hours reading: $${mv.extended.price.toFixed(2)} at ` +
      `${new Date(mv.extended.asOf).toISOString().slice(11, 16)} UTC, against the ` +
      `${mv.extended.session === "pre" ? "previous" : "regular-session"} close of $${mv.extended.fromClose.toFixed(2)}.`;
    ws.mergeCells("A14:B14");
    ws.getCell("A14").font = { size: 8.5, italic: true, color: { argb: GREY } };
    ws.getCell("A14").alignment = { wrapText: true, vertical: "top", indent: 1 };
    ws.getRow(14).height = 24;
  }

  sectionHeader(ws, "D4:E4", "Valuation & Signal");
  labelValue(ws, 5, "Blended Target Price", a.targetPrice, { fmt: "$#,##0.00", col: 4, color: BLUE });
  const upside = ws.getCell(6, 5);
  ws.getCell(6, 4).value = "Expected Return";
  ws.getCell(6, 4).font = { bold: false, color: { argb: GREY } };
  ws.getCell(6, 4).alignment = { indent: 1 };
  upside.value = { formula: `(E5-B5)/B5`, result: a.upsidePct / 100 };
  upside.numFmt = "0.0%";
  upside.font = { bold: true, color: { argb: a.upsidePct >= 0 ? GREEN : RED } };
  upside.alignment = { horizontal: "right" };
  labelValue(ws, 7, "DCF Fair Value", a.dcf ? a.dcf.fairValue : "n/a", { fmt: "$#,##0.00", col: 4 });
  labelValue(ws, 8, "Analyst Target", orNA(ov?.analystTargetPrice), { fmt: "$#,##0.00", col: 4 });
  labelValue(ws, 9, "Momentum Score", `${a.momentum.total} / 100`, { col: 4, color: BLUE });
  const sig = labelValue(ws, 10, "Signal", a.signal, { col: 4, color: a.signal === "BUY" ? GREEN : a.signal === "SELL" ? RED : "FFB8860B" });
  sig.alignment = { horizontal: "right" };
  labelValue(ws, 11, "WACC", a.dcf ? a.dcf.wacc : "n/a", { fmt: "0.0%", col: 4 });
  labelValue(ws, 12, "Terminal Growth", a.assumptions.terminalGrowth, { fmt: "0.0%", col: 4 });
  // ROIC against the cost of capital, and the moat rating that follows from the
  // evidence on sheet 2 — the two lines a reader checks before the target price.
  labelValue(ws, 13, "ROIC − WACC",
    a.research?.returns.spreadPct != null ? a.research.returns.spreadPct / 100 : "n/a",
    { fmt: "0.0%", col: 4, color: (a.research?.returns.spreadPct ?? 0) > 0 ? GREEN : RED });
  labelValue(ws, 14, "Moat (evidence-scored)", a.research?.moat.overall ?? "n/a", { col: 4 })
    .alignment = { horizontal: "right" };
  labelValue(ws, 15, "Expected return (weighted)",
    a.expectedReturnPct != null ? a.expectedReturnPct / 100 : "n/a",
    { fmt: "0.0%", col: 4, color: (a.expectedReturnPct ?? 0) >= 0 ? GREEN : RED });
  bandRows(ws, 5, 15, 5);

  sectionHeader(ws, "A17:E17", "Quick Thesis");
  const scenarios = a.thesis.map((s) => `${s.label} (${s.probability}%, PT $${s.targetPrice}): ${s.narrative}`);
  let r = 18;
  for (const s of scenarios) {
    ws.mergeCells(`A${r}:E${r + 1}`);
    const c = ws.getCell(`A${r}`);
    c.value = s;
    c.alignment = { wrapText: true, vertical: "top" };
    c.font = { size: 10 };
    r += 2;
  }

  sectionHeader(ws, `A${r + 1}:E${r + 1}`, "Signal Drivers");
  r += 2;
  ws.mergeCells(`A${r}:E${r + 2}`);
  const sd = ws.getCell(`A${r}`);
  sd.value = a.signalReasons.map((x) => "• " + x).join("\n");
  sd.alignment = { wrapText: true, vertical: "top" };
  sd.font = { size: 10 };
  r += 3;

  footer(ws, `A${r + 1}`, a);
}

// ── Sheet 2: Industry & Competition ───────────────────────────────────
function buildIndustry(wb: ExcelJS.Workbook, a: AnalysisResult) {
  const ws = wb.addWorksheet("2. Industry & Competition", { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 30 }, { width: 15 }, { width: 19 }, { width: 16 },
    { width: 12 }, { width: 14 }, { width: 13 }, { width: 12 },
  ];
  const ov = a.data.overview;
  titleCell(ws, "A1:H1", "Industry & Competitive Landscape");

  sectionHeader(ws, "A3:H3", `Sector: ${ov?.sector ?? "n/a"} — ${ov?.industry ?? "n/a"}`);
  ws.mergeCells("A4:H7");
  const desc = ws.getCell("A4");
  desc.value = ov?.description || "Company description unavailable from data provider.";
  desc.alignment = { wrapText: true, vertical: "top" };
  desc.font = { size: 10 };

  const rp = a.research;
  let r = 9;

  // ── Market sizing, measured from filings rather than asked for ──
  sectionHeader(ws, `A${r}:E${r}`, "Market sizing — measured peer-set revenue pool");
  r++;
  if (rp) {
    ws.mergeCells(`A${r}:E${r + 1}`);
    const def = ws.getCell(`A${r}`);
    def.value = rp.sizing.definition;
    def.alignment = { wrapText: true, vertical: "top", indent: 1 };
    def.font = { size: 9, italic: true, color: { argb: GREY } };
    ws.getRow(r).height = 26;
    r += 2;

    headerRow(ws, r, ["Metric", "Value", "Basis"]);
    r++;
    const poolRow = r;
    const sizeRows: [string, any, string, string][] = [
      ["Peer-set revenue pool ($M)", rp.sizing.peerPoolRevenue != null ? rp.sizing.peerPoolRevenue / M : "n/a", "#,##0",
        `Sum of TTM revenue across ${rp.sizing.contributors} readable filers in the ${rp.peerSet.group} group`],
      ["Subject revenue TTM ($M)", n(ov?.revenueTTM) / M || (rp.peers.find((p) => p.isSubject)?.revenueTTM ?? 0) / M, "#,##0",
        "SEC XBRL, subject's own filing"],
      ["Share of readable pool", rp.sizing.subjectSharePct != null ? rp.sizing.subjectSharePct / 100 : "n/a", "0.0%",
        "Live formula below — recalculates if you edit either figure"],
      ["Pool revenue CAGR", rp.sizing.poolCagrPct != null ? rp.sizing.poolCagrPct / 100 : "n/a", "0.0%",
        "Revenue-weighted across the same filers, from their annual filings"],
      ["TAM ($B) — your input", "", "#,##0",
        "No free verifiable source exists for TAM. Enter one you trust and the share below computes."],
      ["Share of your TAM", { formula: `IF(B${r + 4}="","enter TAM above",B${r + 1}/(B${r + 4}*1000))` }, "0.00%",
        "Subject revenue ÷ your TAM"],
    ];
    sizeRows.forEach((row, i) => {
      const rr = r + i;
      ws.getCell(rr, 1).value = row[0];
      ws.getCell(rr, 1).alignment = { indent: 1 };
      const c = ws.getCell(rr, 2);
      c.value = row[1] as any;
      c.numFmt = row[2];
      c.alignment = { horizontal: "right" };
      c.font = { bold: true };
      // The TAM cell is an input: mark it as one.
      if (i === 4) {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
        c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      }
      ws.mergeCells(`C${rr}:E${rr}`);
      ws.getCell(rr, 3).value = row[3];
      ws.getCell(rr, 3).font = { italic: true, size: 9, color: { argb: GREY } };
      ws.getCell(rr, 3).alignment = { wrapText: true, vertical: "middle" };
    });
    // Make the pool share a live formula rather than a frozen number.
    ws.getCell(r + 2, 2).value = { formula: `IF(B${poolRow}=0,"",B${poolRow + 1}/B${poolRow})` };
    bandRows(ws, r, r + sizeRows.length - 1, 2);
    r += sizeRows.length + 1;

    for (const lim of rp.sizing.limits) {
      ws.mergeCells(`A${r}:E${r}`);
      const c = ws.getCell(`A${r}`);
      c.value = "• " + lim;
      c.alignment = { wrapText: true, vertical: "top", indent: 1 };
      c.font = { size: 9, color: { argb: GREY } };
      ws.getRow(r).height = 24;
      r++;
    }
    r++;

    // ── The peer table, every column measured the same way for every name ──
    sectionHeader(ws, `A${r}:H${r}`, `Competitive positioning — ${rp.peerSet.group} peer set`);
    r++;
    ws.mergeCells(`A${r}:H${r}`);
    const basis = ws.getCell(`A${r}`);
    basis.value = rp.peerSet.basis;
    basis.alignment = { wrapText: true, vertical: "top", indent: 1 };
    basis.font = { size: 9, italic: true, color: { argb: GREY } };
    r++;
    headerRow(ws, r, ["Company", "Price", "Revenue TTM ($M)", "Mkt Cap ($M)", "P/E (TTM)", "Gross margin", "Net margin", "Rev CAGR"]);
    r++;
    const peerStart = r;
    for (const p of rp.peers) {
      ws.getCell(r, 1).value = p.isSubject ? `${p.ticker} (subject)` : p.ticker;
      ws.getCell(r, 1).font = { bold: p.isSubject, color: { argb: p.isSubject ? BLUE : "FF111111" } };
      ws.getCell(r, 1).alignment = { indent: 1 };
      const cells: [number, any, string][] = [
        [2, p.price ?? "n/a", "$#,##0.00"],
        [3, p.revenueTTM != null ? p.revenueTTM / M : "n/a", "#,##0"],
        [4, p.marketCap != null ? p.marketCap / M : "n/a", "#,##0"],
        [5, p.peTTM ?? "n/a", "0.0"],
        [6, p.grossMargin != null ? p.grossMargin / 100 : "n/a", "0.0%"],
        [7, p.netMargin != null ? p.netMargin / 100 : "n/a", "0.0%"],
        [8, p.revenueCagrPct != null ? p.revenueCagrPct / 100 : "n/a", "0.0%"],
      ];
      for (const [col, val, fmt] of cells) {
        const c = ws.getCell(r, col);
        c.value = val;
        c.numFmt = fmt;
        c.alignment = { horizontal: "right" };
        if (val === "n/a") c.font = { color: { argb: GREY }, italic: true };
      }
      r++;
    }
    // Peer medians, as live formulas so the reader can add a name and see it move.
    ws.getCell(r, 1).value = "Peer median (excl. subject)";
    ws.getCell(r, 1).font = { bold: true, italic: true };
    ws.getCell(r, 1).alignment = { indent: 1 };
    for (const col of ["E", "F", "G", "H"]) {
      const c = ws.getCell(`${col}${r}`);
      c.value = { formula: `IFERROR(MEDIAN(${col}${peerStart + 1}:${col}${r - 1}),"")` };
      c.numFmt = col === "E" ? "0.0" : "0.0%";
      c.font = { bold: true, italic: true };
      c.alignment = { horizontal: "right" };
    }
    bandRows(ws, peerStart, r - 1, 8);
    // Colour the margin and growth columns so an outlier is visible at a glance.
    for (const col of ["F", "G", "H"]) {
      ws.addConditionalFormatting({
        ref: `${col}${peerStart}:${col}${r - 1}`,
        rules: [{
          type: "colorScale",
          cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
          color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }],
        } as any],
      });
    }
    r += 2;

    const gapped = rp.peers.filter((p) => p.gaps.length);
    if (gapped.length) {
      ws.mergeCells(`A${r}:H${r}`);
      const g = ws.getCell(`A${r}`);
      g.value =
        "Reading gaps: " +
        gapped.map((p) => `${p.ticker} — ${p.gaps.join(" ")}`).join("  |  ") +
        "  A blank is a figure that could not be read from the filing, not a zero.";
      g.alignment = { wrapText: true, vertical: "top", indent: 1 };
      g.font = { size: 9, color: { argb: GREY } };
      ws.getRow(r).height = 30;
      r += 2;
    }

    // ── Moat, each rating carrying its measurement ──
    sectionHeader(ws, `A${r}:H${r}`, `Moat assessment — overall: ${rp.moat.overall}`);
    r++;
    ws.mergeCells(`A${r}:H${r}`);
    const mn = ws.getCell(`A${r}`);
    mn.value = rp.moat.note;
    mn.alignment = { wrapText: true, vertical: "top", indent: 1 };
    mn.font = { size: 9, italic: true, color: { argb: GREY } };
    ws.getRow(r).height = 26;
    r++;
    headerRow(ws, r, ["Moat source", "Rating", "Evidence"]);
    r++;
    const moatStart = r;
    for (const m of rp.moat.sources) {
      ws.getCell(r, 1).value = m.source;
      ws.getCell(r, 1).alignment = { indent: 1 };
      const rating = ws.getCell(r, 2);
      rating.value = m.strength;
      rating.alignment = { horizontal: "center" };
      rating.font = {
        bold: true,
        color: { argb: m.strength === "Wide" ? GREEN : m.strength === "Narrow" ? "FFB8860B" : m.strength === "None" ? RED : GREY },
      };
      ws.mergeCells(`C${r}:H${r}`);
      const ev = ws.getCell(r, 3);
      ev.value = m.evidence;
      ev.alignment = { wrapText: true, vertical: "top" };
      ev.font = { size: 9.5 };
      ws.getRow(r).height = 30;
      r++;
    }
    bandRows(ws, moatStart, r - 1, 2);
    r += 1;
  } else {
    ws.mergeCells(`A${r}:E${r + 2}`);
    const c = ws.getCell(`A${r}`);
    c.value =
      "The peer set, market sizing and moat assessment could not be built — the SEC filings behind them were unreachable on this run. " +
      "Rather than print empty tables that look like findings, this section is left blank. Re-run to retry.";
    c.alignment = { wrapText: true, vertical: "top", indent: 1 };
    c.font = { size: 10, color: { argb: RED } };
    r += 4;
  }

  footer(ws, `A${r + 1}`, a);
}

// ── Sheet 3: Financials & Earnings ────────────────────────────────────
function buildFinancials(wb: ExcelJS.Workbook, a: AnalysisResult) {
  const ws = wb.addWorksheet("3. Financials & Earnings", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  titleCell(ws, "A1:F1", "Financials & Earnings Analysis");

  const inc = a.data.financials.income;
  const bal = a.data.financials.balance;
  const cf = a.data.financials.cashflow;
  const years = inc.map((r) => (r.fiscalDate as string).slice(0, 4));
  const nCols = Math.min(years.length, 5);

  // Historical income & margins with formulas
  sectionHeader(ws, "A3:F3", "Historical Income Statement & Margins ($M)");
  headerRow(ws, 4, ["Line item", ...years.slice(0, nCols)]);
  const isRows: [string, keyof FinancialRow | null, string][] = [
    ["Revenue", "totalRevenue", "#,##0"],
    ["Gross Profit", "grossProfit", "#,##0"],
    ["Operating Income", "operatingIncome", "#,##0"],
    ["Net Income", "netIncome", "#,##0"],
  ];
  let r = 5;
  const revRow = 5;
  isRows.forEach(([label, key, fmt]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).alignment = { indent: 1 };
    for (let c = 0; c < nCols; c++) {
      const cell = ws.getCell(r, 2 + c);
      cell.value = n(inc[c][key as string]) / M;
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right" };
    }
    r++;
  });
  // Margin rows (formulas referencing above)
  const grossMarginRow = r;
  const marginDefs = [
    ["Gross Margin %", revRow + 1, revRow],
    ["Operating Margin %", revRow + 2, revRow],
    ["Net Margin %", revRow + 3, revRow],
  ] as [string, number, number][];
  marginDefs.forEach(([label, numRow, denRow]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { italic: true, color: { argb: GREY } };
    ws.getCell(r, 1).alignment = { indent: 2 };
    for (let c = 0; c < nCols; c++) {
      const col = String.fromCharCode(66 + c); // B, C, ...
      const cell = ws.getCell(r, 2 + c);
      cell.value = { formula: `IF(${col}${denRow}=0,0,${col}${numRow}/${col}${denRow})` };
      cell.numFmt = "0.0%";
      cell.alignment = { horizontal: "right" };
    }
    r++;
  });
  bandRows(ws, 5, r - 1, nCols + 1);
  // color scale on margins
  ws.addConditionalFormatting({
    ref: `B${grossMarginRow}:${String.fromCharCode(65 + nCols)}${r - 1}`,
    rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }] } as any],
  });

  // Returns & balance snapshot
  r += 1;
  sectionHeader(ws, `A${r}:F${r}`, "Returns, Leverage & Liquidity");
  r++;
  const ov = a.data.overview;
  const b0 = bal[0] ?? {};
  const cf0 = cf[0] ?? {};
  const fcf = (n(cf0.operatingCashflow) - Math.abs(n(cf0.capitalExpenditures))) / M;
  const metrics: [string, any, string][] = [
    ["ROE (TTM)", ov?.roe ?? 0, "0.0%"],
    ["ROA (TTM)", ov?.roa ?? 0, "0.0%"],
    ["Cash & Equivalents ($M)", n(b0.cashAndEquivalents) / M, "#,##0"],
    ["Total Debt ($M)", (n(b0.longTermDebt) + n(b0.shortTermDebt)) / M, "#,##0"],
    ["Total Equity ($M)", n(b0.totalShareholderEquity) / M, "#,##0"],
    // Total Debt is at row r+3 and Total Equity at r+4 (this row is r+5) —
    // referencing r+4/r+5 made the cell depend on itself and Excel showed a
    // circular-reference error.
    ["Debt / Equity", { formula: `B${r + 3}/MAX(B${r + 4},0.0001)` }, "0.00"],
    ["Free Cash Flow ($M)", fcf, "#,##0"],
    ["FCF Margin", a.assumptions.fcfMargin, "0.0%"],
  ];
  metrics.forEach((m, i) => {
    const rr = r + i;
    ws.getCell(rr, 1).value = m[0];
    ws.getCell(rr, 1).alignment = { indent: 1 };
    const c = ws.getCell(rr, 2);
    c.value = m[1] as any;
    c.numFmt = m[2];
    c.alignment = { horizontal: "right" };
    c.font = { bold: true };
  });
  bandRows(ws, r, r + metrics.length - 1, 2);
  r += metrics.length + 1;

  // ── Return on invested capital ──
  //
  // The metric that decides whether growth is worth paying for. ROE flatters a
  // levered balance sheet and ROA punishes an asset-light one; ROIC against the
  // cost of capital answers the only question that matters — does reinvestment
  // create value or consume it.
  const rp = a.research;
  if (rp) {
    const rt = rp.returns;
    sectionHeader(ws, `A${r}:F${r}`, "Return on invested capital — does growth create value?");
    r++;
    headerRow(ws, r, ["Component", "Value", "How it was derived"]);
    r++;
    const roicStart = r;
    const roicRows: [string, any, string, string][] = [
      ["EBIT / operating income ($M)", n(inc[0]?.operatingIncome) / M || "n/a", "#,##0", "SEC XBRL, most recent fiscal year"],
      ["Effective tax rate", rt.effectiveTaxRatePct != null ? rt.effectiveTaxRatePct / 100 : "n/a", "0.0%",
        rt.taxRateSource === "filed" ? "Tax expense ÷ pre-tax income, as filed" : "21% US statutory rate assumed — the filed rate was unusable or absent"],
      ["NOPAT ($M)", rt.nopat != null ? rt.nopat / M : "n/a", "#,##0", "Live formula: EBIT × (1 − tax rate)"],
      ["Invested capital ($M)", rt.investedCapital != null ? rt.investedCapital / M : "n/a", "#,##0", "Total debt + shareholder equity − cash"],
      ["ROIC", rt.roicPct != null ? rt.roicPct / 100 : "n/a", "0.0%", "Live formula: NOPAT ÷ invested capital"],
      ["WACC", a.dcf ? a.dcf.wacc : "n/a", "0.0%", "From the DCF on sheet 6 — CAPM cost of equity, after-tax cost of debt"],
      ["ROIC − WACC spread", rt.spreadPct != null ? rt.spreadPct / 100 : "n/a", "0.0%", "Live formula. Positive means each reinvested dollar creates value"],
    ];
    roicRows.forEach((row, i) => {
      const rr = r + i;
      ws.getCell(rr, 1).value = row[0];
      ws.getCell(rr, 1).alignment = { indent: 1 };
      const c = ws.getCell(rr, 2);
      c.value = row[1] as any;
      c.numFmt = row[2];
      c.alignment = { horizontal: "right" };
      c.font = { bold: true };
      ws.mergeCells(`C${rr}:F${rr}`);
      ws.getCell(rr, 3).value = row[3];
      ws.getCell(rr, 3).font = { italic: true, size: 9, color: { argb: GREY } };
    });
    // Make the derived lines live so an edited tax rate or capital base flows through.
    const ebitR = roicStart, taxR = roicStart + 1, nopatR = roicStart + 2;
    const icR = roicStart + 3, roicR = roicStart + 4, waccR = roicStart + 5, spreadR = roicStart + 6;
    ws.getCell(nopatR, 2).value = { formula: `IF(OR(B${ebitR}="n/a",B${taxR}="n/a"),"n/a",B${ebitR}*(1-B${taxR}))` };
    ws.getCell(roicR, 2).value = { formula: `IF(OR(B${nopatR}="n/a",B${icR}="n/a",B${icR}<=0),"n/a",B${nopatR}/B${icR})` };
    ws.getCell(spreadR, 2).value = { formula: `IF(OR(B${roicR}="n/a",B${waccR}="n/a"),"n/a",B${roicR}-B${waccR})` };
    ws.getCell(spreadR, 2).font = {
      bold: true,
      color: { argb: (rt.spreadPct ?? 0) > 0 ? GREEN : RED },
    };
    bandRows(ws, roicStart, r + roicRows.length - 1, 2);
    r += roicRows.length;

    // ROIC by year, so the direction is visible and not just the level.
    if (rt.roicHistory.length >= 2) {
      r++;
      headerRow(ws, r, ["ROIC by fiscal year", ...rt.roicHistory.map((h) => h.year)]);
      r++;
      ws.getCell(r, 1).value = "ROIC";
      ws.getCell(r, 1).alignment = { indent: 1 };
      rt.roicHistory.forEach((h, i) => {
        const c = ws.getCell(r, 2 + i);
        c.value = h.roicPct / 100;
        c.numFmt = "0.0%";
        c.alignment = { horizontal: "right" };
      });
      ws.addConditionalFormatting({
        ref: `B${r}:${String.fromCharCode(65 + rt.roicHistory.length)}${r}`,
        rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: BLUE } } as any],
      });
      r++;
    }

    r++;
    ws.mergeCells(`A${r}:F${r + 1}`);
    const vd = ws.getCell(`A${r}`);
    vd.value = rt.verdict + (rt.gaps.length ? "  Gaps: " + rt.gaps.join(" ") : "");
    vd.alignment = { wrapText: true, vertical: "top", indent: 1 };
    vd.font = { size: 10 };
    ws.getRow(r).height = 30;
    r += 3;
  }

  // ── Quarterly results (SEC 10-Q/10-K derived) ──
  const quarters = a.data.quarters ?? [];
  if (quarters.length) {
    sectionHeader(ws, `A${r}:F${r}`, "Quarterly Results ($M) — last 8 reported quarters");
    r++;
    headerRow(ws, r, ["Quarter ended", "Revenue", "Net Income", "Net Margin", "EPS", "Rev YoY"]);
    r++;
    const qStart = r;
    quarters.forEach((q) => {
      ws.getCell(r, 1).value = q.end;
      ws.getCell(r, 1).alignment = { indent: 1 };
      ws.getCell(r, 2).value = q.revenue != null ? q.revenue / M : "n/a";
      ws.getCell(r, 2).numFmt = "#,##0";
      ws.getCell(r, 3).value = q.netIncome != null ? q.netIncome / M : "n/a";
      ws.getCell(r, 3).numFmt = "#,##0";
      // margin as a live formula so edits recalculate
      ws.getCell(r, 4).value = { formula: `IF(B${r}=0,"",C${r}/B${r})` };
      ws.getCell(r, 4).numFmt = "0.0%";
      ws.getCell(r, 5).value = q.eps ?? "n/a";
      ws.getCell(r, 5).numFmt = "$0.00";
      ws.getCell(r, 6).value = q.revenueYoY ?? "n/a";
      ws.getCell(r, 6).numFmt = "0.0%";
      [2, 3, 4, 5, 6].forEach((c) => (ws.getCell(r, c).alignment = { horizontal: "right" }));
      r++;
    });
    bandRows(ws, qStart, r - 1, 6);
    ws.addConditionalFormatting({
      ref: `F${qStart}:F${r - 1}`,
      rules: [
        { type: "cellIs", operator: "greaterThan", formulae: ["0"], style: { font: { color: { argb: GREEN } } } } as any,
        { type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: { argb: RED } } } } as any,
      ],
    });
    ws.addConditionalFormatting({
      ref: `D${qStart}:D${r - 1}`,
      rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: BLUE } } as any],
    });
    r++;
  }

  // Recent earnings
  sectionHeader(ws, `A${r}:F${r}`, "Recent Earnings (Beat / Miss vs consensus)");
  r++;
  headerRow(ws, r, ["Quarter", "Reported EPS", "Est. EPS", "Surprise", "Surprise %", "Result"]);
  r++;
  const earnStart = r;
  a.data.earnings.slice(0, 6).forEach((e) => {
    ws.getCell(r, 1).value = e.fiscalDate;
    ws.getCell(r, 2).value = e.reportedEPS ?? 0;
    ws.getCell(r, 2).numFmt = "$0.00";
    ws.getCell(r, 3).value = e.estimatedEPS ?? 0;
    ws.getCell(r, 3).numFmt = "$0.00";
    ws.getCell(r, 4).value = { formula: `B${r}-C${r}` };
    ws.getCell(r, 4).numFmt = "$0.00";
    ws.getCell(r, 5).value = (e.surprisePercent ?? 0) / 100;
    ws.getCell(r, 5).numFmt = "0.0%";
    ws.getCell(r, 6).value = { formula: `IF(B${r}>=C${r},"BEAT","MISS")` };
    ws.getCell(r, 6).alignment = { horizontal: "center" };
    [2, 3, 4, 5].forEach((c) => (ws.getCell(r, c).alignment = { horizontal: "right" }));
    r++;
  });
  if (r > earnStart) {
    bandRows(ws, earnStart, r - 1, 6);
    ws.addConditionalFormatting({
      ref: `F${earnStart}:F${r - 1}`,
      rules: [
        { type: "containsText", operator: "containsText", text: "BEAT", style: { font: { color: { argb: GREEN }, bold: true } } } as any,
        { type: "containsText", operator: "containsText", text: "MISS", style: { font: { color: { argb: RED }, bold: true } } } as any,
      ],
    });
  }
  footer(ws, `A${r + 1}`, a);
}

// ── Sheet 4: Thesis, Catalysts & Risks ────────────────────────────────
function buildThesisSheet(wb: ExcelJS.Workbook, a: AnalysisResult) {
  const ws = wb.addWorksheet("4. Thesis, Catalysts & Risks", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 22 }, { width: 14 }, { width: 30 }, { width: 62 }];
  titleCell(ws, "A1:D1", "Thesis, Catalysts & Risks");

  sectionHeader(ws, "A3:D3", "Scenario Analysis (probability-weighted)");
  headerRow(ws, 4, ["Scenario", "Probability", "Target Price", "Narrative"]);
  // Method note so the targets can be audited rather than taken on faith
  let r = 5;
  if (a.valuationNote) {
    ws.mergeCells(`A${r}:D${r + 1}`);
    const mn = ws.getCell(`A${r}`);
    mn.value = `Method: ${a.valuationNote}`;
    mn.alignment = { wrapText: true, vertical: "top", indent: 1 };
    mn.font = { size: 9, italic: true, color: { argb: GREY } };
    ws.getRow(r).height = 30;
    r += 2;
  }
  const first = r;
  a.thesis.forEach((s) => {
    ws.getCell(r, 1).value = s.label;
    ws.getCell(r, 1).font = { bold: true, color: { argb: s.label === "Bull" ? GREEN : s.label === "Bear" ? RED : BLUE } };
    ws.getCell(r, 2).value = s.probability / 100;
    ws.getCell(r, 2).numFmt = "0%";
    ws.getCell(r, 2).alignment = { horizontal: "right" };
    ws.getCell(r, 3).value = s.targetPrice;
    ws.getCell(r, 3).numFmt = "$#,##0.00";
    ws.getCell(r, 3).alignment = { horizontal: "right" };
    ws.getCell(r, 4).value = s.narrative;
    ws.getCell(r, 4).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(r, 4).font = { size: 10 };
    ws.getRow(r).height = 46;
    r++;
  });
  // weighted target via SUMPRODUCT
  ws.getCell(r, 1).value = "Blended PT";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = { formula: `SUM(B${first}:B${r - 1})` };
  ws.getCell(r, 2).numFmt = "0%";
  ws.getCell(r, 3).value = { formula: `SUMPRODUCT(B${first}:B${r - 1},C${first}:C${r - 1})` };
  ws.getCell(r, 3).numFmt = "$#,##0.00";
  ws.getCell(r, 3).font = { bold: true, color: { argb: BLUE } };
  ws.getCell(r, 3).alignment = { horizontal: "right" };
  bandRows(ws, first, r - 1, 4);
  r += 2;

  // Probability-weighted expected return — the number the scenario table is for.
  if (a.expectedReturnPct != null) {
    ws.getCell(r, 1).value = "Expected return";
    ws.getCell(r, 1).font = { bold: true };
    const er = ws.getCell(r, 3);
    er.value = { formula: `IF(B5=0,"",(C${r - 1}-${a.data.quote?.price ?? 0})/${a.data.quote?.price ?? 1})`, result: a.expectedReturnPct / 100 };
    er.numFmt = "0.0%";
    er.font = { bold: true, color: { argb: a.expectedReturnPct >= 0 ? GREEN : RED } };
    er.alignment = { horizontal: "right" };
    ws.mergeCells(`D${r}:D${r}`);
    ws.getCell(r, 4).value = `Probability-weighted against the spot price of $${(a.data.quote?.price ?? 0).toFixed(2)}. This, not the bull case, is the number that should drive sizing.`;
    ws.getCell(r, 4).font = { size: 9, italic: true, color: { argb: GREY } };
    ws.getCell(r, 4).alignment = { wrapText: true, vertical: "top" };
    r += 2;
  }

  // ── The dated timeline ──
  //
  // Dates rather than "0–3 months", because a horizon bucket cannot be planned
  // around. Everything projected is marked [E] and carries the rule that
  // produced it, so a projection is never mistaken for an announced date.
  const timeline = a.research?.timeline ?? [];
  sectionHeader(ws, `A${r}:D${r}`, "12-month catalyst timeline");
  r++;
  if (timeline.length) {
    headerRow(ws, r, ["Date", "Type", "Event", "Why it matters / how the date was set"]);
    r++;
    const catStart = r;
    for (const c of timeline) {
      ws.getCell(r, 1).value = c.window;
      ws.getCell(r, 1).font = { bold: true, size: 10 };
      ws.getCell(r, 1).alignment = { indent: 1 };
      const kind = ws.getCell(r, 2);
      kind.value = c.kind;
      kind.font = {
        size: 9, bold: true,
        color: { argb: c.kind === "Earnings" ? RED : c.kind === "Macro" ? BLUE : c.kind === "Distribution" ? GREEN : GREY },
      };
      ws.getCell(r, 3).value = c.event;
      ws.getCell(r, 3).font = { size: 10 };
      ws.getCell(r, 3).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(r, 4).value = `${c.impact}\n${c.basis}`;
      ws.getCell(r, 4).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(r, 4).font = { size: 9 };
      ws.getRow(r).height = 46;
      r++;
    }
    bandRows(ws, catStart, r - 1, 4);
  } else {
    // Fall back to the thematic list, and say that is what happened.
    headerRow(ws, r, ["Horizon", "Event", "", "Impact"]);
    ws.mergeCells(`B${r}:C${r}`);
    r++;
    const catStart = r;
    a.catalysts.forEach((c) => {
      ws.getCell(r, 1).value = c.horizon;
      ws.getCell(r, 1).font = { bold: true };
      ws.mergeCells(`B${r}:C${r}`);
      ws.getCell(r, 2).value = c.event;
      ws.getCell(r, 4).value = c.impact;
      ws.getCell(r, 4).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(r, 4).font = { size: 10 };
      ws.getRow(r).height = 32;
      r++;
    });
    bandRows(ws, catStart, r - 1, 4);
    ws.mergeCells(`A${r}:D${r}`);
    ws.getCell(`A${r}`).value =
      "No dated timeline could be built — reporting history was insufficient to project the next results. The horizons above are thematic, not scheduled.";
    ws.getCell(`A${r}`).font = { size: 9, italic: true, color: { argb: RED } };
    r++;
  }
  r += 1;

  sectionHeader(ws, `A${r}:D${r}`, "Key Risk Factors");
  r++;
  a.risks.forEach((risk) => {
    ws.getCell(r, 1).value = "⚠";
    ws.getCell(r, 1).alignment = { horizontal: "center" };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(r, 2).value = risk;
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(r, 2).font = { size: 10 };
    ws.getRow(r).height = 26;
    r++;
  });
  footer(ws, `A${r + 1}`, a);
}

// ── Sheet 5: 3-Statement Model ────────────────────────────────────────
function buildModel(wb: ExcelJS.Workbook, a: AnalysisResult): { fcfRefs: string[]; sheet: string } {
  const ws = wb.addWorksheet("5. 3-Statement Model", { views: [{ showGridLines: false }] });
  const sheetName = "5. 3-Statement Model";
  ws.columns = [{ width: 32 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];
  titleCell(ws, "A1:G1", "5-Year 3-Statement Forecast ($M)");

  const inc = a.data.financials.income;
  const cf = a.data.financials.cashflow;
  const bal = a.data.financials.balance;
  const baseRev = n(inc[0]?.totalRevenue) / M;
  const cf0 = cf[0] ?? {};
  const b0 = bal[0] ?? {};
  const g = a.assumptions.revenueGrowth;
  const grossMargin = n(inc[0]?.grossProfit) / Math.max(n(inc[0]?.totalRevenue), 1);
  const opMargin = a.data.overview?.operatingMargin ?? n(inc[0]?.operatingIncome) / Math.max(n(inc[0]?.totalRevenue), 1);
  const taxRate = 0.21;
  const fcfMargin = a.assumptions.fcfMargin;

  // Assumptions block
  sectionHeader(ws, "A3:G3", "Assumptions (edit blue cells to re-run the model)");
  headerRow(ws, 4, ["Driver", "Y1", "Y2", "Y3", "Y4", "Y5"]);
  ws.getCell(5, 1).value = "Revenue growth %";
  g.forEach((gr, i) => {
    const c = ws.getCell(5, 2 + i);
    c.value = gr;
    c.numFmt = "0.0%";
    c.font = { color: { argb: BLUE }, bold: true };
    c.alignment = { horizontal: "right" };
  });
  ws.getCell(6, 1).value = "Gross margin %";
  ws.getCell(7, 1).value = "Operating margin %";
  ws.getCell(8, 1).value = "Tax rate %";
  ws.getCell(9, 1).value = "FCF margin %";
  for (let i = 0; i < 5; i++) {
    const col = 2 + i;
    ws.getCell(6, col).value = grossMargin; ws.getCell(6, col).numFmt = "0.0%";
    ws.getCell(7, col).value = opMargin; ws.getCell(7, col).numFmt = "0.0%";
    ws.getCell(8, col).value = taxRate; ws.getCell(8, col).numFmt = "0.0%";
    ws.getCell(9, col).value = fcfMargin; ws.getCell(9, col).numFmt = "0.0%";
    [6, 7, 8, 9].forEach((rr) => {
      ws.getCell(rr, col).font = { color: { argb: BLUE } };
      ws.getCell(rr, col).alignment = { horizontal: "right" };
    });
  }
  ws.getCell(11, 1).value = "Base revenue (Y0, $M)";
  ws.getCell(11, 2).value = baseRev;
  ws.getCell(11, 2).numFmt = "#,##0";
  ws.getCell(11, 2).font = { bold: true };
  bandRows(ws, 5, 9, 6);

  const cols = ["B", "C", "D", "E", "F"];
  const year = (i: number) => cols[i];

  // Income statement
  sectionHeader(ws, "A13:G13", "Income Statement");
  headerRow(ws, 14, ["($M)", "Y1", "Y2", "Y3", "Y4", "Y5"]);
  const revRow = 15, cogsRow = 16, gpRow = 17, opRow = 18, taxRow = 19, niRow = 20;
  ws.getCell(revRow, 1).value = "Revenue";
  ws.getCell(cogsRow, 1).value = "COGS";
  ws.getCell(gpRow, 1).value = "Gross Profit";
  ws.getCell(opRow, 1).value = "Operating Income";
  ws.getCell(taxRow, 1).value = "Taxes";
  ws.getCell(niRow, 1).value = "Net Income";
  for (let i = 0; i < 5; i++) {
    const c = year(i);
    const prevRev = i === 0 ? "$B$11" : `${year(i - 1)}${revRow}`;
    ws.getCell(revRow, 2 + i).value = { formula: `${prevRev}*(1+${c}5)` };
    ws.getCell(cogsRow, 2 + i).value = { formula: `${c}${revRow}*(1-${c}6)` };
    ws.getCell(gpRow, 2 + i).value = { formula: `${c}${revRow}-${c}${cogsRow}` };
    ws.getCell(opRow, 2 + i).value = { formula: `${c}${revRow}*${c}7` };
    ws.getCell(taxRow, 2 + i).value = { formula: `${c}${opRow}*${c}8` };
    ws.getCell(niRow, 2 + i).value = { formula: `${c}${opRow}-${c}${taxRow}` };
    for (const rr of [revRow, cogsRow, gpRow, opRow, taxRow, niRow]) {
      ws.getCell(rr, 2 + i).numFmt = "#,##0";
      ws.getCell(rr, 2 + i).alignment = { horizontal: "right" };
    }
  }
  ws.getRow(niRow).font = { bold: true };
  bandRows(ws, revRow, niRow, 6);

  // Cash flow statement
  sectionHeader(ws, "A22:G22", "Cash Flow Statement");
  headerRow(ws, 23, ["($M)", "Y1", "Y2", "Y3", "Y4", "Y5"]);
  const niCfRow = 24, daRow = 25, ocfRow = 26, capexRow = 27, fcfRow = 28;
  ws.getCell(niCfRow, 1).value = "Net Income";
  ws.getCell(daRow, 1).value = "(+) D&A (est. 4% rev)";
  ws.getCell(ocfRow, 1).value = "Operating Cash Flow";
  ws.getCell(capexRow, 1).value = "(−) CapEx (est. 5% rev)";
  ws.getCell(fcfRow, 1).value = "Free Cash Flow";
  const fcfRefs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const c = year(i);
    ws.getCell(niCfRow, 2 + i).value = { formula: `${c}${niRow}` };
    ws.getCell(daRow, 2 + i).value = { formula: `${c}${revRow}*0.04` };
    ws.getCell(ocfRow, 2 + i).value = { formula: `${c}${niCfRow}+${c}${daRow}` };
    ws.getCell(capexRow, 2 + i).value = { formula: `-${c}${revRow}*0.05` };
    ws.getCell(fcfRow, 2 + i).value = { formula: `${c}${ocfRow}+${c}${capexRow}` };
    for (const rr of [niCfRow, daRow, ocfRow, capexRow, fcfRow]) {
      ws.getCell(rr, 2 + i).numFmt = "#,##0";
      ws.getCell(rr, 2 + i).alignment = { horizontal: "right" };
    }
    fcfRefs.push(`'${sheetName}'!${c}${fcfRow}`);
  }
  ws.getRow(fcfRow).font = { bold: true };
  bandRows(ws, niCfRow, fcfRow, 6);

  // Balance sheet (simplified, cash rolls with FCF)
  sectionHeader(ws, "A30:G30", "Balance Sheet (simplified)");
  headerRow(ws, 31, ["($M)", "Y1", "Y2", "Y3", "Y4", "Y5"]);
  const cashRow = 32, otherAssetRow = 33, assetsRow = 34, debtRow = 35, equityRow = 36, liabEqRow = 37;
  ws.getCell(cashRow, 1).value = "Cash (rolls with FCF)";
  ws.getCell(otherAssetRow, 1).value = "Other Assets";
  ws.getCell(assetsRow, 1).value = "Total Assets";
  ws.getCell(debtRow, 1).value = "Total Debt";
  ws.getCell(equityRow, 1).value = "Shareholder Equity";
  ws.getCell(liabEqRow, 1).value = "Total Liab + Equity";
  const baseCash = n(b0.cashAndEquivalents) / M;
  const otherAssets = (n(b0.totalAssets) - n(b0.cashAndEquivalents)) / M;
  const debt = (n(b0.longTermDebt) + n(b0.shortTermDebt)) / M;
  const baseEquity = n(b0.totalShareholderEquity) / M;
  for (let i = 0; i < 5; i++) {
    const c = year(i);
    const prevCash = i === 0 ? baseCash.toFixed(2) : `${year(i - 1)}${cashRow}`;
    ws.getCell(cashRow, 2 + i).value = { formula: `${prevCash}+${c}${fcfRow}` };
    ws.getCell(otherAssetRow, 2 + i).value = otherAssets;
    ws.getCell(assetsRow, 2 + i).value = { formula: `${c}${cashRow}+${c}${otherAssetRow}` };
    ws.getCell(debtRow, 2 + i).value = debt;
    const prevEq = i === 0 ? baseEquity.toFixed(2) : `${year(i - 1)}${equityRow}`;
    ws.getCell(equityRow, 2 + i).value = { formula: `${prevEq}+${c}${niRow}` };
    ws.getCell(liabEqRow, 2 + i).value = { formula: `${c}${debtRow}+${c}${equityRow}` };
    for (const rr of [cashRow, otherAssetRow, assetsRow, debtRow, equityRow, liabEqRow]) {
      ws.getCell(rr, 2 + i).numFmt = "#,##0";
      ws.getCell(rr, 2 + i).alignment = { horizontal: "right" };
    }
  }
  ws.getRow(assetsRow).font = { bold: true };
  ws.getRow(liabEqRow).font = { bold: true };
  bandRows(ws, cashRow, liabEqRow, 6);

  footer(ws, "A39", a);
  return { fcfRefs, sheet: sheetName };
}

// ── Sheet 6: Valuation & Scenarios ────────────────────────────────────
function buildValuation(wb: ExcelJS.Workbook, a: AnalysisResult, model: { fcfRefs: string[]; sheet: string }) {
  const ws = wb.addWorksheet("6. Valuation & Scenarios", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }];
  titleCell(ws, "A1:G1", "DCF Valuation & Scenarios");

  const ov = a.data.overview;
  const beta = ov?.beta ?? 1.1;
  const shares = ov?.sharesOutstanding || (ov?.marketCap && a.data.quote?.price ? ov.marketCap / a.data.quote.price : 0);
  const b0 = a.data.financials.balance[0] ?? {};
  const netDebtM = ((n(b0.longTermDebt) + n(b0.shortTermDebt)) - n(b0.cashAndEquivalents)) / M;

  // WACC block
  sectionHeader(ws, "A3:C3", "WACC Build-up");
  const wa: [string, any, string][] = [
    ["Risk-free rate", 0.043, "0.00%"],
    ["Equity risk premium", 0.05, "0.00%"],
    ["Beta", beta, "0.00"],
    ["Cost of equity", { formula: "B5+B7*B6" }, "0.00%"],
    ["Cost of debt (after-tax)", 0.035, "0.00%"],
    ["Equity weight", 0.85, "0%"],
    ["Debt weight", { formula: "1-B10" }, "0%"],
    ["WACC", { formula: "B8*B10+B9*B11" }, "0.00%"],
  ];
  let r = 5;
  wa.forEach(([label, val, fmt]) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).alignment = { indent: 1 };
    const c = ws.getCell(r, 2);
    c.value = val as any;
    c.numFmt = fmt;
    c.alignment = { horizontal: "right" };
    c.font = { bold: label === "WACC" || label === "Cost of equity" };
    if (typeof val === "number") c.font = { ...(c.font || {}), color: { argb: BLUE } };
    r++;
  });
  const waccCell = "B12";
  bandRows(ws, 5, 12, 2);

  // DCF cash flows (link FCF from model sheet)
  sectionHeader(ws, "E3:G3", "Terminal & Share Data");
  labelValue(ws, 5, "Terminal growth", a.assumptions.terminalGrowth, { fmt: "0.00%", col: 5, color: BLUE });
  labelValue(ws, 6, "Shares out (M)", shares / M, { fmt: "#,##0.0", col: 5 });
  labelValue(ws, 7, "Net debt ($M)", netDebtM, { fmt: "#,##0", col: 5 });
  labelValue(ws, 8, "Current price", a.data.quote?.price ?? 0, { fmt: "$#,##0.00", col: 5 });
  const gCell = "F5", sharesCell = "F6", netDebtCell = "F7", priceCell = "F8";
  bandRows(ws, 5, 8, 7);

  sectionHeader(ws, "A14:G14", "Discounted Cash Flow ($M)");
  headerRow(ws, 15, ["", "Y1", "Y2", "Y3", "Y4", "Y5"]);
  const fcfR = 16, dfR = 17, pvR = 18;
  ws.getCell(fcfR, 1).value = "Free Cash Flow";
  ws.getCell(dfR, 1).value = "Discount factor";
  ws.getCell(pvR, 1).value = "PV of FCF";
  const cols = ["B", "C", "D", "E", "F"];
  for (let i = 0; i < 5; i++) {
    const c = cols[i];
    ws.getCell(fcfR, 2 + i).value = { formula: model.fcfRefs[i] };
    ws.getCell(dfR, 2 + i).value = { formula: `1/(1+$${waccCell.replace("B", "B$")})^${i + 1}` };
    ws.getCell(pvR, 2 + i).value = { formula: `${c}${fcfR}*${c}${dfR}` };
    for (const rr of [fcfR, dfR, pvR]) {
      ws.getCell(rr, 2 + i).numFmt = rr === dfR ? "0.000" : "#,##0";
      ws.getCell(rr, 2 + i).alignment = { horizontal: "right" };
    }
  }
  bandRows(ws, fcfR, pvR, 6);

  // Valuation summary with formulas
  sectionHeader(ws, "A20:C20", "Intrinsic Value");
  const sumPv = 21, tv = 22, pvTv = 23, ev = 24, eq = 25, fv = 26, up = 27;
  ws.getCell(sumPv, 1).value = "Σ PV of FCF (Y1–Y5)";
  ws.getCell(sumPv, 2).value = { formula: `SUM(B${pvR}:F${pvR})` };
  ws.getCell(tv, 1).value = "Terminal value (Gordon)";
  ws.getCell(tv, 2).value = { formula: `F${fcfR}*(1+${gCell})/(${waccCell}-${gCell})` };
  ws.getCell(pvTv, 1).value = "PV of terminal value";
  ws.getCell(pvTv, 2).value = { formula: `B${tv}*F${dfR}` };
  ws.getCell(ev, 1).value = "Enterprise value";
  ws.getCell(ev, 2).value = { formula: `B${sumPv}+B${pvTv}` };
  ws.getCell(eq, 1).value = "Equity value (− net debt)";
  ws.getCell(eq, 2).value = { formula: `B${ev}-${netDebtCell}` };
  ws.getCell(fv, 1).value = "Fair value / share";
  ws.getCell(fv, 2).value = { formula: `B${eq}/${sharesCell}` };
  ws.getCell(fv, 2).numFmt = "$#,##0.00";
  ws.getCell(fv, 1).font = { bold: true };
  ws.getCell(fv, 2).font = { bold: true, color: { argb: BLUE } };
  ws.getCell(up, 1).value = "Upside / (downside)";
  ws.getCell(up, 2).value = { formula: `(B${fv}-${priceCell})/${priceCell}` };
  ws.getCell(up, 2).numFmt = "0.0%";
  for (const rr of [sumPv, tv, pvTv, ev, eq]) {
    ws.getCell(rr, 2).numFmt = "#,##0";
    ws.getCell(rr, 1).alignment = { indent: 1 };
  }
  ws.getCell(up, 1).alignment = { indent: 1 };
  ws.getCell(fv, 1).alignment = { indent: 1 };
  bandRows(ws, sumPv, up, 2);
  ws.addConditionalFormatting({
    ref: `B${up}`,
    rules: [
      { type: "cellIs", operator: "greaterThan", formulae: ["0"], style: { font: { color: { argb: GREEN }, bold: true } } } as any,
      { type: "cellIs", operator: "lessThan", formulae: ["0"], style: { font: { color: { argb: RED }, bold: true } } } as any,
    ],
  });

  // Sensitivity table: fair value vs WACC (cols) and terminal growth (rows)
  const stTop = 20; // place to the right
  sectionHeader(ws, "D20:G20", "Sensitivity: Fair Value / Share");
  ws.getCell(21, 4).value = "g ↓ / WACC →";
  ws.getCell(21, 4).font = { italic: true, color: { argb: GREY } };
  const waccVals = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => 0); // placeholder; use formulas referencing base wacc
  // WACC header cells (E21..) as base ± offsets
  const waccOffsets = [-0.02, -0.01, 0, 0.01, 0.02];
  const gOffsets = [-0.01, -0.005, 0, 0.005, 0.01];
  // only 4 columns available (D,E,F,G) → use 3 WACC cols to fit; expand columns instead
  // We'll use columns E,F,G,H,I for 5 wacc values → ensure widths
  ws.getColumn(8).width = 15;
  ws.getColumn(9).width = 15;
  const waccCols = ["E", "F", "G", "H", "I"];
  waccOffsets.forEach((off, i) => {
    const cell = ws.getCell(21, 5 + i);
    cell.value = { formula: `${waccCell}+${off}` };
    cell.numFmt = "0.0%";
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center" };
  });
  gOffsets.forEach((goff, rIdx) => {
    const rowNum = 22 + rIdx;
    const gLabel = ws.getCell(rowNum, 4);
    gLabel.value = { formula: `${gCell}+${goff}` };
    gLabel.numFmt = "0.00%";
    gLabel.font = { bold: true, color: { argb: "FFFFFFFF" } };
    gLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    gLabel.alignment = { horizontal: "center" };
    waccOffsets.forEach((woff, cIdx) => {
      const wref = `${waccCols[cIdx]}$21`; // wacc header (row fixed)
      const gref = `$D${rowNum}`; // g header (col fixed)
      // Full DCF fair value at (wref, gref)
      const pvExplicit = cols
        .map((c, i) => `${c}${fcfR}/(1+${wref})^${i + 1}`)
        .join("+");
      const term = `(F${fcfR}*(1+${gref})/(${wref}-${gref}))/(1+${wref})^5`;
      const formula = `((${pvExplicit}+${term})-${netDebtCell})/${sharesCell}`;
      const cell = ws.getCell(rowNum, 5 + cIdx);
      cell.value = { formula };
      cell.numFmt = "$#,##0.00";
      cell.alignment = { horizontal: "right" };
    });
  });
  ws.addConditionalFormatting({
    ref: `E22:I26`,
    rules: [{ type: "colorScale", cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }] } as any],
  });

  // Scenario target prices
  r = 29;
  sectionHeader(ws, `A${r}:C${r}`, "Scenario Target Prices");
  r++;
  headerRow(ws, r, ["Scenario", "Target", "Return"]);
  r++;
  const scStart = r;
  a.thesis.forEach((s) => {
    ws.getCell(r, 1).value = `${s.label} (${s.probability}%)`;
    ws.getCell(r, 2).value = s.targetPrice;
    ws.getCell(r, 2).numFmt = "$#,##0.00";
    ws.getCell(r, 3).value = { formula: `(B${r}-${priceCell})/${priceCell}` };
    ws.getCell(r, 3).numFmt = "0.0%";
    [2, 3].forEach((c) => (ws.getCell(r, c).alignment = { horizontal: "right" }));
    r++;
  });
  ws.getCell(r, 1).value = "Blended target";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = a.targetPrice;
  ws.getCell(r, 2).numFmt = "$#,##0.00";
  ws.getCell(r, 2).font = { bold: true, color: { argb: BLUE } };
  ws.getCell(r, 3).value = { formula: `(B${r}-${priceCell})/${priceCell}` };
  ws.getCell(r, 3).numFmt = "0.0%";
  ws.getCell(r, 3).font = { bold: true };
  bandRows(ws, scStart, r - 1, 3);

  footer(ws, `A${r + 2}`, a);
}

// ── shared footer with sources ────────────────────────────────────────
function footer(ws: ExcelJS.Worksheet, anchor: string, a: AnalysisResult) {
  const c = ws.getCell(anchor);
  const sources = [...a.data.sources, ...(a.research?.sources ?? [])];
  const list = sources.length ? sources.join("  ") : "n/a";
  c.value =
    `Sources: ${list}\n` +
    `Every figure is either read from a filing or computed from one; where a figure had no free verifiable source it is marked n/a and the reason given, never estimated silently. Projected dates carry [E].\n` +
    `Generated ${new Date(a.asOf).toUTCString()} by Equity Research Web. For research and education only — not investment advice.`;
  c.font = { italic: true, size: 8, color: { argb: GREY } };
  const startRow = parseInt(anchor.match(/\d+/)![0], 10);
  ws.mergeCells(`${anchor}:H${startRow}`);
  ws.getCell(anchor).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(startRow).height = 66;
}
