// The mass test's report (mass/PLAN.md, section 7): report.json and report.md in the run's output folder.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Load } from './instances';

export type Mismatch = { object: string; field: string; expected: unknown; got: unknown };

/** One link, sender, receiver and object kind. */
export type Row = {
  phase: number;
  link: string;
  from: string;
  to: string;
  kind: string;
  sent: number;
  received: number;
  matched: number;
  mismatched: Mismatch[];
  /** Not sent, as the plugin documents (e.g. cot skips graphics): name and reason. */
  skipped: string[];
  lost: string[];
  duplicated: string[];
  /** Arrived though they must not (above the highest classification). */
  unexpected: string[];
};

export type Propagation = { link: string; from: string; to: string; what: string; sent: number; seen: number; latenciesMs: number[]; lastPositionWrong: string[]; unexplained: string[]; outOfOrder: string[] };

export type Report = {
  run: Record<string, unknown>;
  skippedParts: string[];
  rows: Row[];
  propagation: Propagation[];
  echoes: string[];
  loops: string[];
  phase3: Record<string, unknown>;
  notes: string[];
  logs: Record<string, string[]>;
  load: Load[];
  problems: string[];
};

export function newReport(run: Record<string, unknown>): Report {
  return { run, skippedParts: [], rows: [], propagation: [], echoes: [], loops: [], phase3: {}, notes: [], logs: {}, load: [], problems: [] };
}

export function stats(values: number[]) {
  if (values.length === 0) return { count: 0, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { count: sorted.length, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
}

const cell = (v: unknown) => String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const short = (list: string[], n = 8) => (list.length === 0 ? '' : `${list.slice(0, n).join(', ')}${list.length > n ? ` … (${list.length})` : ''}`);

export function writeReport(folder: string, report: Report) {
  writeFileSync(join(folder, 'report.json'), JSON.stringify({ ...report, propagation: report.propagation.map((p) => ({ ...p, stats: stats(p.latenciesMs) })) }, null, 2));
  const md: string[] = [];
  md.push('# Mass test report', '');
  md.push(`**Result: ${report.problems.length === 0 ? 'PASS' : `FAIL (${report.problems.length} problems)`}**`, '');
  md.push('## The run', '');
  for (const [k, v] of Object.entries(report.run)) md.push(`- ${k}: ${cell(v)}`);
  if (report.skippedParts.length > 0) {
    md.push('', '**Skipped, with the reason:**', '');
    for (const s of report.skippedParts) md.push(`- ${s}`);
  }
  if (report.rows.length > 0) {
    md.push('', '## Objects per link (phase 1)', '');
    md.push('| Link | From → to | Kind | Sent | Received | Matched | Mismatched | Skipped | Lost | Duplicated | Unexpected |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of report.rows) {
      md.push(`| ${r.link} | ${r.from} → ${r.to} | ${r.kind} | ${r.sent} | ${r.received} | ${r.matched} | ${r.mismatched.length} | ${r.skipped.length} | ${cell(short(r.lost))} | ${cell(short(r.duplicated))} | ${cell(short(r.unexpected))} |`);
    }
    const mismatches = report.rows.flatMap((r) => r.mismatched.map((m) => ({ ...m, link: r.link })));
    if (mismatches.length > 0) {
      md.push('', '### Mismatches, field by field', '');
      md.push('| Link | Object | Field | Expected | Got |', '|---|---|---|---|---|');
      for (const m of mismatches.slice(0, 200)) md.push(`| ${m.link} | ${m.object} | ${m.field} | ${cell(m.expected)} | ${cell(m.got)} |`);
      if (mismatches.length > 200) md.push('', `… and ${mismatches.length - 200} more in report.json.`);
    }
    const skipped = report.rows.filter((r) => r.skipped.length > 0);
    if (skipped.length > 0) {
      md.push('', '### Skipped as documented', '');
      for (const r of skipped) md.push(`- ${r.link} ${r.from} → ${r.to}, ${r.kind}: ${r.skipped.length} (${cell(short(r.skipped, 3))})`);
    }
  }
  if (report.propagation.length > 0) {
    md.push('', '## Propagation (phases 2 and 3)', '');
    md.push('| Link | From → to | What | Changes sent | Seen at the receiver | Median ms | 95 % ms | Max ms | Last position wrong | Unexplained updates | Out of order |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const p of report.propagation) {
      const s = stats(p.latenciesMs);
      md.push(`| ${p.link} | ${p.from} → ${p.to} | ${p.what} | ${p.sent} | ${p.seen} | ${s.median ?? '–'} | ${s.p95 ?? '–'} | ${s.max ?? '–'} | ${cell(short(p.lastPositionWrong))} | ${cell(short(p.unexplained))} | ${cell(short(p.outOfOrder))} |`);
    }
  }
  md.push('', '## Echoes and loops', '');
  md.push(`- Echoes (an instance's own object came back as a copy): ${report.echoes.length === 0 ? 'none' : cell(short(report.echoes, 20))}`);
  md.push(`- Loops (a source object changed by a link, not by the test): ${report.loops.length === 0 ? 'none' : cell(short(report.loops, 20))}`);
  if (Object.keys(report.phase3).length > 0) {
    md.push('', '## Simulation (phase 3)', '');
    for (const [k, v] of Object.entries(report.phase3)) md.push(`- ${k}: ${cell(v)}`);
  }
  if (report.notes.length > 0) {
    md.push('', '## Notes', '');
    for (const n of report.notes) md.push(`- ${n}`);
  }
  md.push('', '## Server logs', '');
  for (const [name, problems] of Object.entries(report.logs)) md.push(`- ${name}: ${problems.length === 0 ? 'no error lines, no warnings with a stack trace' : `${problems.length} problems: ${cell(short(problems, 5))}`}`);
  if (report.load.length > 0) {
    md.push('', '## Load', '');
    const by = new Map<string, Load[]>();
    for (const l of report.load) by.set(l.instance, [...(by.get(l.instance) ?? []), l]);
    for (const [name, samples] of by) {
      const memory = samples.map((s) => s.memoryMb).filter((m): m is number => m !== null);
      const cpu = samples.map((s) => s.cpuSeconds).filter((c): c is number => c !== null);
      md.push(`- ${name}: ${samples.length} samples; memory max ${memory.length ? Math.max(...memory) : '–'} MB; CPU time ${cpu.length ? `${(cpu[cpu.length - 1] - cpu[0]).toFixed(1)} s over the run` : '–'}`);
    }
  }
  if (report.problems.length > 0) {
    md.push('', '## Problems', '');
    for (const p of report.problems) md.push(`- ${p}`);
  }
  writeFileSync(join(folder, 'report.md'), `${md.join('\n')}\n`);
}
