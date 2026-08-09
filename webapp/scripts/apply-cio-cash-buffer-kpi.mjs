import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cioPath = path.join(root, "app/components/CIOCommandCenterV20.tsx");
const meetingPath = path.join(root, "app/api/committee/meeting/route.ts");

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`apply-cio-cash-buffer-kpi: missing ${label}`);
  return source.replace(from, to);
}

let meeting = fs.readFileSync(meetingPath, "utf8");
meeting = replaceOnce(
  meeting,
  '        sources: { navFrom: buffer ? "portfolio ledger cash-buffer" : "computed from holdings and prices", priced: positions.filter((p) => p.price != null).length, positions: positions.length },',
  '        cashBuffer: { valueUsd: cashBalance, pct: cashBufferPct, targetPct: targetCashPct },\n        sources: { navFrom: buffer ? "portfolio ledger cash-buffer" : "computed from holdings and prices", priced: positions.filter((p) => p.price != null).length, positions: positions.length },',
  "meeting cashBuffer response"
);
fs.writeFileSync(meetingPath, meeting);

let cio = fs.readFileSync(cioPath, "utf8");
cio = replaceOnce(
  cio,
  '  nav: number;\n  quorum:',
  '  nav: number;\n  cashBuffer?: { valueUsd: number; pct: number | null; targetPct: number | null };\n  quorum:',
  "Meeting cashBuffer type"
);

cio = replaceOnce(
  cio,
  '      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={meeting.regime ? `${meeting.regime.icon} ${meeting.regime.regime}` : "UNAVAILABLE"} note={meeting.regime ? `${meeting.regime.score}/100 · cash floor ${meeting.regime.cashMinPct}%` : "No benchmark evidence"} />\n      <Kpi label={tr(lang, "New ideas", "หุ้นใหม่ที่เสนอ")}',
  '      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={meeting.regime ? `${meeting.regime.icon} ${meeting.regime.regime}` : "UNAVAILABLE"} note={meeting.regime ? `${meeting.regime.score}/100 · cash floor ${meeting.regime.cashMinPct}%` : "No benchmark evidence"} />\n      <Kpi label={tr(lang, "Cash Buffer", "เงินสำรอง Cash Buffer")} value={meeting.cashBuffer ? money(meeting.cashBuffer.valueUsd) : "—"} note={meeting.cashBuffer ? `${meeting.cashBuffer.pct == null ? "—" : meeting.cashBuffer.pct.toFixed(1) + "%"} ${tr(lang, "of portfolio", "ของพอร์ต")} · ${tr(lang, "floor", "ขั้นต่ำ")} ${(meeting.cashBuffer.targetPct ?? meeting.regime?.cashMinPct ?? 0).toFixed(1)}%` : tr(lang, "Buffer data unavailable", "ไม่มีข้อมูล Cash Buffer")} />\n      <Kpi label={tr(lang, "New ideas", "หุ้นใหม่ที่เสนอ")}',
  "Cash Buffer KPI"
);

cio = replaceOnce(
  cio,
  '      <Kpi label={tr(lang, "Capital allocation", "แผนจัดสรรเงิน")} value={meeting.capitalPlan.allocationStatus} note={meeting.capitalPlan.allocationComplete ? `${money(meeting.capitalPlan.temporaryParkingUsd)} temporary reserve` : `${money(meeting.capitalPlan.unallocatedUsd)} has no destination`} />',
  '      <Kpi label={tr(lang, "Capital allocation", "แผนจัดสรรเงิน")} value={meeting.capitalPlan.allocationStatus} note={meeting.capitalPlan.allocationComplete ? `${tr(lang, "Temporary reserve", "เงินพักชั่วคราว")}: ${money(meeting.capitalPlan.temporaryParkingUsd)} · ${tr(lang, "Cash Buffer", "Cash Buffer")}: ${meeting.cashBuffer ? `${money(meeting.cashBuffer.valueUsd)} (${meeting.cashBuffer.pct == null ? "—" : meeting.cashBuffer.pct.toFixed(1) + "%"})` : "—"}` : `${money(meeting.capitalPlan.unallocatedUsd)} ${tr(lang, "has no destination", "ยังไม่มีปลายทาง")}`} />',
  "Capital allocation note"
);

fs.writeFileSync(cioPath, cio);
console.log("apply-cio-cash-buffer-kpi: applied");
