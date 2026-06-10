# auto-geo init

One-shot setup for the full auto-geo system. Run it once at your project root; every other command picks up what it writes.

```bash
npx auto-geo init        # interactive — a handful of questions
npx auto-geo init --yes  # non-interactive template (CI / scripted onboarding)
```

## What it writes

| File                    | Purpose                                                                         | Commit it?                       |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| `auto-geo.config.json`  | Your defaults — domain, basePath, provider, model, engine, concurrency, author. | Yes — it never holds secrets.    |
| `.env.local`            | API key slots for every provider/engine. Auto-loaded by every command.          | **No** — gitignore it.           |
| `.auto-geo/prompts.txt` | Tracked prompts — the queries `check` runs by default.                          | Yes.                             |
| `.auto-geo/checks/`     | Every `check` run saved as JSON; the data behind `history`.                     | Yes — diffs are the audit trail. |

## Interactive flow

The default mode asks for:

1. Publisher domain (e.g. `https://www.example.com`)
2. Base path for resources (default `/resources`)
3. Default LLM provider (`openai` | `anthropic`)
4. Default author — name, job title, bio (≥20 chars), LinkedIn (optional)
5. **Prompts to track** — comma-separated; seeds `.auto-geo/prompts.txt` so your first `auto-geo check` has something to measure

Every answer is optional — press Enter to skip and the field falls back to CLI flags / env / built-in defaults at run time.

## Flags

| Flag         | Effect                                                                           |
| ------------ | -------------------------------------------------------------------------------- |
| `-y, --yes`  | Non-interactive: write a template config you edit by hand.                       |
| `--force`    | Overwrite an existing `auto-geo.config.json`. Without it, init refuses (exit 1). |
| `--json`     | Machine-readable outcome.                                                        |
| `--no-color` | Disable ANSI colors.                                                             |

## Guarantees

- **Never overwrites `.env.local`.** Keys are precious; an existing file is left byte-identical.
- **Never clobbers an existing `.auto-geo/` workspace.** Missing pieces (e.g. `checks/`) are backfilled; existing prompts are untouched.
- **API keys never enter the config file.** They live only in `.env.local` / the environment.

## Config precedence

Everywhere in the CLI, values resolve highest-first:

1. CLI flag (explicitly passed)
2. Environment variable (e.g. provider auto-detected from which API key is set)
3. `auto-geo.config.json` (discovered by walking up from cwd — monorepo-friendly)
4. Built-in command default

## After init

```bash
# 1. Add at least one API key
$EDITOR .env.local

# 2. Audit a page
npx auto-geo doctor https://example.com/some-page

# 3. Measure your tracked prompts
npx auto-geo check
```
