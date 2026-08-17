# research

Public evidence for the claim that hallucinated package names reach real
repositories.

- `targets.example.txt` — target list format and the rules for choosing one.
- `reports/` — generated reports and datasets (`ghost-hunt-<date>.md` / `.json`),
  created by the hunt script.

Generate a report:

```bash
bun run scripts/ghost-hunt.ts --targets research/targets.txt --anonymize
```

Read [../docs/RESEARCH.md](../docs/RESEARCH.md) before publishing anything from
here. It defines target selection, verification, disclosure, and the corrections
policy — a report that skips them is worth less than no report.
