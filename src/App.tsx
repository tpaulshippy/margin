import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { SentenceAnnotation } from './core/schema'
import { useIncrementalScoring } from './hooks/useIncrementalScoring'
import { buildJsonExport, buildMarkdownExport } from './lib/export'
import { buildTrimPlan, type TrimDecision } from './lib/trim'
import './App.css'

const sampleText = `Remote work can improve focus for some employees. In our six-month pilot, 64% of participants reported fewer interruptions. However, the same pilot found that new employees missed informal guidance. That tension matters because remote policies often optimize for experienced staff. That is important. In other words, flexibility helps some people and isolates others. Future studies should measure onboarding outcomes separately from productivity. The results are promising.`

const cutClass = {
  essential: 'essential',
  supporting: 'supporting',
  cuttable: 'cuttable',
} as const

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2v10m0 0 4-4m-4 4L6 8M3 15v2h14v-2" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
    </svg>
  )
}

function ScissorsIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="14.5" r="2.5" />
      <circle cx="15" cy="14.5" r="2.5" />
      <path d="m6.8 12.7 8.7-9.2m-8.7 9.2 8.7-9.2" />
    </svg>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <span className="confidence" aria-label={`Confidence ${value.toFixed(2)}`}>
      <span className="confidence-track">
        <span className="confidence-fill" style={{ width: `${value * 100}%` }} />
      </span>
      <span className="confidence-number">{value.toFixed(2)}</span>
    </span>
  )
}

function ScoreRow({ label, value, confidence }: { label: string; value: string; confidence: number }) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <span className={`score-value score-${value.replaceAll('_', '-')}`}>{value.replaceAll('_', ' ')}</span>
      <ConfidenceBar value={confidence} />
    </div>
  )
}

function AnnotationCard({
  index,
  sentence,
  annotation,
  pending,
}: {
  index: number
  sentence: string
  annotation?: SentenceAnnotation
  pending: boolean
}) {
  if (pending) {
    return (
      <article className="annotation-card annotation-pending" aria-live="polite">
        <div className="annotation-number">{String(index + 1).padStart(2, '0')}</div>
        <div>
          <p className="annotation-quote">{sentence}</p>
          <div className="pending-line"><span className="spinner" /> Waiting for typing pause</div>
        </div>
      </article>
    )
  }

  if (!annotation) {
    return (
      <article className="annotation-card annotation-missing">
        <div className="annotation-number">{String(index + 1).padStart(2, '0')}</div>
        <div>
          <p className="annotation-quote">{sentence}</p>
          <p className="missing-copy">No valid score returned.</p>
        </div>
      </article>
    )
  }

  return (
    <article className="annotation-card">
      <div className="annotation-number">{String(index + 1).padStart(2, '0')}</div>
      <div className="annotation-content">
        <p className="annotation-quote">{sentence}</p>
        <div className="score-list">
          <ScoreRow label="Role" value={annotation.role.value} confidence={annotation.role.confidence} />
          <ScoreRow label="Cut safety" value={annotation.cut_safety.value} confidence={annotation.cut_safety.confidence} />
          <ScoreRow label="Redundancy" value={annotation.redundancy.value} confidence={annotation.redundancy.confidence} />
          {annotation.redundancy.value === 'repeats' && (
            <div className="repeat-reference">
              Earlier sentence {annotation.redundancy.earlier_sentence_index + 1}
            </div>
          )}
          <ScoreRow label="Support" value={annotation.support.value} confidence={annotation.support.confidence} />
          {annotation.clarity.confidence > 0.8 && (
            <ScoreRow label="Clarity" value={annotation.clarity.value} confidence={annotation.clarity.confidence} />
          )}
        </div>
      </div>
    </article>
  )
}

function HeatMap({
  sentences,
  annotations,
  pendingIndices,
}: {
  sentences: readonly string[]
  annotations: readonly SentenceAnnotation[]
  pendingIndices: readonly number[]
}) {
  const byIndex = new Map(annotations.map((annotation) => [annotation.index, annotation]))
  return (
    <div className="heatmap" aria-label="Sentence cut-safety heat map">
      <div className="heat-legend">
        <span><i className="legend-essential" /> essential</span>
        <span><i className="legend-supporting" /> supporting</span>
        <span><i className="legend-cuttable" /> cuttable</span>
        <span className="opacity-note">opacity = confidence</span>
      </div>
      <div className="heat-sentences">
        {sentences.map((sentence, index) => {
          const annotation = byIndex.get(index)
          const pending = pendingIndices.includes(index)
          const style = annotation
            ? { opacity: Math.max(0.12, annotation.cut_safety.confidence) }
            : undefined
          return (
            <div
              className={`heat-sentence ${annotation ? `heat-${cutClass[annotation.cut_safety.value]}` : 'heat-unscored'}`}
              key={`${index}-${sentence}`}
              style={style as CSSProperties | undefined}
            >
              <span className="heat-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="heat-text">{sentence}</span>
              <span className="heat-confidence">
                {pending ? 'pending' : annotation?.cut_safety.confidence.toFixed(2) ?? 'no score'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TrimPanel({
  sentences,
  annotations,
  targetWords,
  onTargetWords,
  decisions,
  onDecision,
}: {
  sentences: readonly string[]
  annotations: readonly SentenceAnnotation[]
  targetWords: number
  onTargetWords: (value: number) => void
  decisions: Readonly<Record<number, TrimDecision>>
  onDecision: (index: number, decision: TrimDecision) => void
}) {
  const plan = useMemo(() => buildTrimPlan({
    sentences,
    annotations,
    targetWords,
    decisions,
  }), [annotations, decisions, sentences, targetWords])

  return (
    <section className="trim-panel" aria-labelledby="trim-heading">
      <div className="trim-summary">
        <div>
          <span className="eyebrow">Trim mode</span>
          <h2 id="trim-heading">Find cuts. Keep control.</h2>
        </div>
        <label className="target-input">
          <span>Target words</span>
          <input
            type="number"
            min="0"
            value={targetWords}
            onChange={(event) => onTargetWords(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="trim-metrics" aria-live="polite">
        <span><strong>{plan.currentWords}</strong> current</span>
        <span><strong>{plan.targetWords}</strong> target</span>
        <span><strong>{plan.projectedWords}</strong> projected</span>
        <span className={plan.reachesTarget ? 'metric-good' : 'metric-warn'}>
          {plan.reachesTarget ? 'Target reachable' : `${plan.availableCutWords} cuttable words available`}
        </span>
      </div>
      <p className="trim-note">
        Ranked by cut-safety confidence. Accepting a cut removes that sentence from the essay and re-scores its neighbors.
      </p>
      <div className="trim-list">
        {plan.candidates.length === 0 && (
          <div className="empty-trim">No cuttable sentences have a valid score yet.</div>
        )}
        {plan.candidates.map((candidate) => (
          <article className={`trim-item ${candidate.selected ? 'trim-selected' : ''}`} key={candidate.index}>
            <div className="trim-item-copy">
              <div className="trim-item-meta">
                <span>Sentence {candidate.index + 1}</span>
                <span>{candidate.words} words</span>
                <span>importance {candidate.importance.toFixed(2)}</span>
                {candidate.selected && <span className="plan-badge">in plan</span>}
              </div>
              <p>{candidate.text}</p>
            </div>
            <div className="trim-actions">
              <button
                type="button"
                className={candidate.status === 'accepted' ? 'decision-active' : ''}
                onClick={() => onDecision(candidate.index, candidate.status === 'accepted' ? 'pending' : 'accepted')}
              >
                {candidate.status === 'accepted' ? 'Accepted' : 'Accept cut'}
              </button>
              <button
                type="button"
                className={candidate.status === 'rejected' ? 'keep-active' : ''}
                onClick={() => onDecision(candidate.index, candidate.status === 'rejected' ? 'pending' : 'rejected')}
              >
                {candidate.status === 'rejected' ? 'Kept' : 'Keep'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function App() {
  const [heatMap, setHeatMap] = useState(false)
  const [trimOpen, setTrimOpen] = useState(false)
  const [targetWords, setTargetWords] = useState(45)
  const [decisions, setDecisions] = useState<Record<number, TrimDecision>>({})
  const decisionText = useRef<Record<number, string>>({})
  const { text, updateText, sentences, annotations, pendingIndices, provider, error } = useIncrementalScoring(sampleText)
  const annotationByIndex = useMemo(
    () => new Map(annotations.map((annotation) => [annotation.index, annotation])),
    [annotations],
  )
  const wordCount = useMemo(
    () => sentences.reduce((total, sentence) => total + (sentence ? sentence.trim().split(/\s+/u).length : 0), 0),
    [sentences],
  )

  useEffect(() => {
    setDecisions((current) => Object.fromEntries(
      Object.entries(current).filter(([index, status]) => {
        const numericIndex = Number(index)
        return decisionText.current[numericIndex] === sentences[numericIndex]
          && status !== 'pending'
      }),
    ))
    decisionText.current = Object.fromEntries(sentences.map((sentence, index) => [index, sentence]))
  }, [sentences])

  const updateDecision = (index: number, decision: TrimDecision) => {
    if (decision === 'accepted') {
      const nextSentences = sentences.filter((_, sentenceIndex) => sentenceIndex !== index)
      const nextDecisions = Object.fromEntries(
        Object.entries(decisions)
          .filter(([decisionIndex, status]) => Number(decisionIndex) !== index && status === 'rejected')
          .map(([decisionIndex, status]) => {
            const previousIndex = Number(decisionIndex)
            return [String(previousIndex > index ? previousIndex - 1 : previousIndex), status]
          }),
      )
      setDecisions(nextDecisions)
      decisionText.current = Object.fromEntries(nextSentences.map((sentence, nextIndex) => [nextIndex, sentence]))
      updateText(nextSentences.join(' '))
      return
    }
    setDecisions((current) => ({ ...current, [index]: decision }))
  }

  const exportMarkdown = () => {
    downloadFile('margin-annotations.md', buildMarkdownExport(sentences, annotations, provider ?? 'unconfigured'), 'text/markdown')
  }

  const exportJson = () => {
    downloadFile('margin-scores.json', buildJsonExport(sentences, annotations, provider ?? 'unconfigured'), 'application/json')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span>M</span></div>
          <div>
            <div className="brand-name">Margin</div>
            <div className="brand-subtitle">live editorial analysis</div>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="local-badge"><span /> Local text</div>
          <button type="button" className="button button-quiet" onClick={exportMarkdown}>
            <DownloadIcon /> Markdown
          </button>
          <button type="button" className="button button-quiet" onClick={exportJson}>
            <DownloadIcon /> JSON
          </button>
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">Annotate, don’t rewrite</div>
            <h1>See the margin<br />while you write.</h1>
          </div>
          <div className="intro-copy">
            <p>Margin scores each sentence after you pause. Your words stay in this browser; only sentence text is sent to your configured scoring provider.</p>
            <div className="provider-row">
              <span className={`status-dot ${provider ? 'status-ready' : ''}`} />
              <span>{provider ? `${provider === 'jev' ? 'Jev' : 'LLM'} connected` : 'Connecting to provider'}</span>
              <span className="intro-stat"><strong>{sentences.length}</strong> sentences</span>
              <span className="intro-stat"><strong>{wordCount}</strong> words</span>
            </div>
          </div>
        </section>

        {error && <div className="error-banner" role="status">{error}</div>}

        <section className="workspace">
          <div className="pane editor-pane">
            <div className="pane-header">
              <div>
                <span className="pane-index">01</span>
                <h2>{heatMap ? 'Heat map' : 'Plain text'}</h2>
              </div>
              <button
                type="button"
                className={`view-toggle ${heatMap ? 'toggle-active' : ''}`}
                aria-pressed={heatMap}
                onClick={() => setHeatMap((current) => !current)}
              >
                <GridIcon /> {heatMap ? 'Edit text' : 'Heat map'}
              </button>
            </div>
            <div className="editor-body">
              {heatMap ? (
                <HeatMap sentences={sentences} annotations={annotations} pendingIndices={pendingIndices} />
              ) : (
                <textarea
                  value={text}
                  onChange={(event) => updateText(event.target.value)}
                  spellCheck="true"
                  aria-label="Essay text"
                  placeholder="Start writing. Margin will annotate as you pause."
                />
              )}
            </div>
            <div className="pane-footer">
              <span>{wordCount} words</span>
              <span>{text.length} characters</span>
              <span className="footer-spacer" />
              <span>300 ms debounce</span>
            </div>
          </div>

          <div className="pane annotations-pane">
            <div className="pane-header">
              <div>
                <span className="pane-index">02</span>
                <h2>Sentence annotations</h2>
              </div>
              <span className="score-count">{annotations.length}/{sentences.length} scored</span>
            </div>
            <div className="annotation-list">
              {sentences.length === 0 && (
                <div className="empty-annotations">Your sentence annotations will align here.</div>
              )}
              {sentences.map((sentence, index) => (
                <AnnotationCard
                  key={`${index}-${sentence}`}
                  index={index}
                  sentence={sentence}
                  annotation={annotationByIndex.get(index)}
                  pending={pendingIndices.includes(index)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="trim-launcher">
          <div>
            <span className="eyebrow">Target a word count</span>
            <h2>Find the least important cuttable sentences.</h2>
          </div>
          <button type="button" className="button button-dark" onClick={() => setTrimOpen((current) => !current)}>
            <ScissorsIcon /> {trimOpen ? 'Close trim mode' : 'Open trim mode'}
          </button>
        </section>

        {trimOpen && (
          <TrimPanel
            sentences={sentences}
            annotations={annotations}
            targetWords={targetWords}
            onTargetWords={setTargetWords}
            decisions={decisions}
            onDecision={updateDecision}
          />
        )}

        <footer className="page-footer">
          <span>Margin never rewrites or suggests replacement text.</span>
          <span>Scores are signals, not verdicts.</span>
        </footer>
      </main>
    </div>
  )
}

export default App
