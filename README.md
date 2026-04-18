## Viewpilot

Viewpilot turns a CSV into an agentic analytics workspace:
- the file is uploaded into an E2B sandbox
- Python profiles the dataset and generates an initial dashboard
- a copilot panel can ask follow-up questions against the same live session
- Mistral is accessed through the OpenAI SDK client shape for routing, planning, critique, summaries, and bounded code generation

## Environment

Create a local `.env` file with:

```bash
E2B_API_KEY=e2b_...
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-small-latest
MISTRAL_ROUTER_MODEL=mistral-small-latest
MISTRAL_CRITIC_MODEL=mistral-small-latest
MISTRAL_SUMMARY_MODEL=mistral-small-latest
MISTRAL_CODE_MODEL=codestral-latest
MISTRAL_BASE_URL=https://api.mistral.ai/v1
```

## Getting Started

Install dependencies and run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload a CSV.

## What works now

- E2B session creation
- CSV upload into the sandbox
- Python-powered initial profiling and dashboard generation
- KPI cards, chart/table panels, insight rail, and copilot sidebar
- Staged copilot workflow with routing, cache-aware task planning, bounded code generation, validation, critique, fallback, and provenance
- Split-model Mistral configuration with a dedicated code-model slot for Codestral
- Session analysis state mirrored into `/home/user/viewpilot/session-state.json` inside the sandbox

## Notes

- PDF export is scaffolded but not enabled yet.
- Voice input uses the browser speech recognition API when available.
- App session state is still in-memory for the local app process, but each sandbox now keeps a mirrored structured analysis state for workflow context and replay.
