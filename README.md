# 🏛️ Rajya Kosha — The State Finance Game

An interactive game that teaches how **state finances work in India** — now with real consequences: human development outcomes, shock events, and the full Budget Estimate → Revised Estimate → CAG actuals pipeline.

## What makes it realistic

- **HDI outcomes**: allocations to education, health and welfare move literacy, infant mortality → life expectancy, and labour-force participation — combined into a state HDI you can see *before* passing the budget.
- **Shock events**: droughts, cyclones, heatwaves, pandemics, trade wars, central policy changes, GST windfalls.
- **BE → RE → CAG**: governments underspend vs budget (capital outlay slips most, salaries always pay), revenue sometimes misses estimates, and the CAG actuals report arrives two years later and feeds back into your available pool.

## Repo structure

```
web/         The browser game (plain HTML/CSS/JS, no build step)
  index.html
  app.js
  style.css
  netlify.toml
prototype/   Python model of the new mechanics (playtest & tune here first)
  rajya_kosha.py
```

## Play the model (Python)

```bash
python3 prototype/rajya_kosha.py            # interactive 5-year term
python3 prototype/rajya_kosha.py --auto 200 # compare strategies statistically
python3 prototype/rajya_kosha.py --state br # jump straight into a state
```

Strategies the auto-sim compares: `balanced`, `investor` (capital-heavy), `populist` (welfare-heavy), `teacher` (education-heavy). The populist path buys approval but ends with the worst HDI; the teacher path wins on human development.

## Play the web game

Open `web/index.html` directly, or deploy:

**Netlify** — drag the `web/` folder into [app.netlify.com/drop](https://app.netlify.com/drop), or connect the repo (`netlify.toml` sets publish dir to `web/`).

## Roadmap

- [ ] Port HDI outcomes, shocks and the BE→RE→CAG pipeline from the prototype into the web game
- [ ] CAG report screen in the UI
- [ ] Borrowing decisions at budget time

## Data note

All figures are stylised for gameplay, but the revenue structure (≈55% own taxes, ≈25% share in central taxes, ≈20% grants/non-tax), deficit frameworks and concepts reflect broad patterns in RBI State Finances reports, Union Budget documents, and Finance Commission recommendations.
