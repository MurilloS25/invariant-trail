import { DEFAULT_LIMITS, REQUEST_VERSION } from '@invariant-trail/contracts';
import { getTemplate, runExploration } from '@invariant-trail/engine';
import { Workspace } from '../components/workspace';

/** The landing example is a real search, run once at build time with the same engine. */
function headlineTrail() {
  const template = getTemplate('booking-confirmation');
  const preset = template?.presets.find((p) => p.id === 'retry-after-lost-response');
  if (!template || !preset) return null;
  const outcome = runExploration({
    version: REQUEST_VERSION,
    templateId: template.id,
    invariantId: preset.invariantId,
    design: preset.design,
    faults: preset.faults,
    limits: DEFAULT_LIMITS,
  });
  if (outcome.status !== 'violated') return null;
  const rule = template.invariants.find((i) => i.id === preset.invariantId);
  return { outcome, rule, preset };
}

export default function Page() {
  const trail = headlineTrail();
  return (
    <>
      <a className="skip-link" href="#workspace">
        Skip to the workspace
      </a>
      <header className="site-header">
        <p className="wordmark">Invariant Trail</p>
        <nav aria-label="Page sections">
          <a href="#workspace">Workspace</a>
          <a href="#limits-and-honesty">What a result means</a>
        </nav>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <h1 id="hero-heading">Find the shortest way your workflow breaks.</h1>
            <p className="lede">
              Pick a workflow, allow realistic failures such as duplicate requests, lost answers and
              crashes, and Invariant Trail searches the orderings within your limits for the
              shortest sequence that breaks a safety rule. Then you can replay it step by step.
            </p>
            <p className="hero-actions">
              <a className="button button-primary" href="#workspace">
                Open the workspace
              </a>
            </p>
            <p className="hero-note">
              Runs entirely in your browser. No account, no server, no code to write.
            </p>
          </div>
          {trail ? (
            <figure className="hero-trail" aria-labelledby="trail-caption">
              <figcaption id="trail-caption">
                <span className="hero-trail-kicker">
                  Found by the engine, in {trail.outcome.stats.statesDiscovered} states
                </span>
                <strong>
                  {trail.rule?.title}: broken in {trail.outcome.counterexample.steps.length} steps
                </strong>
              </figcaption>
              <ol className="trail trail-static">
                {trail.outcome.counterexample.steps.map((step) => {
                  const isFinal = step.index === trail.outcome.counterexample.steps.length;
                  const isFault = step.transition.kind === 'fault';
                  return (
                    <li key={step.index} className="trail-item">
                      <span className="stone stone-static">
                        <span
                          className={`stone-marker ${isFinal ? 'marker-break' : isFault ? 'marker-fault' : 'marker-step'}`}
                          aria-hidden="true"
                        />
                        <span className="stone-text">
                          <span className="stone-index">Step {step.index}</span>
                          <span className="stone-label">{step.transition.label}</span>
                          {isFault ? <span className="tag tag-fault">Failure injected</span> : null}
                          {isFinal ? <span className="tag tag-break">Rule broken here</span> : null}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="hero-trail-result">{trail.outcome.counterexample.violation.message}</p>
            </figure>
          ) : null}
        </section>

        <Workspace />

        <section id="limits-and-honesty" className="honesty" aria-labelledby="honesty-heading">
          <h2 id="honesty-heading">What a result means</h2>
          <div className="honesty-grid">
            <div>
              <h3>A found violation is real in the model</h3>
              <p>
                The trail is replayed from the starting state and every step is checked again, so
                the broken rule is reproducible. It is the shortest path the search found; when no
                choices were cut, no shorter path exists in the model.
              </p>
            </div>
            <div>
              <h3>“No violation found” is bounded</h3>
              <p>
                It means the search finished without finding a break within the limits you set. It
                is not a proof about an unbounded system, and it says nothing about failures you did
                not switch on.
              </p>
            </div>
            <div>
              <h3>These are models, not your system</h3>
              <p>
                Each workflow is a small, deliberate simplification. The value is in seeing how
                failures combine, not in a guarantee about production code. Safety rules only; this
                tool does not check that work eventually finishes.
              </p>
            </div>
            <div>
              <h3>Deterministic and offline</h3>
              <p>
                The same settings always give the same result. Nothing is random, nothing leaves
                your browser, and no code you type is ever run, because you do not type any.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <p>
          Invariant Trail, a bounded failure explorer. Settings live in the page address so you can
          share them.
        </p>
      </footer>
    </>
  );
}
