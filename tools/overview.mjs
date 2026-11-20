// Generates a one-page HTML project overview: where we are, next steps per agent,
// all tasks (T-), spikes (S), change requests (CR-) and decisions (ADR-), open and closed.
// Usage: node tools/overview.mjs            (writes tools/out/project-overview.html)
// Reads docs/status.md, docs/adr/, docs/change-requests/, docs/handover/ and git. Changes nothing else.
// The output is generated: it is ignored by git and must not be committed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './lib.mjs';

const read = (rel) => readFileSync(join(root, rel), 'utf8');
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

// ---------- helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal inline markdown: code, bold, links. `base` is the folder (repo-relative) the text lives in. */
function inline(text, base = 'docs') {
  let out = esc(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
    if (/^https?:/.test(href)) return label;
    const clean = href.replace(/&amp;/g, '&');
    return `<a href="../../${esc(base)}/${esc(clean)}">${label}</a>`;
  });
  return out;
}

function sectionOf(md, heading) {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(`## ${heading.toLowerCase()}`));
  if (start < 0) return [];
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body;
}

function bullets(lines) {
  const items = [];
  for (const l of lines) {
    if (/^\s*(\d+\.|-)\s+/.test(l) && !/^\s{2,}/.test(l)) items.push(l.replace(/^\s*(\d+\.|-)\s+/, ''));
    else if (/^\s{2,}\S/.test(l) && items.length) items[items.length - 1] += /^\s*-\s/.test(l) ? ' · ' + l.trim().replace(/^-\s*/, '') : ' ' + l.trim();
  }
  return items.filter((i) => i.trim() && !/^(none|nothing)\.?$/i.test(i.trim()));
}

function tables(md) {
  // returns [{section, header:[...], rows:[[...]]}]
  const lines = md.split('\n');
  const result = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,3}\s+(.*)/);
    if (h) section = h[1].trim();
    if (lines[i].startsWith('|') && lines[i + 1] && /^\|[\s|:-]+\|?$/.test(lines[i + 1])) {
      const cells = (l) => l.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const header = cells(lines[i]);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].startsWith('|')) rows.push(cells(lines[j++]));
      result.push({ section, header, rows });
      i = j - 1;
    }
  }
  return result;
}

// ---------- data ----------
const statusMd = read('docs/status.md');
const statusTables = tables(statusMd);

const tasks = [];
for (const t of statusTables) {
  if (t.header[0] !== 'Id') continue;
  const isPlugin = t.header.includes('Plugin');
  for (const r of t.rows) {
    if (!/^T-\d+/.test(r[0])) continue;
    if (isPlugin) {
      tasks.push({ id: r[0], title: `Plugin ${r[1]}`, owner: `PCA-${r[1].replace(/`/g, '')}`, status: r[3], deps: ['T-016', 'T-017'], notes: r[2], group: t.section });
    } else {
      tasks.push({ id: r[0], title: r[1], owner: r[2].split(/[ (]/)[0], status: r[3], deps: r[4].match(/T-\d+/g) || [], notes: r[5] || '', group: t.section });
    }
  }
}
const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
const isDone = (id) => taskById[id]?.status === 'done';
for (const t of tasks) {
  t.waitingOn = t.deps.filter((d) => !isDone(d));
  t.open = t.status !== 'done';
  t.ready = t.status === 'todo' && t.waitingOn.length === 0;
}

const milestone = (statusMd.match(/^## Current milestone:\s*(.*)$/m) || [, 'M0'])[1];
const milestoneGoal = (statusMd.match(/^Goal:\s*(.*)$/m) || [, ''])[1];
const setupLine = (statusMd.match(/^\*\*Setup phase:\*\*\s*(.*)$/m) || [, ''])[1];

const mergeLog = (statusTables.find((t) => t.header[0] === 'Date')?.rows || []).filter((r) => /^\d{4}-/.test(r[0]));

const decisionsWaiting = bullets(sectionOf(statusMd, 'Decisions waiting for the owner'));
const followUps = {};
for (const m of statusMd.matchAll(/^## Follow-ups for the (\w+)\n([\s\S]*?)(?=\n## |$)/gm)) followUps[m[1]] = bullets(m[2].split('\n'));

// ADRs
const adrs = readdirSync(join(root, 'docs/adr'))
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map((f) => {
    const md = read(`docs/adr/${f}`);
    return {
      id: `ADR-${f.slice(0, 4)}`,
      file: f,
      title: (md.match(/^# ADR-\d+:\s*(.*)$/m) || [, f])[1],
      status: (md.match(/^- Status:\s*(.*)$/m) || [, '?'])[1],
      date: (md.match(/^- Date:\s*(.*)$/m) || [, ''])[1],
    };
  });

// Change requests
const crs = readdirSync(join(root, 'docs/change-requests'))
  .filter((f) => /^CR-\d+/.test(f))
  .sort()
  .map((f) => {
    const md = read(`docs/change-requests/${f}`);
    const decision = sectionOf(md, 'Decision').join(' ').trim();
    return {
      id: f.match(/^CR-\d+/)[0],
      file: f,
      title: (md.match(/^# CR-\d+:\s*(.*)$/m) || [, f])[1],
      by: (md.match(/^- Requested by:\s*(.*)$/m) || [, ''])[1],
      date: (md.match(/^- Date:\s*(.*)$/m) || [, ''])[1],
      status: (md.match(/^- Status:\s*(.*)$/m) || [, '?'])[1],
      decision,
    };
  });

// Spikes: table from the architecture overview, status derived from the board
const spikeTask = { S2: 'T-006', S4: 'T-007' };
const overviewMd = read('docs/architecture/overview.md');
const spikes = [];
for (const t of tables(overviewMd)) {
  if (t.header[0] !== 'Id') continue;
  for (const r of t.rows) {
    if (!/^S\d+$/.test(r[0])) continue;
    const tid = spikeTask[r[0]];
    const task = tid && taskById[tid];
    spikes.push({
      id: r[0], question: r[1], why: r[2], shapes: r[3], task: tid || '',
      status: task ? task.status : 'not scheduled',
      folder: existsSync(join(root, 'spikes', r[0].toLowerCase())) || readdirSync(join(root, 'spikes')).some((d) => d.toLowerCase().startsWith(r[0].toLowerCase())),
    });
  }
}

// Handovers and branches
const roleOfBranch = (b) => (b.startsWith('pca-') ? b.split('/')[0].toUpperCase().replace('PCA-', 'PCA-') : b.split('/')[0].toUpperCase());
const branches = (git('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split('\n').filter(Boolean);
const branchInfo = branches.filter((b) => b !== 'main').map((b) => ({
  name: b,
  role: roleOfBranch(b),
  ahead: Number(git('rev-list', '--count', `main..${b}`) || 0),
  last: git('log', '-1', '--format=%ad', '--date=short', b) || '',
}));

const roles = ['ACA', 'CDA', 'PDA', 'ITA', 'MCA', 'ESA'];
const handovers = {};
for (const role of roles) {
  const path = `docs/handover/${role.toLowerCase()}.md`;
  const cands = [];
  const fromMain = git('show', `main:${path}`);
  if (fromMain) cands.push({ md: fromMain, src: 'main', ahead: 0 });
  for (const b of branchInfo.filter((x) => x.role === role)) {
    const md = git('show', `${b.name}:${path}`);
    if (md) cands.push({ md, src: b.name, ahead: b.ahead });
  }
  cands.sort((a, b) => {
    const da = (a.md.match(/Updated:\s*(\d{4}-\d{2}-\d{2})/) || [, ''])[1];
    const db = (b.md.match(/Updated:\s*(\d{4}-\d{2}-\d{2})/) || [, ''])[1];
    return db.localeCompare(da) || b.ahead - a.ahead;
  });
  if (cands[0]) {
    const md = cands[0].md;
    handovers[role] = {
      src: cands[0].src,
      updated: (md.match(/Updated:\s*(\d{4}-\d{2}-\d{2})/) || [, ''])[1],
      next: bullets(sectionOf(md, 'Next steps')),
      blocked: bullets(sectionOf(md, 'Blocked / waiting for')),
      ready: bullets(sectionOf(md, 'Ready for merge')),
    };
  }
}

// ---------- derived: where are we ----------
const count = (pred) => tasks.filter(pred).length;
const counts = {
  total: tasks.length,
  done: count((t) => t.status === 'done'),
  active: count((t) => t.status === 'in progress' || t.status === 'review'),
  ready: count((t) => t.ready),
  waiting: count((t) => t.status === 'todo' && !t.ready),
  blocked: count((t) => t.status === 'blocked'),
};
const pct = Math.round((counts.done / counts.total) * 100);
const openCrs = crs.filter((c) => !/approved|rejected|withdrawn/i.test(c.status));
const head = git('rev-parse', '--short', 'main') || '?';
const today = new Date().toISOString().slice(0, 10);

const ownerOrder = ['Owner', 'ACA', 'PDA', 'CDA', 'ITA', 'MCA', 'ESA'];
const agentRows = [...new Set([...ownerOrder, ...tasks.map((t) => t.owner)])].filter((o) => o !== 'Owner' || decisionsWaiting.length);

// ---------- html ----------
const chip = (s) => `<span class="chip ${esc(s.toLowerCase().replace(/[^a-z]+/g, '-'))}">${esc(s)}</span>`;
const taskLine = (t) => `<li><strong>${esc(t.id)}</strong> ${inline(t.title)}${t.waitingOn.length ? ` <span class="muted">(waits for ${t.waitingOn.map(esc).join(', ')})</span>` : ''}</li>`;

function agentCard(a) {
  const mine = tasks.filter((t) => t.owner === a || (a === 'PCA' && t.owner.startsWith('PCA')));
  if (a.startsWith('PCA-')) return '';
  const active = mine.filter((t) => t.status === 'in progress' || t.status === 'review');
  const ready = mine.filter((t) => t.ready);
  const waiting = mine.filter((t) => t.status === 'todo' && !t.ready);
  const h = handovers[a];
  const wt = branchInfo.find((b) => b.role === a);
  const sessionState = a === 'Owner' ? 'Decisions only you can make' : h ? `Handover ${esc(h.updated)} (${esc(h.src)})` : 'No session started yet';
  const parts = [];
  if (a === 'Owner') parts.push(`<h4>Waiting for your decision</h4><ul>${decisionsWaiting.map((d) => `<li>${inline(d)}</li>`).join('')}</ul>`);
  if (h?.ready.length) parts.push(`<h4>Ready for merge</h4><ul>${h.ready.map((d) => `<li>${inline(d)}</li>`).join('')}</ul>`);
  if (active.length) parts.push(`<h4>In progress</h4><ul>${active.map(taskLine).join('')}</ul>`);
  if (ready.length) parts.push(`<h4>Can start now</h4><ul>${ready.map(taskLine).join('')}</ul>`);
  if (h?.next.length) parts.push(`<h4>Next steps (from its handover)</h4><ol>${h.next.slice(0, 5).map((d) => `<li>${inline(d)}</li>`).join('')}</ol>`);
  if (followUps[a]?.length) parts.push(`<h4>Follow-ups noted by the MCA</h4><ul>${followUps[a].map((d) => `<li>${inline(d)}</li>`).join('')}</ul>`);
  if (waiting.length) parts.push(`<h4>Waiting on others</h4><ul>${waiting.map(taskLine).join('')}</ul>`);
  if (!parts.length) parts.push('<p class="muted">Nothing open.</p>');
  return `<article class="card"><header><h3>${esc(a)}</h3><span class="muted">${sessionState}${wt && wt.ahead ? ` · branch ${esc(wt.name)} is ${wt.ahead} ahead` : ''}</span></header>${parts.join('')}</article>`;
}

const pcaTasks = tasks.filter((t) => t.owner.startsWith('PCA-'));
const pcaCard = pcaTasks.length
  ? `<article class="card"><header><h3>PCA (one per plugin)</h3><span class="muted">Not started: wait for the plugin design pattern (T-016)</span></header><ul>${pcaTasks.map((t) => `<li><strong>${esc(t.id)}</strong> ${esc(t.owner)} ${chip(t.status)}</li>`).join('')}</ul></article>`
  : '';

const groups = [...new Set(tasks.map((t) => t.group))];
const taskTable = groups.map((g) => `
  <div class="group"><h3>${esc(g)}</h3>
  <table class="data"><thead><tr><th>Id</th><th>Task</th><th>Owner</th><th>Status</th><th>Waits for</th><th>Notes</th></tr></thead><tbody>
  ${tasks.filter((t) => t.group === g).map((t) => `<tr data-open="${t.open}"><td><strong>${esc(t.id)}</strong></td><td>${inline(t.title)}</td><td>${esc(t.owner)}</td><td>${chip(t.ready ? 'ready' : t.status)}</td><td>${t.waitingOn.map(esc).join(', ') || '–'}</td><td>${inline(t.notes)}</td></tr>`).join('')}
  </tbody></table></div>`).join('');

const adrTable = `<table class="data"><thead><tr><th>Id</th><th>Decision</th><th>Status</th><th>Date</th></tr></thead><tbody>${adrs.map((a) => `<tr data-open="${!/^accepted/i.test(a.status)}"><td><a href="../../docs/adr/${esc(a.file)}"><strong>${esc(a.id)}</strong></a></td><td>${inline(a.title)}</td><td>${chip(a.status)}</td><td>${esc(a.date)}</td></tr>`).join('')}</tbody></table>`;

const crTable = crs.length
  ? `<table class="data"><thead><tr><th>Id</th><th>Title</th><th>By</th><th>Date</th><th>Status</th><th>Decision</th></tr></thead><tbody>${crs.map((c) => `<tr data-open="${!/approved|rejected|withdrawn/i.test(c.status)}"><td><a href="../../docs/change-requests/${esc(c.file)}"><strong>${esc(c.id)}</strong></a></td><td>${inline(c.title)}</td><td>${esc(c.by)}</td><td>${esc(c.date)}</td><td>${chip(c.status)}</td><td>${c.decision.startsWith('(') ? '–' : inline(c.decision)}</td></tr>`).join('')}</tbody></table>`
  : '<p class="muted">No change requests.</p>';

const spikeTable = `<table class="data"><thead><tr><th>Id</th><th>Question</th><th>Shapes</th><th>Task</th><th>Status</th></tr></thead><tbody>${spikes.map((s) => `<tr data-open="${s.status !== 'done'}"><td><strong>${esc(s.id)}</strong></td><td>${inline(s.question)}</td><td>${inline(s.shapes)}</td><td>${esc(s.task) || '–'}</td><td>${chip(s.status)}</td></tr>`).join('')}</tbody></table>`;

const mergeTable = `<table class="data"><thead><tr><th>Date</th><th>Branch</th><th>What</th><th>Tests</th></tr></thead><tbody>${mergeLog.map((r) => `<tr><td>${esc(r[0])}</td><td>${inline(r[1])}</td><td>${inline(r[2])}</td><td>${inline(r[3])}</td></tr>`).join('')}</tbody></table>`;

const branchTable = branchInfo.length
  ? `<table class="data"><thead><tr><th>Branch</th><th>Role</th><th>Commits ahead of main</th><th>Last commit</th></tr></thead><tbody>${branchInfo.map((b) => `<tr><td><code>${esc(b.name)}</code></td><td>${esc(b.role)}</td><td>${b.ahead}</td><td>${esc(b.last)}</td></tr>`).join('')}</tbody></table>`
  : '';

const nowSentence = `Setup is finished and the work is in milestone <strong>${inline(milestone)}</strong>. ${counts.done} of ${counts.total} tasks are done. ${counts.active} ${counts.active === 1 ? 'is' : 'are'} in progress or in review, ${counts.ready} can start right now, and ${counts.waiting} wait for something else. ${decisionsWaiting.length ? `<strong>${decisionsWaiting.length} decision${decisionsWaiting.length > 1 ? 's' : ''} wait for you.</strong>` : 'No decisions wait for you.'}`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>emc2 project overview</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--text:#1d232b;--muted:#5f6b7a;--line:#dde2e8;--accent:#2457a6;--done:#2e7d4f;--active:#a86a00;--ready:#2457a6;--wait:#6b7280;--blocked:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#14181d;--panel:#1c222a;--text:#e4e8ed;--muted:#97a3b3;--line:#303945;--accent:#7aa7e8;--done:#5cc486;--active:#e0a43c;--ready:#7aa7e8;--wait:#9aa3af;--blocked:#f2877f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:0 16px 64px}
header.top{padding:28px 0 8px}
h1{margin:0;font-size:26px}h2{margin:40px 0 12px;font-size:20px;border-bottom:1px solid var(--line);padding-bottom:6px}
h3{margin:0;font-size:16px}h4{margin:14px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.muted{color:var(--muted);font-size:13px}
nav{position:sticky;top:0;background:var(--bg);padding:8px 0;border-bottom:1px solid var(--line);z-index:5;display:flex;flex-wrap:wrap;gap:4px 16px}
nav a{color:var(--accent);text-decoration:none;font-size:14px}
a{color:var(--accent)}
.lead{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-top:12px;font-size:16px}
.bar{height:12px;border-radius:6px;background:var(--line);overflow:hidden;display:flex;margin:12px 0 4px}
.bar span{display:block;height:100%}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:12px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.tile b{display:block;font-size:24px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card header{display:flex;flex-direction:column;gap:2px}
.card ul,.card ol{margin:4px 0 0;padding-left:20px}.card li{margin:3px 0}
table.data{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:6px 0 18px}
table.data th,table.data td{text-align:left;vertical-align:top;padding:7px 10px;border-bottom:1px solid var(--line);font-size:14px}
table.data th{background:var(--bg);font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.tablewrap{overflow-x:auto}
code{font:12.5px ui-monospace,Consolas,monospace;background:var(--bg);padding:1px 4px;border-radius:4px}
.chip{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;border:1px solid currentColor;white-space:nowrap}
.chip.done,.chip.accepted,.chip.approved{color:var(--done)}
.chip.in-progress,.chip.review{color:var(--active)}
.chip.ready,.chip.proposed{color:var(--ready)}
.chip.todo,.chip.not-scheduled{color:var(--wait)}
.chip.blocked,.chip.rejected{color:var(--blocked)}
.filters{display:flex;gap:6px;margin:8px 0}
.filters button{border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:999px;padding:4px 14px;font:inherit;cursor:pointer}
.filters button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.hide-closed tr[data-open=false]{display:none}
footer{margin-top:48px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<main>
<header class="top"><h1>emc2 project overview</h1><div class="muted">Generated ${esc(today)} from <code>main</code> at ${esc(head)} · regenerate with <code>node tools/overview.mjs</code></div></header>
<nav><a href="#now">Where we are</a><a href="#next">Next steps per agent</a><a href="#tasks">Tasks (T-)</a><a href="#spikes">Spikes (S)</a><a href="#crs">Change requests (CR-)</a><a href="#adrs">Decisions (ADR-)</a><a href="#history">History</a></nav>

<section id="now"><h2>Where we are now</h2>
<div class="lead">${nowSentence}<div class="muted" style="margin-top:6px">Milestone goal: ${inline(milestoneGoal)}</div>
<div class="bar" title="${pct}% of tasks done"><span style="width:${(counts.done / counts.total) * 100}%;background:var(--done)"></span><span style="width:${(counts.active / counts.total) * 100}%;background:var(--active)"></span><span style="width:${(counts.ready / counts.total) * 100}%;background:var(--ready)"></span></div>
<div class="muted">${pct}% done · green done, amber in progress, blue ready to start</div></div>
<div class="tiles">
<div class="tile"><b>${counts.done}/${counts.total}</b>tasks done</div>
<div class="tile"><b>${counts.active}</b>in progress / review</div>
<div class="tile"><b>${counts.ready}</b>ready to start</div>
<div class="tile"><b>${counts.waiting}</b>waiting on others</div>
<div class="tile"><b>${openCrs.length}</b>open change requests</div>
<div class="tile"><b>${decisionsWaiting.length}</b>decisions for you</div>
<div class="tile"><b>${adrs.filter((a) => /^accepted/i.test(a.status)).length}/${adrs.length}</b>ADRs accepted</div>
<div class="tile"><b>${spikes.filter((s) => s.status === 'done').length}/${spikes.length}</b>spikes done</div>
</div>
<h4>Latest merges into main</h4>
<ul>${mergeLog.slice(0, 5).map((r) => `<li>${esc(r[0])} · ${inline(r[1])} · ${inline(r[2])}</li>`).join('')}</ul>
<p class="muted">${inline(setupLine)}</p>
</section>

<section id="next"><h2>Next steps, by agent</h2>
<div class="cards">${agentRows.map(agentCard).join('')}${pcaCard}</div>
</section>

<section id="tasks"><h2>Tasks (T-)</h2>
<div class="filters" data-target="tasks"><button aria-pressed="true" data-mode="open">Open</button><button aria-pressed="false" data-mode="all">All</button></div>
<div class="tablewrap hide-closed" id="tasks-body">${taskTable}</div>
</section>

<section id="spikes"><h2>Spikes (S)</h2>
<div class="tablewrap">${spikeTable}</div>
</section>

<section id="crs"><h2>Change requests (CR-)</h2>
<div class="tablewrap">${crTable}</div>
</section>

<section id="adrs"><h2>Decisions (ADR-)</h2>
<div class="tablewrap">${adrTable}</div>
</section>

<section id="history"><h2>History</h2>
<h3>Merges into main</h3><div class="tablewrap">${mergeTable}</div>
<h3>Branches</h3><div class="tablewrap">${branchTable}</div>
</section>

<footer>Source of truth: <code>docs/status.md</code>, <code>docs/adr/</code>, <code>docs/change-requests/</code>, <code>docs/handover/</code> and git. This page is generated and not committed. If it disagrees with those files, the files win.</footer>
</main>
<script>
function sync(){document.querySelectorAll('#tasks-body .group').forEach(function(g){g.style.display=(document.getElementById('tasks-body').classList.contains('hide-closed')&&!g.querySelector('tr[data-open=true]'))?'none':'';});}
sync();
document.querySelectorAll('.filters button').forEach(function(b){b.addEventListener('click',function(){
  var body=document.getElementById('tasks-body');
  body.classList.toggle('hide-closed',b.dataset.mode==='open');sync();
  b.parentNode.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed',x===b?'true':'false')});
});});
</script>
</body>
</html>
`;

mkdirSync(join(root, 'tools', 'out'), { recursive: true });
const out = join(root, 'tools', 'out', 'project-overview.html');
writeFileSync(out, html);
console.log(`Wrote ${out}`);
console.log(`${counts.done}/${counts.total} tasks done, ${counts.active} active, ${counts.ready} ready, ${openCrs.length} open CRs, ${decisionsWaiting.length} decisions waiting.`);
