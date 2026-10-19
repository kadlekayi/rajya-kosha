/* ============ Rajya Kosha — game data & logic ============ */

const STATES = [
  { id: "mh", name: "Maharashtra", desc: "Industrial powerhouse, high own tax revenue", rev: 400000, gsdp: 3500000, pop: 12.6, literacy: 84.4, imr: 16.0, le: 73.5, lfpr: 53.0 },
  { id: "up", name: "Uttar Pradesh", desc: "Large population, high central transfers", rev: 290000, gsdp: 2200000, pop: 24.1, literacy: 67.7, imr: 38.0, le: 65.0, lfpr: 44.0 },
  { id: "tn", name: "Tamil Nadu", desc: "Manufacturing base, strong GST collections", rev: 230000, gsdp: 1800000, pop: 7.7, literacy: 82.9, imr: 15.0, le: 72.5, lfpr: 51.5 },
  { id: "ka", name: "Karnataka", desc: "IT/services economy, high SGST", rev: 220000, gsdp: 1700000, pop: 6.8, literacy: 77.4, imr: 19.0, le: 70.5, lfpr: 54.0 },
  { id: "wb", name: "West Bengal", desc: "Transfer-dependent, large welfare agenda", rev: 200000, gsdp: 1400000, pop: 9.9, literacy: 76.6, imr: 22.0, le: 71.0, lfpr: 42.5 },
  { id: "br", name: "Bihar", desc: "Low own revenue, big devolution share", rev: 140000, gsdp: 650000, pop: 12.7, literacy: 61.8, imr: 46.0, le: 66.5, lfpr: 36.0 },
];

/* Revenue split mirrors real state receipts structure roughly:
   own tax ~55%, share in central taxes ~25%, non-tax + grants ~20%. */
const REVENUE_SPLIT = {
  ownTax: 0.55,
  centralShare: 0.25,
  grantsNonTax: 0.20,
};

const SECTORS = [
  { id: "education",     name: "Education",       why: "Schools, teachers, mid-day meals. Drives literacy & employability." },
  { id: "health",        name: "Health",          why: "PHCs, insurance schemes. Drives infant mortality & life expectancy." },
  { id: "infrastructure",name: "Infrastructure",  why: "Roads, power, transit. Strong growth multiplier, prone to underspend." },
  { id: "agriculture",   name: "Agriculture",     why: "Irrigation, crop support. Big in rural states." },
  { id: "welfare",      name: "Welfare schemes",  why: "Pensions, housing, food support. Immediate approval, supports LFPR." },
  { id: "administration",name: "Administration & policing", why: "Salaries, law and order. Keeps the state running." },
];
const SECTOR_IDS = SECTORS.map(s => s.id);

/* Per-sector spending tendency vs Budget Estimate: [mean, sd].
   Capital outlay slips most; salaries pay out fully. */
const SPEND_TENDENCY = {
  education: [0.90, 0.05],
  health: [0.88, 0.06],
  infrastructure: [0.80, 0.08],
  agriculture: [0.87, 0.07],
  welfare: [0.95, 0.03],
  administration: [0.97, 0.02],
};

/* Revenue realisation vs BE: [mean, sd] */
const REV_TENDENCY = [0.96, 0.06];
const CAG_REVISION_SD = 0.015;

/* Shock events, weighted. Effects reference the prototype model. */
const EVENTS = [
  { w: 3, key: "normal",   title: "Normal year", text: "No major shocks. A good year for the long view.", effects: {} },
  { w: 2, key: "drought",  title: "Drought / weak monsoon", text: "Farm incomes fall; agriculture spending costs more, growth dips.",
    effects: { growth: -1.5, spendUp: { agriculture: 1.2, welfare: 1.15 }, approval: -4, approvalBoost: ["welfare", "agriculture"] } },
  { w: 2, key: "flood",    title: "Cyclone / floods", text: "Damage to roads and homes; relief spending is unavoidable.",
    effects: { growth: -1.0, spendUp: { infrastructure: 1.3 }, forcedRelief: 0.03, approval: -6, approvalBoost: ["welfare"] } },
  { w: 1, key: "heatwave", title: "Extreme heatwave", text: "Heat hits labour productivity and rural demand.",
    effects: { growth: -0.8, lfprHit: -0.4, approval: -3 } },
  { w: 1, key: "pandemic",  title: "Pandemic", text: "Health spending surges, economic activity collapses for months.",
    effects: { growth: -4.0, spendUp: { health: 1.6, welfare: 1.4 }, approval: -8, approvalBoost: ["health"] } },
  { w: 1, key: "tradewar", title: "Trade war / global slowdown", text: "Exports slump; SGST and own taxes undershoot BE sharply.",
    effects: { revMult: 0.90, growth: -1.5 } },
  { w: 1, key: "policy",   title: "Central policy change", text: "The Centre trims a large CSS scheme; your grants fall.",
    effects: { revMult: 0.95, growth: -0.5, approval: -2 } },
  { w: 1, key: "gstwindfall", title: "GST windfall", text: "Consumption booms; collections beat estimates.",
    effects: { revMult: 1.07, growth: 0.5 } },
  { w: 1, key: "election", title: "Election year", text: "Voters watch closely. Welfare and health count extra for approval.",
    effects: { approvalBoost: ["welfare", "health"], approvalMult: 1.3 } },
];

/* ---------- helpers ---------- */
let G = null;
const $ = (id) => document.getElementById(id);
const show = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
};
const cr = (n) => "₹" + Math.round(n).toLocaleString("en-IN") + " cr";
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const gauss = (mean, sd) => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function drawEvent() {
  const total = EVENTS.reduce((a, e) => a + e.w, 0);
  let r = Math.random() * total;
  for (const e of EVENTS) {
    r -= e.w;
    if (r <= 0) return e;
  }
  return EVENTS[0];
}

/* ---------- HDI sub-model (ported from prototype) ---------- */
function projectHDI(g, alloc) {
  const pop = g.state.pop * 100;
  const eduPc = alloc.education / pop;
  const healthPc = alloc.health / pop;

  let litGain = 2.5 * (eduPc / 40) / (1 + eduPc / 150) - 0.15;
  litGain = Math.max(-0.5, litGain);
  const literacy = clamp(g.literacy + litGain, 40, 99);

  let imrDrop = 4.0 * (healthPc / 30) / (1 + healthPc / 100) - 0.2;
  imrDrop = Math.max(-1.0, imrDrop);
  const imr = Math.max(8, g.imr - imrDrop);

  const le = 85.0 - 0.35 * imr;

  let lfprDelta = 0.35 * (eduPc / 40) + 0.15 * (alloc.welfare / pop / 30) - 0.1;
  lfprDelta += 0.05 * (g.growth - 5.0);
  const lfpr = clamp(g.lfpr + lfprDelta, 20, 75);

  const gdppc = g.gsdp * 1e7 / (g.state.pop * 1e7);
  let incIdx = (Math.log(gdppc) - Math.log(20000)) / (Math.log(400000) - Math.log(20000));
  incIdx = clamp(incIdx, 0, 1);

  const eduIdx = literacy / 100 * 0.6 + lfpr / 100 * 0.4;
  const healthIdx = (le - 25) / 60;
  const hdi = Math.cbrt(incIdx * eduIdx * healthIdx);

  return { literacy, imr, le, lfpr, hdi, litGain, imrDrop };
}

/* ---------- mode select ---------- */
document.querySelectorAll("[data-mode]").forEach(b =>
  b.addEventListener("click", () => (b.dataset.mode === "sim" ? showStateSelect() : startQuiz()))
);
document.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", () => show("screen-start")));

/* ---------- state select ---------- */
function showStateSelect() {
  const list = $("state-list");
  list.innerHTML = "";
  STATES.forEach(st => {
    const d = document.createElement("div");
    d.className = "state-card";
    d.innerHTML = `<h3>${st.name}</h3><p>${st.desc}</p><span class="rev">Revenue ≈ ${cr(st.rev)}</span>`;
    d.addEventListener("click", () => startSim(st));
    list.appendChild(d);
  });
  show("screen-state");
}

/* ---------- simulator ---------- */
function startSim(state) {
  G = {
    state,
    year: 1,
    totalYears: 5,
    baseRev: state.rev,
    rev: state.rev,
    available: state.rev,
    gsdp: state.gsdp,
    growth: 6.0,
    approval: 55,
    deficit: 3.0,
    literacy: state.literacy,
    imr: state.imr,
    le: state.le,
    lfpr: state.lfpr,
    pendingCag: [],
    lastProjection: null,
    usedLevy: 0,
    usedBorrow: 0,
    log: [],
    badges: [],
  };
  newYear();
}

function newYear() {
  G.usedLevy = 0;
  G.usedBorrow = 0;
  G.event = drawEvent();

  // CAG actuals for past years land now and adjust the pool
  let cagNotes = [];
  while (G.pendingCag.length && G.pendingCag[0].readyYear <= G.year) {
    const rep = G.pendingCag.shift();
    const gap = rep.revActual - rep.revBe;
    if (gap < 0) {
      G.available += gap;
      G.approval -= 2;
      G.log.push(`Year ${rep.year} CAG: receipts fell short of BE by ${cr(-gap)}; your pool absorbs it.`);
    } else {
      G.available += 0.5 * gap;
      G.log.push(`Year ${rep.year} CAG: receipts beat BE by ${cr(gap)}.`);
    }
    cagNotes.push(rep);
  }

  $("sim-year").textContent = G.year + " / " + G.totalYears;
  $("sim-state").textContent = G.state.name;
  $("sim-revenue").textContent = cr(G.available);
  $("sim-deficit").textContent = G.deficit.toFixed(1) + "%";
  $("sim-growth").textContent = G.growth.toFixed(1) + "%";
  $("sim-approval").textContent = Math.round(G.approval) + "%";
  $("sim-hdi").textContent = (G.lastProjection ? G.lastProjection.hdi : baseHDI()).toFixed(3);

  $("event-title").textContent = `Year ${G.year} — ${G.event.title}`;
  $("event-text").textContent = G.event.text;

  const cagBox = $("cag-notes");
  if (cagNotes.length) {
    cagBox.hidden = false;
    cagBox.innerHTML = "<b>📋 CAG report" + (cagNotes.length > 1 ? "s" : "") + " out:</b><br>" +
      cagNotes.map(rep =>
        `Year ${rep.year}: budgeted receipts ${cr(rep.revBe)}, actual ${cr(rep.revActual)} · ` +
        `budgeted spend ${cr(rep.spendBe)}, actual ${cr(rep.spendRe)}` +
        (rep.underspend > 0 ? ` (underspent ${cr(rep.underspend)})` : "")
      ).join("<br>");
  } else {
    cagBox.hidden = true;
  }

  $("btn-levy").disabled = false;
  $("btn-borrow").disabled = false;
  buildSliders();
  show("screen-sim");
}

function baseHDI() {
  const gdppc = G.gsdp * 1e7 / (G.state.pop * 1e7);
  let incIdx = (Math.log(gdppc) - Math.log(20000)) / (Math.log(400000) - Math.log(20000));
  incIdx = clamp(incIdx, 0, 1);
  const eduIdx = G.literacy / 100 * 0.6 + G.lfpr / 100 * 0.4;
  const healthIdx = (G.le - 25) / 60;
  return Math.cbrt(incIdx * eduIdx * healthIdx);
}

function buildSliders() {
  const wrap = $("sliders");
  wrap.innerHTML = "";
  const pool = Math.round(G.available / 1000);
  $("budget-pool").textContent = cr(G.available);
  SECTORS.forEach(sec => {
    const div = document.createElement("div");
    div.className = "sector";
    div.innerHTML = `
      <div class="sector-row">
        <label>${sec.name}</label>
        <span class="amt" id="amt-${sec.id}">₹0</span>
      </div>
      <div class="why">${sec.why}</div>
      <input type="range" min="0" max="${Math.floor(pool * 0.6)}" value="0" step="1" data-sec="${sec.id}" />
    `;
    wrap.appendChild(div);
  });
  wrap.querySelectorAll("input[type=range]").forEach(inp => {
    inp.addEventListener("input", () => updateAllocLeft());
  });
  updateAllocLeft();
}

function currentAllocations() {
  const alloc = {};
  document.querySelectorAll("#sliders input[type=range]").forEach(inp => {
    alloc[inp.dataset.sec] = parseInt(inp.value, 10) * 1000;
  });
  return alloc;
}

function updateAllocLeft() {
  const alloc = currentAllocations();
  const spent = SECTOR_IDS.reduce((a, s) => a + alloc[s], 0);
  const left = G.available - spent;
  const el = $("alloc-left");
  el.textContent = (left >= 0 ? "Remaining: " : "Over by: ") + cr(Math.abs(left));
  el.classList.toggle("over", left < 0);
  SECTORS.forEach(s => ($("amt-" + s.id).textContent = cr(alloc[s.id])));

  // Live HDI projection, visible while allocating
  const proj = projectHDI(G, alloc);
  $("hdi-literacy").textContent = proj.literacy.toFixed(1) + "%";
  $("hdi-literacy-delta").textContent = (proj.litGain >= 0 ? "+" : "") + proj.litGain.toFixed(2);
  $("hdi-imr").textContent = proj.imr.toFixed(1);
  $("hdi-imr-delta").textContent = (proj.imrDrop >= 0 ? "−" : "+") + Math.abs(proj.imrDrop).toFixed(2);
  $("hdi-le").textContent = proj.le.toFixed(1) + " yrs";
  $("hdi-lfpr").textContent = proj.lfpr.toFixed(1) + "%";
  $("hdi-value").textContent = proj.hdi.toFixed(3);
  const hdiDelta = proj.hdi - baseHDI();
  const hdiDeltaEl = $("hdi-delta");
  hdiDeltaEl.textContent = (hdiDelta >= 0 ? "+" : "") + hdiDelta.toFixed(3);
  hdiDeltaEl.classList.toggle("neg", hdiDelta < 0);

  $("btn-allocate").disabled = left < 0;
}

$("btn-levy").addEventListener("click", () => {
  if (G.usedLevy >= 2) return;
  G.usedLevy++;
  G.available += 2000;
  G.approval -= 5;
  G.log.push("Levied an extra 'sin tax' on liquor.");
  refreshMoney();
});

$("btn-borrow").addEventListener("click", () => {
  if (G.usedBorrow >= 2) return;
  G.usedBorrow++;
  G.available += 5000;
  G.deficit += 1.0;
  G.log.push("Borrowed beyond the FRBM glide path (+₹5,000 cr).");
  refreshMoney();
});

function refreshMoney() {
  $("sim-revenue").textContent = cr(G.available);
  $("sim-approval").textContent = Math.round(G.approval) + "%";
  $("sim-deficit").textContent = G.deficit.toFixed(1) + "%";
  $("budget-pool").textContent = cr(G.available);
  updateAllocLeft();
  if (G.usedLevy >= 2) $("btn-levy").disabled = true;
  if (G.usedBorrow >= 2) $("btn-borrow").disabled = true;
}

$("btn-allocate").addEventListener("click", () => {
  resolveYear(currentAllocations());
});

/* ---------- year resolution (BE -> RE -> CAG) ---------- */
function resolveYear(alloc) {
  const sh = G.event.effects || {};

  // --- spending: Revised Estimate vs Budget Estimate ---
  const spendBe = SECTOR_IDS.reduce((a, s) => a + alloc[s], 0);
  const forced = (sh.forcedRelief || 0) * G.available;
  let reSpend = 0;
  const actuals = {};
  SECTOR_IDS.forEach(sec => {
    const [mean, sd] = SPEND_TENDENCY[sec];
    const mult = (sh.spendUp && sh.spendUp[sec]) || 1;
    const f = Math.max(0.5, gauss(mean, sd)) * mult;
    actuals[sec] = alloc[sec] * f;
    reSpend += actuals[sec];
  });
  reSpend += forced;
  const underspend = spendBe - (reSpend - forced);

  // --- revenue: actual collections vs BE ---
  const revMult = sh.revMult || 1;
  const realF = Math.max(0.70, gauss(...REV_TENDENCY)) * revMult;
  const revRe = G.available * realF;
  let revCag = revRe * (1 + gauss(0, CAG_REVISION_SD));
  revCag = Math.max(revCag, 0.75 * G.available);

  // --- growth ---
  let gdelta = 0;
  const shares = {};
  SECTOR_IDS.forEach(s => { shares[s] = alloc[s] / Math.max(G.available, 1); });
  gdelta += 10 * shares.infrastructure;
  gdelta += 3.6 * shares.education;
  gdelta += 2.5 * shares.agriculture;
  gdelta += 0.9 * shares.health;
  gdelta += 0.4 * shares.welfare;
  gdelta += 0.4 * shares.administration;
  gdelta += (sh.growth || 0);
  G.growth = Math.max(0.5, G.growth * 0.6 + (4 + gdelta) * 0.4);

  // --- HDI outcomes realise ---
  const proj = projectHDI(G, alloc);
  if (sh.lfprHit) proj.lfpr = clamp(proj.lfpr + sh.lfprHit, 20, 75);
  G.literacy = proj.literacy;
  G.imr = proj.imr;
  G.le = proj.le;
  G.lfpr = proj.lfpr;
  G.lastProjection = proj;

  // --- approval ---
  let adelta = 40 * shares.welfare + 30 * shares.health
             + 20 * shares.education + 20 * shares.agriculture
             + 12 * shares.infrastructure;
  adelta += (sh.approval || 0);
  (sh.approvalBoost || []).forEach(sec => { adelta += shares[sec] * 5; });
  if (sh.approvalMult) adelta *= sh.approvalMult;
  if (proj.imrDrop < 0) adelta -= 4;   // infant mortality rose on your watch
  if (proj.litGain < 0.3) adelta -= 2;  // schools visibly neglected
  if (G.deficit > 3) adelta -= (G.deficit - 3) * 3;
  G.approval = clamp(G.approval * 0.75 + (G.approval + adelta) * 0.25, 0, 100);

  // --- deficit on GSDP ---
  G.gsdp *= (1 + G.growth / 100);
  G.deficit = Math.max(0, (reSpend - revRe) / Math.max(G.gsdp, 1) * 100);

  // --- queue CAG report, 2-year lag ---
  G.pendingCag.push({
    year: G.year,
    readyYear: G.year + 2,
    revBe: G.available, revRe, revActual: revCag,
    spendBe, spendRe: reSpend, underspend,
  });

  // --- next year's receipts ---
  G.rev = G.available * (1 + G.growth / 100) * Math.pow(realF, 0.3);
  G.available = G.rev;

  // --- outcome narrative ---
  const lines = [];
  lines.push(row("Budget (BE)", cr(spendBe)));
  lines.push(row("Actual spend (RE)", cr(reSpend) + (underspend > 0 ? ` (−${cr(underspend)} vs BE)` : ""), underspend > 0 ? "" : "up"));
  lines.push(row("Receipts (RE)", cr(revRe) + (realF < 1 ? " — missed BE" : ""), realF < 1 ? "down" : "up"));
  lines.push(row("GSDP growth", G.growth.toFixed(1) + "%", "up"));
  lines.push(row("Public approval", Math.round(G.approval) + "%", G.approval >= 50 ? "up" : "down"));
  lines.push(row("Fiscal deficit", G.deficit.toFixed(1) + "% of GSDP", G.deficit <= 3 ? "up" : "down"));
  lines.push(row("Literacy", proj.literacy.toFixed(1) + "%", proj.litGain >= 0.3 ? "up" : "down"));
  lines.push(row("Infant mortality", proj.imr.toFixed(1) + " per 1,000", proj.imrDrop >= 0.5 ? "up" : "down"));
  lines.push(row("Life expectancy", proj.le.toFixed(1) + " yrs", "up"));
  lines.push(row("LFPR", proj.lfpr.toFixed(1) + "%", proj.lfpr >= G.lfpr ? "up" : "down"));
  lines.push(row("HDI", proj.hdi.toFixed(3), proj.hdi >= baseHDI() ? "up" : "down"));
  lines.push(row("Next year's BE receipts", cr(G.rev), "up"));
  if (G.deficit > 3) lines.push(`<p class="verdict bad">⚠️ Deficit above 3% — markets and the RBI will frown.</p>`);
  if (G.approval < 40) lines.push(`<p class="verdict bad">😡 Voters are unhappy.</p>`);
  if (proj.litGain < 0.3) lines.push(`<p class="verdict bad">🏫 Education spending too low — literacy gains stalled.</p>`);
  if (proj.imrDrop < 0) lines.push(`<p class="verdict bad">🏥 Health spending too low — infant mortality worsened.</p>`);
  if (G.approval >= 60 && G.deficit <= 3 && proj.hdi >= 0.6) lines.push(`<p class="verdict good">✅ A disciplined, popular, and human-development friendly budget.</p>`);

  $("res-year").textContent = G.year;
  $("res-body").innerHTML = lines.join("");
  show("screen-result");
}

const row = (label, val, cls) =>
  `<div class="res-line"><span>${label}</span><span class="delta ${cls || ""}">${val}</span></div>`;

$("btn-next-year").addEventListener("click", () => {
  G.year++;
  if (G.year > G.totalYears) finishSim();
  else newYear();
});

function finishSim() {
  const proj = G.lastProjection || { hdi: baseHDI() };
  let score = Math.round(
    G.approval * 1.0 + G.growth * 6
    - Math.max(0, G.deficit - 3) * 12
    + (proj.hdi - 0.5) * 400
  );
  score = Math.max(0, score);
  let title, verdictClass;
  if (score > 180) { title = "🏆 Fiscal Star"; verdictClass = "good"; }
  else if (score > 140) { title = "💪 Steady Hand"; verdictClass = "good"; }
  else if (score > 100) { title = "🙂 Muddled Through"; verdictClass = ""; }
  else { title = "💀 Austerity and Anger"; verdictClass = "bad"; }

  if (G.deficit <= 3 && G.approval >= 55) G.badges.push("FRBM discipline");
  if (G.growth >= 7) G.badges.push("Growth engine");
  if (G.approval >= 65) G.badges.push("People's minister");
  if (proj.hdi >= 0.7) G.badges.push("Human development champion");
  if (proj.literacy - G.state.literacy >= 4) G.badges.push("Shiksha hero");

  $("final-body").innerHTML = `
    <p class="verdict ${verdictClass}">${title} — score ${score}</p>
    ${row("Final HDI", proj.hdi.toFixed(3))}
    ${row("Literacy", G.literacy.toFixed(1) + "% (from " + G.state.literacy + "%)")}
    ${row("Infant mortality", G.imr.toFixed(1) + " (from " + G.state.imr + ")")}
    ${row("Life expectancy", G.le.toFixed(1) + " yrs")}
    ${row("LFPR", G.lfpr.toFixed(1) + "%")}
    ${row("Final growth", G.growth.toFixed(1) + "%")}
    ${row("Final approval", Math.round(G.approval) + "%")}
    ${row("Final deficit", G.deficit.toFixed(1) + "%")}
    ${row("Revenue growth over term", "+" + Math.round((G.rev / G.baseRev - 1) * 100) + "%")}
    <p>${G.log.length ? "Your term in brief:" : ""}</p>
    <ul>${G.log.map(l => `<li>${l}</li>`).join("")}</ul>
    <p>${G.badges.length ? G.badges.map(b => `<span class="badge gold">${b}</span>`).join("") : '<span class="badge">No badges this term</span>'}</p>
  `;
  show("screen-final");
}

/* ---------- quiz ---------- */
const QUIZ = [
  {
    q: "Which tax is the largest source of states' OWN tax revenue in India?",
    opts: ["Stamp duty", "State GST (SGST)", "Professional tax", "Entertainment tax"],
    a: 1,
    why: "SGST is the biggest own-tax source for most states. Liquor excise and stamp duty follow.",
  },
  {
    q: "What does the Finance Commission decide?",
    opts: ["GST rates for each state", "How tax revenue is shared between the Union and states", "State employees' salaries", "Railway budgets"],
    a: 1,
    why: "Every 5 years the Finance Commission recommends the vertical (Union–state) and horizontal (state-to-state) devolution of taxes.",
  },
  {
    q: "What is a state's 'revenue deficit'?",
    opts: ["Total expenditure minus total revenue", "Revenue expenditure minus revenue receipts", "Borrowing minus interest paid", "Capital expenditure minus capital receipts"],
    a: 1,
    why: "A revenue deficit means the state is borrowing to fund day-to-day spending — a sign of fiscal stress.",
  },
  {
    q: "Under the current FRBM-style framework, states are generally advised to keep fiscal deficit around…",
    opts: ["1% of GSDP", "3% of GSDP", "6% of GSDP", "10% of GSDP"],
    a: 1,
    why: "3% of GSDP is the standard state-level fiscal-deficit target, with extra borrowing room tied to reforms (e.g., power-sector reforms).",
  },
  {
    q: "What is 'compensation cess' related to GST about?",
    opts: ["Compensating states for SGST revenue lost by demonetisation", "Compensating states for revenue shortfalls during GST transition", "Paying for land acquisition", "Funding the Finance Commission"],
    a: 1,
    why: "A cess was created to compensate states for 5 years for any GST revenue growth below 14% per annum during the transition.",
  },
  {
    q: "Which of these is a CAPITAL receipt for a state?",
    opts: ["State GST collections", "Borrowing from the market", "Grants from the Centre for a scheme", "Interest earned on investments"],
    a: 1,
    why: "Loans raised are capital receipts. They fund capital expenditure but add to debt and future interest burdens.",
  },
  {
    q: "What is horizontal devolution?",
    opts: ["Sharing revenue between the Union and states", "Distribution among states based on criteria like population, income distance, forest cover", "Splitting revenue between districts", "Dividing SGST and CGST"],
    a: 1,
    why: "The Finance Commission uses formulas (population, income distance, area, forest & ecology, demographic performance) to distribute among states.",
  },
  {
    q: "Why do states want 'borrowed' capital expenditure over borrowed revenue expenditure?",
    opts: ["Capital spending is cheaper", "Capital assets boost future growth and revenue, funding the debt", "Revenue expenditure is illegal", "The Centre pays for capital projects always"],
    a: 1,
    why: "Borrowing for productive capital assets creates future returns; borrowing for salaries or subsidies does not.",
  },
  {
    q: "What is a 'cess' as opposed to a 'tax'?",
    opts: ["A cess is optional for citizens", "A cess is earmarked for a specific purpose and not shareable with states by default", "A cess applies only to companies", "A cess is set by state governments"],
    a: 1,
    why: "Cesses are hypothecated for specific purposes. Cesses and surcharges are largely kept by the Union and not part of the divisible pool.",
  },
  {
    q: "Which body recommends principles governing grants-in-aid to states?",
    opts: ["NITI Aayog", "Finance Commission (Article 275)", "RBI", "GST Council"],
    a: 1,
    why: "Article 275 empowers Parliament to provide grants-in-aid to states on the Finance Commission's recommendation.",
  },
  {
    q: "In Indian budget documents, what does BE → RE → Actuals refer to?",
    opts: ["Basic Estimate, Revised Estimate, Actuals", "Budget Estimate, Revised Estimate, Actuals (audited by CAG)", "Balance Estimate, Revenue Estimate, Actuals", "Budget Expenditure, Revenue Expenditure, Actuals"],
    a: 1,
    why: "BE is what you budget at year start, RE is the mid-year revision, and Actuals are the CAG-audited final figures that arrive with a lag.",
  },
  {
    q: "Why do state budgets typically underspend against Budget Estimates?",
    opts: ["States hoard cash deliberately", "Capital projects slip, procurement delays, and schemes scale up slower than planned", "The Centre cancels schemes mid-year", "Underspending is legally required"],
    a: 1,
    why: "Capital outlay is the biggest source of underspend; salaries and interest always pay out fully.",
  },
  {
    q: "The HDI education component combines literacy (or expected/mean years of schooling) with…",
    opts: ["Education budget as % of GSDP", "School enrolment only", "Labour force participation related indicators in this game's stylised version", "Number of universities"],
    a: 2,
    why: "In the real UNDP HDI it's mean and expected years of schooling; this game stylises it with literacy and LFPR (employability).",
  },
];

let Q = null;
function startQuiz() {
  Q = { order: shuffle(QUIZ.map((_, i) => i)), idx: 0, score: 0, answered: false };
  renderQuizQuestion();
  show("screen-quiz");
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function renderQuizQuestion() {
  const body = $("quiz-body");
  $("btn-quiz-next").disabled = true;
  if (Q.idx >= Q.order.length) {
    const pct = Math.round((Q.score / Q.order.length) * 100);
    body.innerHTML = `<h3>Quiz complete!</h3>
      <p class="verdict ${pct >= 70 ? "good" : pct >= 40 ? "" : "bad"}">You scored ${Q.score}/${Q.order.length} (${pct}%)</p>
      <p>${pct >= 80 ? "Outstanding — you could draft a state budget!" : pct >= 50 ? "Solid grasp of the basics." : "Worth another try — state finance is full of surprises."}</p>`;
    $("btn-quiz-next").textContent = "Restart quiz";
    $("btn-quiz-next").disabled = false;
    Q.answered = true;
    return;
  }
  const q = QUIZ[Q.order[Q.idx]];
  $("quiz-meta").textContent = `Question ${Q.idx + 1} of ${Q.order.length} · Score: ${Q.score}`;
  body.innerHTML = `<div class="q-question">${q.q}</div>` +
    q.opts.map((o, i) => `<button class="q-option" data-i="${i}">${o}</button>`).join("") +
    `<div class="q-explain" id="q-explain" hidden>${q.why}</div>`;
  body.querySelectorAll(".q-option").forEach(btn => {
    btn.addEventListener("click", () => {
      if (Q.answered) return;
      Q.answered = true;
      const i = +btn.dataset.i;
      if (i === q.a) { btn.classList.add("correct"); Q.score++; }
      else { btn.classList.add("wrong"); body.querySelectorAll(".q-option")[q.a].classList.add("correct"); }
      $("q-explain").hidden = false;
      $("btn-quiz-next").disabled = false;
    });
  });
  $("btn-quiz-next").textContent = "Next →";
}
$("btn-quiz-next").addEventListener("click", () => {
  if (Q.idx >= Q.order.length) { startQuiz(); return; }
  Q.idx++; Q.answered = false;
  renderQuizQuestion();
});

/* init */
show("screen-start");
