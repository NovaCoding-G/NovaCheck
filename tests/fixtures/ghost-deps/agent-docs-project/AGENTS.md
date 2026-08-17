# Agent instructions

Bootstrap the project before writing code:

```bash
npm install react hallucinated-agent-helper
npx phantom-codemod --transform ./src
```

Python services:

```bash
pip install requests ghost-py-toolkit
uv add another-ghost-lib
```

Placeholders and paths must never be treated as packages:

```bash
npm install <your-package>
npm install package-name
npm run build
pip install -r requirements.txt
npx ./scripts/local.js
```
