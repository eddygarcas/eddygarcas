#!/usr/bin/env node
// Generates a theme-adaptive donut SVG of your most-used languages from the
// GitHub GraphQL API, aggregated across your public repositories.
//
// Env:
//   GH_USER   - GitHub login (required)
//   GH_TOKEN  - token with public repo read (GITHUB_TOKEN works for public repos)
//   IGNORE    - comma-separated language names to drop (case-insensitive)
//   TOP       - how many languages to show (default 8)
//   OUT       - output path (default langs.svg)

const USER = process.env.GH_USER;
const TOKEN = process.env.GH_TOKEN;
const IGNORE = new Set(
  (process.env.IGNORE || "css,scss,html,shell,c,c++")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
);
const TOP = parseInt(process.env.TOP || "8", 10);
const OUT = process.env.OUT || "langs.svg";

// Fallback palette for languages GitHub returns without a color.
const FALLBACK = ["#3572A5", "#f1e05a", "#00ADD8", "#701516", "#dea584",
                  "#2b7489", "#b07219", "#e34c26", "#563d7c", "#89e051"];

const QUERY = `
query($login:String!, $after:String){
  user(login:$login){
    repositories(first:100, after:$after, ownerAffiliations:OWNER, isFork:false){
      pageInfo{ hasNextPage endCursor }
      nodes{
        languages(first:20, orderBy:{field:SIZE, direction:DESC}){
          edges{ size node{ name color } }
        }
      }
    }
  }
}`;

async function fetchLanguages() {
  const totals = new Map(); // name -> { size, color }
  let after = null, hasNext = true;
  while (hasNext) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "langs-donut-generator",
      },
      body: JSON.stringify({ query: QUERY, variables: { login: USER, after } }),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const repos = json.data.user.repositories;
    for (const repo of repos.nodes) {
      for (const edge of repo.languages.edges) {
        const key = edge.node.name;
        const prev = totals.get(key) || { size: 0, color: edge.node.color };
        prev.size += edge.size;
        totals.set(key, prev);
      }
    }
    hasNext = repos.pageInfo.hasNextPage;
    after = repos.pageInfo.endCursor;
  }
  return totals;
}

function pickTop(totals) {
  const list = [...totals.entries()]
    .filter(([name]) => !IGNORE.has(name.toLowerCase()))
    .map(([name, v]) => ({ name, size: v.size, color: v.color }))
    .sort((a, b) => b.size - a.size)
    .slice(0, TOP);
  const sum = list.reduce((s, l) => s + l.size, 0) || 1;
  list.forEach((l, i) => {
    l.pct = (l.size / sum) * 100;
    if (!l.color) l.color = FALLBACK[i % FALLBACK.length];
  });
  return list;
}

function renderSVG(langs) {
  // Layout
  const W = 480, H = 40 + Math.max(langs.length * 26, 220);
  const cx = 130, cy = H / 2, r = 82, sw = 40;         // donut geometry
  const C = 2 * Math.PI * r;
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Donut segments via stroke-dasharray. Group rotated -90deg => starts at top,
  // segments drawn clockwise. gap adds a hairline between slices.
  const gap = 0.6; // degrees-ish, in circumference units
  let acc = 0;
  const segs = langs.map(l => {
    const frac = l.pct / 100;
    const seg = Math.max(frac * C - gap, 0.5);
    const dash = `${seg} ${C - seg}`;
    const offset = -acc * C;
    acc += frac;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${l.color}" stroke-width="${sw}"
      stroke-dasharray="${dash}" stroke-dashoffset="${offset.toFixed(2)}"/>`;
  }).join("\n");

  // Legend (right side): swatch + name + percentage
  const lx = 250, top = cy - (langs.length * 26) / 2 + 8;
  const legend = langs.map((l, i) => {
    const y = top + i * 26;
    return `<g>
      <rect x="${lx}" y="${y - 11}" width="13" height="13" rx="3" fill="${l.color}"/>
      <text x="${lx + 22}" y="${y}" class="name">${esc(l.name)}</text>
      <text x="${W - 20}" y="${y}" class="pct" text-anchor="end">${l.pct.toFixed(1)}%</text>
    </g>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Most used languages">
  <style>
    :root { --text:#1f2328; --muted:#59636e; --stroke:#d1d9e0; }
    @media (prefers-color-scheme: dark) {
      :root { --text:#e6edf3; --muted:#8b949e; --stroke:#30363d; }
    }
    .title { font: 600 16px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: var(--text); }
    .name  { font: 400 14px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: var(--text); }
    .pct   { font: 400 13px 'Segoe UI', Ubuntu, Helvetica, Arial, sans-serif; fill: var(--muted); }
    .ring-bg { stroke: var(--stroke); }
  </style>
  <text x="${cx}" y="26" text-anchor="middle" class="title">Most Used Languages</text>
  <g transform="rotate(-90 ${cx} ${cy})">
    <circle class="ring-bg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${sw}"/>
    ${segs}
  </g>
  ${legend}
</svg>`;
}

async function main() {
  // TEST mode: render with mock data, no network.
  if (process.env.MOCK) {
    const mock = [
      { name: "Ruby", size: 0, color: "#701516" },
      { name: "TypeScript", size: 0, color: "#3178c6" },
      { name: "Go", size: 0, color: "#00ADD8" },
      { name: "Zig", size: 0, color: "#ec915c" },
      { name: "Rust", size: 0, color: "#dea584" },
      { name: "JavaScript", size: 0, color: "#f1e05a" },
      { name: "Python", size: 0, color: "#3572A5" },
      { name: "Shell", size: 0, color: "#89e051" },
    ];
    const pcts = [34.2, 22.7, 15.1, 9.8, 7.3, 5.0, 3.4, 2.5];
    mock.forEach((m, i) => (m.pct = pcts[i]));
    require("fs").writeFileSync(OUT, renderSVG(mock));
    console.log(`wrote ${OUT} (mock)`);
    return;
  }
  if (!USER || !TOKEN) throw new Error("GH_USER and GH_TOKEN are required");
  const totals = await fetchLanguages();
  const langs = pickTop(totals);
  require("fs").writeFileSync(OUT, renderSVG(langs));
  console.log(`wrote ${OUT}: ${langs.map(l => `${l.name} ${l.pct.toFixed(1)}%`).join(", ")}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
