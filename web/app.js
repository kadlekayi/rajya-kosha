/* ============ Rajya Kosha — game data & logic ============ */

const STATES = [
  { id: "mh", name: "Maharashtra", desc: "Industrial powerhouse, high own tax revenue", rev: 400000 },
  { id: "up", name: "Uttar Pradesh", desc: "Large population, high central transfers", rev: 290000 },
  { id: "tn", name: "Tamil Nadu", desc: "Manufacturing base, strong GST collections", rev: 230000 },
  { id: "ka", name: "Karnataka", desc: "IT/services economy, high SGST", rev: 220000 },
  { id: "wb", name: "West Bengal", desc: "Transfer-dependent, large welfare agenda", rev: 200000 },
  { id: "br", name: "Bihar", desc: "Low own revenue, big devolution share", rev: 140000 },
];

/* Revenue split mirrors real state receipts structure roughly:
   own tax ~55%, share in central taxes ~25%, non-tax + grants ~20%. */
const REVENUE_SPLIT = {
  ownTax: 0.55,       // SGST, excise on liquor, stamp duty, vehicle tax
  centralShare: 0.25, // Finance Commission devolution
  grantsNonTax: 0.20, // central grants, non-tax revenue
};

const SECTORS = [
  { id: "edu",    name: "Education",       why: "Schools, teachers, mid-day meals. Drives long-run growth & approval.", growth: 0.06, approval: 2.0 },
  { id: "health", name: "Health",          why: "PHCs, insurance schemes. High approval impact.", growth: 0.03, approval: 2.5 },
  { id: "infra",  name: "Infrastructure",  why: "Roads, power, urban transit. Strong growth multiplier.", growth: 0.10, approval: 1.2 },
  { id: "agri",   name: "Agriculture",     why: "Irrigation, crop support. Big in rural states.", growth: 0.05, approval: 1.8 },
  { id: "welfare",name: "Welfare schemes", why: "Pensions, housing, food support. Immediate approval boost.", growth: 0.02, approval: 2.2 },
  { id: "admin",  name: "Administration & policing", why: "Salaries, law & order. Keeps the state running.", growth: 0.02, approval: 0.6 },
];

const EVENTS = [
  { title: "Drought year", text: "Weak monsoon hits farm incomes. Agriculture and welfare spending will matter more this year.", effects: { agri: 1.4, welfare: 1.2, growth: -1.5 } },
  { title: "Global slowdown", text: "Demand for exports falls. Your own tax collections may disappoint.", effects: { ownTaxMult: 0.92, growth: -1.0 } },
  { title: "Good GST collections", text: "Consumption is booming — SGST and share in GST are strong this year.", effects: { ownTaxMult: 1.08 } },
  { title: "Central grant for capital", text: "The Centre offers a tied grant for capital investment — if you allocate enough to infrastructure.", effects: { grant: 3000, needsInfra: 0.22 } },
  { title: "Election year", text: "Voters are watching closely. Welfare and health spending count extra for approval.", effects: { welfare: 1.3, health: 1.3, approvalMult: 1.3 } },
  { title: "Pay Commission arrears", text: "Government salary arrears are due. Administration costs are unavoidable and higher.", effects: { admin: 1.3 } },
  { title: "Disaster relief", text: "Floods damage roads and homes. Centre sends some aid, but you must spend too.", effects: { grant: 4000, approvalMult: 0.9 } },
  { title: "Normal year", text: "No shocks. A good year to think about the long-term composition of your budget.", effects: {} },
];

/* ---------- game state ---------- */
let G = null;

const $ = (id) => document.getElementById(id);
const show = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
};
const cr = (n) => "₹" + Math.round(n).toLocaleString("en-IN") + " cr";

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
    growth: 6.0,
    approval: 55,
    deficit: 3.0,       // % of GSDP
    usedLevy: 0,
    usedBorrow: 0,
    log: [],
    badges: [],
  };
  newYear();
}

function newYear() {
  G.usedLevy = 0; G.usedBorrow = 0;
  const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  G.event = ev;

  $("sim-year").textContent = G.year + " / " + G.totalYears;
  $("sim-state").textContent = G.state.name;
  $("sim-revenue").textContent = cr(G.rev);
  $("sim-deficit").textContent = G.deficit.toFixed(1) + "%";
  $("sim-growth").textContent = G.growth.toFixed(1) + "%";
  $("sim-approval").textContent = Math.round(G.approval) + "%";

  $("event-title").textContent = `Year ${G.year} — ${ev.title}`;
  $("event-text").textContent = ev.text;
  $("btn-levy").disabled = false;
  $("btn-borrow").disabled = false;

  buildSliders();
  show("screen-sim");
}

function buildSliders() {
  const wrap = $("sliders");
  wrap.innerHTML = "";
  const pool = Math.round(G.rev / 1000); // sliders in ₹1,000 cr units
  $("budget-pool").textContent = cr(G.rev);
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
  const spent = Object.values(alloc).reduce((a, b) => a + b, 0);
  const left = G.rev - spent;
  const el = $("alloc-left");
  el.textContent = (left >= 0 ? "Remaining: " : "Over by: ") + cr(Math.abs(left));
  el.classList.toggle("over", left < 0);
  SECTORS.forEach(s => ($("amt-" + s.id).textContent = cr(alloc[s.id])));
  $("btn-allocate").disabled = left < 0;
}

$("btn-levy").addEventListener("click", () => {
  if (G.usedLevy >= 2) return;
  G.usedLevy++;
  G.rev += 2000;
  G.approval -= 5;
  G.log.push("Levied an extra 'sin tax' on liquor.");
  $("sim-revenue").textContent = cr(G.rev);
  $("sim-approval").textContent = Math.round(G.approval) + "%";
  $("budget-pool").textContent = cr(G.rev);
  updateAllocLeft();
  if (G.usedLevy >= 2) $("btn-levy").disabled = true;
});

$("btn-borrow").addEventListener("click", () => {
  if (G.usedBorrow >= 2) return;
  G.usedBorrow++;
  G.rev += 5000;
  G.deficit += 1.0;
  G.log.push("Borrowed beyond the FRBM glide path (+₹5,000 cr).");
  $("sim-revenue").textContent = cr(G.rev);
  $("sim-deficit").textContent = G.deficit.toFixed(1) + "%";
  $("budget-pool").textContent = cr(G.rev);
  updateAllocLeft();
  if (G.usedBorrow >= 2) $("btn-borrow").disabled = true;
});

$("btn-allocate").addEventListener("click", () => {
  const alloc = currentAllocations();
  resolveYear(alloc);
});

function resolveYear(alloc) {
  const ev = G.event || { effects: {} };
  const spent = Object.values(alloc).reduce((a, b) => a + b, 0);
  const left = G.rev - spent;

  // growth from sector allocation
  let growthDelta = 0;
  SECTORS.forEach(s => {
    const share = alloc[s.id] / G.rev;
    growthDelta += s.growth * share * 10; // scaled
  });
  if (ev.effects.growth) growthDelta += ev.effects.growth;
  G.growth = Math.max(0.5, G.growth * 0.6 + (4 + growthDelta) * 0.4);

  // approval from sector allocation
  let approvalDelta = 0;
  SECTORS.forEach(s => {
    const share = alloc[s.id] / G.rev;
    approvalDelta += s.approval * share * 5;
  });
  if (ev.effects.approvalMult) approvalDelta *= ev.effects.approvalMult;
  if (G.deficit > 3) approvalDelta -= (G.deficit - 3) * 2; // overspending hurts credibility
  approvalDelta += (left > 0 ? 1 : -2); // unspent money is also wasteful
  G.approval = Math.max(0, Math.min(100, G.approval * 0.7 + (G.approval + approvalDelta) * 0.3));

  // finances
  const ownTaxMult = (ev.effects.ownTaxMult || 1);
  const taxPart = G.rev * REVENUE_SPLIT.ownTax * ownTaxMult;
  const otherPart = G.rev * (1 - REVENUE_SPLIT.ownTax);
  const nextRev = (taxPart * (1 + G.growth / 100) + otherPart * 1.04);

  let grant = ev.effects.grant || 0;
  if (ev.effects.needsInfra && alloc.infra / G.rev >= ev.effects.needsInfra) {
    G.log.push("Met the Centre's co-investment condition and won the capital grant.");
  } else if (ev.effects.needsInfra) {
    grant = 0;
    G.log.push("Missed the capital grant — infrastructure allocation was too low.");
  }
  G.rev = Math.round(nextRev + grant);
  G.deficit = Math.max(0, G.deficit - 0.2 + (G.usedBorrow ? 0 : 0) + (left > 0 ? -0.1 : 0.3));

  // outcome narrative
  const lines = [];
  lines.push(row("Spent", cr(spent)));
  lines.push(row("Unspent funds", left >= 0 ? cr(left) : "0 (over-allocated)"));
  lines.push(row("GSDP growth", `${G.growth.toFixed(1)}%`, "up"));
  lines.push(row("Public approval", `${Math.round(G.approval)}%`, G.approval >= 50 ? "up" : "down"));
  lines.push(row("Fiscal deficit", `${G.deficit.toFixed(1)}% of GSDP`, G.deficit <= 3 ? "up" : "down"));
  lines.push(row("Next year revenue", cr(G.rev), "up"));
  if (G.deficit > 3) lines.push(`<p class="verdict bad">⚠️ Deficit above 3% — markets and the RBI will frown.</p>`);
  if (G.approval < 40) lines.push(`<p class="verdict bad">😠 Voters are unhappy.</p>`);
  if (G.approval >= 60 && G.deficit <= 3) lines.push(`<p class="verdict good">✅ A disciplined and popular budget.</p>`);

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
  let score = Math.round(G.approval * 1.5 + G.growth * 5 - Math.max(0, G.deficit - 3) * 10 + (G.rev / G.baseRev - 1) * 100);
  score = Math.max(0, score);
  let title, verdictClass;
  if (score > 120) { title = "🏆 Fiscal Star"; verdictClass = "good"; }
  else if (score > 80) { title = "💪 Steady Hand"; verdictClass = "good"; }
  else if (score > 50) { title = "🙂 Muddled Through"; verdictClass = ""; }
  else { title = "💀 Austerity and Anger"; verdictClass = "bad"; }

  if (G.deficit <= 3 && G.approval >= 55) G.badges.push("FRBM discipline");
  if (G.growth >= 7) G.badges.push("Growth engine");
  if (G.approval >= 65) G.badges.push("People's minister");
  if (G.rev / G.baseRev >= 1.25) G.badges.push("Revenue champion");

  $("final-body").innerHTML = `
    <p class="verdict ${verdictClass}">${title} — score ${score}</p>
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
