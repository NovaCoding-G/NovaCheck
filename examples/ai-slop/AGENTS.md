# Agent instructions

> Intentionally unsafe. These commands are the demo payload for NovaCheck.

## Setup

```bash
npm install express supabase-auth-helpers-nextjs
npx phantom-migrate --apply
```

## Python worker

```bash
pip install requests requests-toolkit-lite
uv add langchain-helpers
```

## Conventions

- Never commit real credentials (this repo does, on purpose, so the scanner has
  something to find).
- Placeholders below must not be reported as ghost packages:

```bash
npm install <your-package>
npm run build
pip install -r requirements.txt
```
