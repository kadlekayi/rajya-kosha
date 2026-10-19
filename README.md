# 🏛️ Rajya Kosha — The State Finance Game

An interactive, zero-dependency static web game that teaches users how **state finances work in India**.

## Modes

### 🎮 Budget Simulator
You are the Finance Minister of an Indian state (Maharashtra, UP, Tamil Nadu, Karnataka, West Bengal, or Bihar). Over a 5-year term you:
- allocate a revenue pool across **education, health, infrastructure, agriculture, welfare, and administration**;
- react to random events (droughts, election years, central grants with conditions, GST windfalls);
- optionally levy a sin tax or borrow beyond the FRBM glide path;
- and watch how your choices move **GSDP growth, public approval, fiscal deficit, and next year's revenue**.

You learn, by playing, that:
- own tax revenue (mainly **SGST**), the **Finance Commission devolution** share, and grants make up a state's receipts;
- keeping the **fiscal deficit near 3% of GSDP** matters;
- capital spending (infrastructure) drives growth, welfare buys approval;
- tied central grants come with co-investment conditions.

### 🧠 Quiz Mode
10 randomized questions covering GST & SGST, Finance Commission devolution (vertical & horizontal), revenue vs fiscal vs primary deficits, FRBM targets, compensation cess, cesses vs taxes, grants-in-aid (Article 275), and why capital expenditure is preferred over revenue expenditure.

## Tech
Plain HTML + CSS + JS. No build step, no dependencies.

## Deploy to Netlify

**Option A — drag & drop:** Drag this folder into <https://app.netlify.com/drop>.

**Option B — Git:** Push this folder to a GitHub repo, then in Netlify choose "New site from Git", pick the repo. `netlify.toml` sets the publish directory to `.` — no build command needed.

**Option C — CLI:**
```bash
npm i -g netlify-cli
netlify deploy --prod --dir .
```

## Data note
All figures are stylised for gameplay, but the revenue structure (≈55% own taxes, ≈25% share in central taxes, ≈20% grants/non-tax) and concepts reflect broad patterns in RBI State Finances reports, Union Budget documents, and Finance Commission recommendations.
