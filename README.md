# Margin

Margin is a live, annotation-only writing editor. It scores every sentence after a 300 ms typing pause and aligns the results beside the original text. Margin never writes, paraphrases, rewrites, or suggests replacement text.

### Live annotation

This animated preview and the full video are committed in this repository. It shows the working app with Jev connected and a sentence being appended in real time. Select the preview to open the full-size MP4.

[![Animated preview of Margin annotating a live edit](demo/margin-annotating-preview.gif)](demo/margin-annotating.mp4?raw=1)

### Heat map and trim mode

This animated preview and the full video are committed in this repository. It shows confidence-opacity heat mapping and trim decisions. Accepting a cut records the decision; it does not modify the essay. Select the preview to open the full-size MP4.

[![Animated preview of Margin heat map and trim mode](demo/margin-heat-and-trim-preview.gif)](demo/margin-heat-and-trim.mp4?raw=1)

## What it does

- Splits plain text with `Intl.Segmenter`.
- Scores `role`, `cut_safety`, `redundancy`, `support`, and `clarity` with a `0–1` confidence for every verdict.
- Follows the device's light or dark appearance preference.
- Reconciles unchanged sentences with an LCS diff, then re-scores only changed sentences and their immediate neighbors.
- Cancels stale requests when typing continues.
- Colors the heat map by cut safety and uses cut-safety confidence as opacity.
- Builds a trim plan from cuttable sentences, ranked by ascending confidence-weighted importance.
- Records accept/reject decisions without editing the source text.
- Exports aligned Markdown and a JSON score file.
- Drops malformed provider results instead of displaying an unvalidated verdict.

## Stack

- TypeScript, React, and Vite
- TypeSafe AI's official `@typesafe-ai/sdk`
- Zod validation
- `Intl.Segmenter`
- Vitest and Playwright

There is no auth, database, or persistent editor state.

## Setup

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Set one provider in `.env`.

### Jev

```dotenv
SCORING_PROVIDER=jev
TYPESAFE_API_KEY=your_key
TYPESAFE_DEFAULT_MODEL=jev-latest
```

Create a key from the [TypeSafe dashboard](https://console.typesafe.ai/keys). Then run:

```bash
npm run dev
```

Open the local URL printed by Vite. The API key is read only by the Vite server middleware and is never included in the browser bundle.

### Structured-output LLM fallback

`LLMProvider` expects an OpenAI-compatible Chat Completions endpoint that supports strict `json_schema` response formats.

```dotenv
SCORING_PROVIDER=llm
LLM_API_KEY=your_key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=your_structured_output_model
```

`OPENAI_API_KEY` and `OPENAI_BASE_URL` are accepted as fallbacks. `LLM_MODEL` is required; Margin does not guess a model.

## Verified Jev research

Verified on September 24, 2026 against TypeSafe AI's official documentation and your configured account:

- [Introduction](https://docs.typesafe.ai/introduction): Jev evaluates typed questions against state and returns structured decisions rather than generated prose.
- [JavaScript/TypeScript SDK](https://docs.typesafe.ai/sdk/javascript): official package `@typesafe-ai/sdk`, Node.js 20+, using `TYPESAFE_API_KEY`.
- [API reference](https://docs.typesafe.ai/api): authenticated `POST https://api.typesafe.ai/v1/systemone` with `state`, `model`, and a map of typed questions.
- [Models](https://docs.typesafe.ai/models): `jev-latest` currently resolves to `jev-1.13.0`; `GET /v1/models` is account-scoped.
- [Choice primitive](https://docs.typesafe.ai/primitives/choice): Choice answers include a selected label, probabilities, and `confidence` from `0–1`.

Authenticated `GET /v1/models` returned HTTP `200` for the supplied key and listed `jev-latest` and `jev-preview`. The app therefore uses the documented SDK and endpoint rather than a guessed integration.

## Privacy boundary

The editor and annotation history remain in browser memory. The local Vite API receives sentence strings, their zero-based indices, and the current sentence array needed for redundancy and support context. It sends sentence text to the selected scoring provider—no editor storage, replacement text, export history, or unrelated application state.

Only changed sentences and immediate neighbors are re-scored. Unchanged scores are reconciled locally. The full current sentence array is used as model context because redundancy and support can depend on earlier sentences.

## Architecture

- `src/core/schema.ts` defines the shared typed result schema and per-result sanitizer.
- `src/core/provider.ts` defines the single `ScoringProvider.score(sentences, context)` interface.
- `server/providers/jev.ts` maps each field to a typed Jev Choice question and validates every answer.
- `server/providers/llm.ts` requests strict JSON matching the shared schema and validates each returned result independently.
- `server/api.ts` is the same-origin Vite API boundary; API keys remain server-side.
- `src/lib/sentences.ts` uses `Intl.Segmenter`, LCS reconciliation, and neighbor expansion.
- `src/hooks/useIncrementalScoring.ts` owns the 300 ms debounce, stale-request cancellation, and score replacement.
- `src/lib/trim.ts` computes the transparent cut plan without changing text.

Jev does not expose an Noul confidence value, so support uses a two-option Choice (`n/a` or `unsupported_claim`) rather than a Noul. Sentence 0's redundancy is deterministically `none` with confidence `1.0` because no earlier sentence exists.

## Evaluation

`evals/samples.json` contains five original short essays and 25 human-authored cut/keep labels. A model prediction is `cut` only when `cut_safety` is `cuttable`; malformed or missing results count as disagreements.

```bash
set -a
source .env
set +a
npm run eval -- jev,llm
```

Run one provider with `npm run eval -- jev` or `npm run eval -- llm`.

Live results on September 24, 2026:

| Provider | Configuration | Agreement | Correct | Dropped |
| --- | --- | ---: | ---: | ---: |
| Jev | `jev-latest` | 80.0% | 20/25 | 0 |
| LLM | `gpt-4.1-mini`, strict JSON schema | 92.0% | 23/25 | 0 |

These labels are small, author-created smoke evaluations, not an independent benchmark.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

With `npm run dev` running in another terminal:

```bash
npm run smoke
npm run demo:record
```

The smoke test covers live scoring, heat mapping, trim decisions, Markdown/JSON downloads, mobile overflow, and browser console errors. `demo:record` regenerates the two WebM walkthroughs.

## Assumptions and limits

- Sentence segmentation uses the `en` locale because Jev's strongest documented language support is English.
- Trim mode uses a transparent greedy plan in ascending cut-safety confidence, not a globally optimal word-count subset.
- Jev Choice supports at most 255 options, so redundancy compares against the 254 nearest earlier sentences.
- The fallback assumes strict JSON-schema support from the configured OpenAI-compatible endpoint.
- First-sentence redundancy is logically `none` with confidence `1.0`; it is not a model verdict.
- `npm run dev` and `npm run preview` provide the local API middleware. A production host must preserve that server boundary or implement an equivalent one.
