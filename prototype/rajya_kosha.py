#!/usr/bin/env python3
"""
Rajya Kosha prototype — stripped-down Python model.

Mechanics under test (before porting to the web version):
  1. HDI outcomes: allocations to education/health/welfare move literacy,
     life expectancy (via IMR) and labour-force participation, which combine
     into a state HDI. Projections are visible BEFORE passing the budget.
  2. Shock events: climate disasters, pandemics, trade wars, external/central
     policy changes, plus normal years.
  3. BE -> RE -> CAG actuals pipeline: you budget (Budget Estimate), by
     year-end you see a Revised Estimate of what was actually spent and
     collected, and the CAG actuals arrive with a lag and feed back into
     the money available next year. Governments typically underspend vs BE;
     revenue sometimes falls short of BE.

Run:
  python3 prototype/rajya_kosha.py            # interactive
  python3 prototype/rajya_kosha.py --auto 200 # simulate strategies
"""

import argparse
import math
import random
import statistics
import sys
from dataclasses import dataclass, field

# ----------------------------------------------------------------------------
# Static data
# ----------------------------------------------------------------------------

STATES = {
    "mh": dict(name="Maharashtra", rev=400_000, gsdp=3_500_000, pop=12.6,
               literacy=84.4, imr=16.0, le=73.5, lfpr=53.0),
    "up": dict(name="Uttar Pradesh", rev=290_000, gsdp=2_200_000, pop=24.1,
               literacy=67.7, imr=38.0, le=65.0, lfpr=44.0),
    "tn": dict(name="Tamil Nadu", rev=230_000, gsdp=1_800_000, pop=7.7,
               literacy=82.9, imr=15.0, le=72.5, lfpr=51.5),
    "ka": dict(name="Karnataka", rev=220_000, gsdp=1_700_000, pop=6.8,
               literacy=77.4, imr=19.0, le=70.5, lfpr=54.0),
    "wb": dict(name="West Bengal", rev=200_000, gsdp=1_400_000, pop=9.9,
               literacy=76.6, imr=22.0, le=71.0, lfpr=42.5),
    "br": dict(name="Bihar", rev=140_000, gsdp=650_000, pop=12.7,
               literacy=61.8, imr=46.0, le=66.5, lfpr=36.0),
}

# sector -> (share-of-budget that counts as "adequate", underspend tendency)
# Capital outlay underspends most; salaries pay out fully.
SECTORS = ["education", "health", "infrastructure", "agriculture",
           "welfare", "administration"]
SPEND_TENDENCY = {
    "education": (0.90, 0.05),
    "health": (0.88, 0.06),
    "infrastructure": (0.80, 0.08),   # capital outlay slips most
    "agriculture": (0.87, 0.07),
    "welfare": (0.95, 0.03),         # entitlements pay out
    "administration": (0.97, 0.02), # salaries & pensions always pay
}

# revenue realisation vs BE: mean, sd (own-tax heavy states swing more)
REV_TENDENCY = (0.96, 0.06)

# shock events: weight, text, and effect hooks
SHOCKS = [
    dict(w=3, key="normal", title="Normal year",
         text="No major shocks. A good year for the long view."),
    dict(w=2, key="drought", title="Drought / weak monsoon",
         text="Farm incomes fall; agriculture spending costs more, growth dips.",
         growth=-1.5, spend_up={"agriculture": 1.2, "welfare": 1.15},
         approval=-4, approval_boost=("welfare", "agriculture")),
    dict(w=2, key="flood", title="Cyclone / floods",
         text="Damage to roads and homes; relief spending is unavoidable.",
         growth=-1.0, spend_up={"infrastructure": 1.3}, forced_relief=0.03,
         approval=-6, approval_boost=("welfare",)),
    dict(w=1, key="heatwave", title="Extreme heatwave",
         text="Heat hits labour productivity and rural demand.",
         growth=-0.8, lfpr_hit=-0.4, approval=-3),
    dict(w=1, key="pandemic", title="Pandemic",
         text="Health spending surges, economic activity collapses for months.",
         growth=-4.0, spend_up={"health": 1.6, "welfare": 1.4},
         approval=-8, approval_boost=("health",)),
    dict(w=1, key="tradewar", title="Trade war / global slowdown",
         text="Exports slump; SGST and own taxes undershoot BE sharply.",
         rev_mult=0.90, growth=-1.5),
    dict(w=1, key="policy", title="Central policy change",
         text="The Centre trims a large CSS scheme; your grants fall.",
         rev_mult=0.95, growth=-0.5, approval=-2),
    dict(w=1, key="gstwindfall", title="GST windfall",
         text="Consumption booms; collections beat estimates.",
         rev_mult=1.07, growth=0.5),
]

CAG_REVISION_SD = 0.015  # actuals differ from RE by a bit more


def draw_shock(rng):
    total = sum(s["w"] for s in SHOCKS)
    r = rng.uniform(0, total)
    acc = 0
    for s in SHOCKS:
        acc += s["w"]
        if r <= acc:
            return s
    return SHOCKS[0]


# ----------------------------------------------------------------------------
# HDI sub-model
# ----------------------------------------------------------------------------

def project_hdi(G, alloc):
    """Project end-of-year HDI outcomes given the allocation (in Rs cr)."""
    pop = G.state["pop"] * 100  # in lakhs-ish units; spending per lakh pop
    edu_pc = alloc["education"] / pop          # Rs cr per lakh people
    health_pc = alloc["health"] / pop

    # literacy: strong sensitivity to real education spending, diminishing returns
    lit_gain = 2.5 * (edu_pc / 40.0) / (1 + edu_pc / 150.0) - 0.15
    lit_gain = max(-0.5, lit_gain)   # neglect slowly erodes literacy
    lit = min(99.0, max(40.0, G.literacy + lit_gain))

    # IMR falls with health spending (diminishing returns), floor at Kerala-ish 8
    imr_drop = 4.0 * (health_pc / 30.0) / (1 + health_pc / 100.0) - 0.2
    imr_drop = max(-1.0, imr_drop)  # neglect worsens mortality
    imr = max(8.0, G.imr - imr_drop)

    # life expectancy: LE = 85 - 0.35 * IMR (stylised)
    le = 85.0 - 0.35 * imr

    # LFPR: education & welfare support participation; growth helps a bit
    lfpr_delta = 0.35 * (edu_pc / 40.0) + 0.15 * (alloc["welfare"] / pop / 30.0) - 0.1
    lfpr_delta += 0.05 * (G.growth - 5.0)
    lfpr = G.lfpr + lfpr_delta
    lfpr = max(20.0, min(75.0, lfpr))

    # income index: GSDP per capita, log-normalised (stylised against $75k)
    gdppc = G.gsdp * 10**7 / (G.state["pop"] * 10**7)  # Rs per person approx
    inc_idx = (math.log(gdppc) - math.log(20_000)) / (math.log(400_000) - math.log(20_000))
    inc_idx = max(0.0, min(1.0, inc_idx))

    edu_idx = lit / 100.0 * 0.6 + lfpr / 100.0 * 0.4
    health_idx = (le - 25.0) / (85.0 - 25.0)
    hdi = (inc_idx * edu_idx * health_idx) ** (1 / 3)
    return dict(literacy=lit, imr=imr, le=le, lfpr=lfpr, hdi=hdi,
                lit_gain=lit_gain, imr_drop=imr_drop)



# ----------------------------------------------------------------------------
# Game state
# ----------------------------------------------------------------------------

@dataclass
class Game:
    sid: str
    rng: random.Random
    state: dict = field(init=False)
    year: int = 1
    total_years: int = 5
    growth: float = 6.0
    approval: float = 55.0
    deficit: float = 3.0
    log: list = field(default_factory=list)
    pending_cag: list = field(default_factory=list)  # years awaiting CAG actuals
    last_projection: dict = None

    def __post_init__(self):
        self.state = STATES[self.sid]
        self.literacy = self.state["literacy"]
        self.imr = self.state["imr"]
        self.le = self.state["le"]
        self.lfpr = self.state["lfpr"]
        self.gsdp = self.state["gsdp"]
        self.rev = self.state["rev"]

    # ---- year flow ---------------------------------------------------------

    def begin_year(self):
        """Returns (available_pool, shock). Applies CAG feedback first."""
        self.shock = draw_shock(self.rng)
        avail = self.rev
        cag_note = None
        # CAG actuals for year-2 arrive now and adjust the pool
        while self.pending_cag and self.pending_cag[0]["ready_year"] <= self.year:
            rep = self.pending_cag.pop(0)
            gap = rep["rev_actual"] - rep["rev_be"]
            if gap < 0:
                avail += gap  # shortfall must be absorbed now
                self.log.append(
                    f"Year {rep['year']} CAG: receipts fell short of BE by "
                    f"Rs {-gap:,.0f} cr; your pool absorbs it.")
                self.approval -= 2
            else:
                avail += 0.5 * gap
                self.log.append(
                    f"Year {rep['year']} CAG: receipts beat BE by Rs {gap:,.0f} cr.")
            cag_note = rep
        self.available = avail
        return avail, self.shock, cag_note

    def pass_budget(self, alloc):
        """Resolve a year given the budget allocation (Rs cr per sector)."""
        rng = self.rng
        sh = self.shock

        # --- spending: RE vs BE (underspend is the norm) -------------------
        spend_be = sum(alloc.values())
        forced = sh.get("forced_relief", 0) * self.available
        re_spend, actuals = 0.0, {}
        for sec, amt in alloc.items():
            mean, sd = SPEND_TENDENCY[sec]
            mult = sh.get("spend_up", {}).get(sec, 1.0)
            f = max(0.5, rng.gauss(mean, sd)) * mult
            actuals[sec] = amt * f
            re_spend += amt * f
        re_spend += forced
        underspend = spend_be - (re_spend - forced)

        # --- revenue: actual collections vs BE -----------------------------
        rev_mult = sh.get("rev_mult", 1.0)
        real_f = max(0.70, rng.gauss(*REV_TENDENCY)) * rev_mult
        rev_re = self.available * real_f
        # CAG trues it up later with another small revision
        rev_cag = rev_re * (1 + rng.gauss(0, CAG_REVISION_SD))
        rev_cag = max(rev_cag, 0.75 * self.available)

        # --- growth ---------------------------------------------------------
        gdelta = 0
        shares = {s: (alloc[s] / max(self.available, 1)) for s in SECTORS}
        gdelta += 10 * shares["infrastructure"] * 1.0
        gdelta += 6 * shares["education"] * 0.6
        gdelta += 5 * shares["agriculture"] * 0.5
        gdelta += 3 * shares["health"] * 0.3
        gdelta += 2 * shares["welfare"] * 0.2
        gdelta += 2 * shares["administration"] * 0.2
        gdelta += sh.get("growth", 0)
        self.growth = max(0.5, self.growth * 0.6 + (4 + gdelta) * 0.4)

        # --- HDI outcomes (already projected pre-budget; now realised) ------
        proj = project_hdi(self, alloc)
        if sh.get("lfpr_hit"):
            proj["lfpr"] = max(20.0, proj["lfpr"] + sh["lfpr_hit"])
        self.literacy, self.imr = proj["literacy"], proj["imr"]
        self.le, self.lfpr = proj["le"], proj["lfpr"]
        self.last_projection = proj

        # --- approval -------------------------------------------------------
        adelta = (4 * shares["welfare"] * 10 + 3 * shares["health"] * 10
                  + 2 * shares["education"] * 10 + 2 * shares["agriculture"] * 10
                  + 1.2 * shares["infrastructure"] * 10)
        adelta += sh.get("approval", 0)
        for sec in (sh.get("approval_boost") or ()):
            adelta += shares[sec] * 5
        # voters punish visible human-development failures
        if self.last_projection:
            if self.last_projection.get("imr_drop", 0) < 0:
                adelta -= 4   # infant mortality rose on your watch
            if self.last_projection.get("lit_gain", 0) < 0.3:
                adelta -= 2   # schools visibly neglected
        if self.deficit > 3:
            adelta -= (self.deficit - 3) * 3
        self.approval = max(0, min(100, self.approval * 0.75 + (self.approval + adelta) * 0.25))

        # --- deficit (on GSDP) ----------------------------------------------
        self.gsdp *= (1 + self.growth / 100)
        self.deficit = (re_spend - rev_re) / max(self.gsdp, 1) * 100
        self.deficit = max(0, self.deficit)

        # --- queue the CAG report for year+2, feed shortfall forward --------
        self.pending_cag.append(dict(
            year=self.year, ready_year=self.year + 2,
            rev_be=self.available, rev_re=rev_re, rev_actual=rev_cag,
            spend_be=spend_be, spend_re=re_spend,
            underspend=underspend))

        # --- next year's BE receipts -----------------------------------------
        self.rev = self.available * (1 + self.growth / 100) * (real_f ** 0.3)
        if rev_cag < self.available:
            pass  # already handled via CAG feedback when it lands

        self.last_result = dict(
            spend_be=spend_be, spend_re=re_spend, rev_be=self.available,
            rev_re=rev_re, underspend=underspend, shock=sh, proj=proj,
            actuals=actuals, forced=forced)
        return self.last_result

    def finish(self):
        proj = self.last_projection or project_hdi(self, {s: 0 for s in SECTORS})
        hdi = proj["hdi"]
        score = (self.approval * 1.0 + self.growth * 6
                 - max(0, self.deficit - 3) * 12
                 + (hdi - 0.5) * 400)
        return dict(score=max(0, round(score)), hdi=hdi, growth=self.growth,
                    approval=self.approval, deficit=self.deficit,
                    literacy=self.literacy, imr=self.imr, le=self.le,
                    lfpr=self.lfpr, log=self.log)


# ----------------------------------------------------------------------------
# Strategies for auto-sim
# ----------------------------------------------------------------------------

STRATEGIES = {
    "balanced":      dict(education=0.18, health=0.12, infrastructure=0.20,
                          agriculture=0.13, welfare=0.17, administration=0.20),
    "investor":      dict(education=0.20, health=0.10, infrastructure=0.32,
                          agriculture=0.10, welfare=0.08, administration=0.20),
    "populist":      dict(education=0.10, health=0.08, infrastructure=0.08,
                          agriculture=0.16, welfare=0.38, administration=0.20),
    "teacher":       dict(education=0.36, health=0.16, infrastructure=0.10,
                          agriculture=0.08, welfare=0.10, administration=0.20),
}


def auto_sim(state_ids, n, seed=None):
    rng = random.Random(seed)
    print(f"{'strategy':<10} {'state':<5} {'score':>6} {'HDI':>6} {'lit':>5} "
          f"{'IMR':>5} {'LE':>5} {'LFPR':>5} {'grw':>5} {'appr':>5} {'def':>5}")
    agg = {}
    for sname, shares in STRATEGIES.items():
        for sid in state_ids:
            scores, hdis = [], []
            for _ in range(n):
                g = Game(sid, random.Random(rng.random()))
                for yr in range(1, 6):
                    g.year = yr
                    avail, shock, _cag = g.begin_year()
                    alloc = {s: avail * shares[s] for s in SECTORS}
                    g.pass_budget(alloc)
                r = g.finish()
                scores.append(r["score"]); hdis.append(r["hdi"])
            agg[(sname, sid)] = (statistics.mean(scores), statistics.mean(hdis))
            m, h = agg[(sname, sid)]
            print(f"{sname:<10} {sid:<5} {m:>6.0f} {h:>6.3f}")
    print("\nMean score by strategy (all states):")
    for sname in STRATEGIES:
        ms = statistics.mean(v[0] for (s, _), v in agg.items() if s == sname)
        mh = statistics.mean(v[1] for (s, _), v in agg.items() if s == sname)
        print(f"  {sname:<10} score={ms:6.0f}  HDI={mh:.3f}")


# ----------------------------------------------------------------------------
# Interactive CLI
# ----------------------------------------------------------------------------

def rupees(n):
    return f"Rs {n:,.0f} cr"


def pick_state():
    print("\nChoose your state:")
    keys = list(STATES)
    for i, k in enumerate(keys):
        s = STATES[k]
        print(f"  {i + 1}. {s['name']:<16} revenue {rupees(s['rev'])}, "
              f"literacy {s['literacy']}%, IMR {s['imr']}, HDI inputs styled")
    while True:
        try:
            i = int(input("State number: "))
            return keys[i - 1]
        except (ValueError, IndexError):
            print("Try again.")


def interact(sid=None, seed=None):
    sid = sid or pick_state()
    g = Game(sid, random.Random(seed))
    for yr in range(1, 6):
        g.year = yr
        avail, shock, cag = g.begin_year()
        print(f"\n{'=' * 70}\nYEAR {yr} — {STATES[sid]['name']}")
        if cag:
            print(f"  CAG report (year {cag['year']}): BE receipts {rupees(cag['rev_be'])}, "
                  f"actual {rupees(cag['rev_actual'])} | BE spend {rupees(cag['spend_be'])}, "
                  f"actual {rupees(cag['spend_re'])}")
        print(f"  Available pool: {rupees(avail)}")
        print(f"  SHOCK: {shock['title']} — {shock['text']}")
        print("  Allocate across sectors as fractions summing to 1, e.g. .18 .12 .2 .13 .17 .2")
        print("           (education health infrastructure agriculture welfare administration)")
        while True:
            try:
                vals = [float(x) for x in input("  shares: ").split()]
                if len(vals) != 6 or abs(sum(vals) - 1) > 0.02 or any(v < 0 for v in vals):
                    raise ValueError
                break
            except ValueError:
                print("  Need 6 non-negative fractions summing to ~1.")
        alloc = {s: avail * v for s, v in zip(SECTORS, vals)}
        proj = project_hdi(g, alloc)
        print(f"  PROJECTED HDI OUTCOMES: literacy {proj['literacy']:.1f}% "
              f"(+{proj['lit_gain']:.2f}), IMR {proj['imr']:.1f} "
              f"(-{proj['imr_drop']:.2f}), LE {proj['le']:.1f} yrs, "
              f"LFPR {proj['lfpr']:.1f}%, HDI {proj['hdi']:.3f}")
        res = g.pass_budget(alloc)
        print(f"  --- Revised Estimates (RE) at year end ---")
        print(f"  Spending: BE {rupees(res['spend_be'])} -> RE {rupees(res['spend_re'])} "
              f"(underspend {rupees(res['underspend'])})")
        print(f"  Receipts: BE {rupees(res['rev_be'])} -> RE {rupees(res['rev_re'])}")
        print(f"  Growth {g.growth:.1f}% | approval {g.approval:.0f}% | "
              f"deficit {g.deficit:.1f}% of GSDP | HDI {res['proj']['hdi']:.3f}")
    r = g.finish()
    print(f"\n{'=' * 70}\nTERM OVER — score {r['score']}")
    print(f"  Final HDI {r['hdi']:.3f} | literacy {r['literacy']:.1f}% | IMR {r['imr']:.1f} "
          f"| LE {r['le']:.1f} | LFPR {r['lfpr']:.1f}%")
    for line in r["log"]:
        print(f"  - {line}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto", type=int, metavar="N", help="run N sims per strategy/state")
    ap.add_argument("--states", default="mh,up,br", help="states for auto mode")
    ap.add_argument("--seed", type=int)
    ap.add_argument("--state", help="state id for interactive mode")
    args = ap.parse_args()
    if args.auto:
        auto_sim(args.states.split(","), args.auto, args.seed)
    else:
        interact(args.state, args.seed)


if __name__ == "__main__":
    main()
