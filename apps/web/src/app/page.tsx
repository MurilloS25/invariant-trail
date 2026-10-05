import { AppShell } from '../components/app-shell';
import { ModeLink } from '../components/mode-link';

const FLOW = [
  { text: '1 item available', tone: 'start' },
  { text: 'Two buyers act at once', tone: 'step' },
  { text: 'Two orders are created', tone: 'step' },
  { text: 'Rule broken', tone: 'break' },
] as const;

export default function Page() {
  return (
    <>
      <a className="skip-link" href="#practice">
        Skip to the lessons
      </a>
      <header className="site-header">
        <p className="wordmark">Invariant Trail</p>
        <nav aria-label="Page sections">
          <ModeLink mode="learn">Learn</ModeLink>
          <ModeLink mode="sandbox">Sandbox</ModeLink>
          <a href="#limits-and-honesty">What a result means</a>
        </nav>
      </header>
      <main>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <h1 id="hero-heading">Learn why reliable systems fail, and how to fix them.</h1>
            <p className="lede">
              An interactive learning tool for students and junior developers who want to understand
              idempotency, retries, concurrency and distributed-system failures through visual,
              step-by-step simulations.
            </p>
            <p className="hero-actions">
              <ModeLink mode="learn" className="button button-primary">
                Start a guided lesson
              </ModeLink>
              <ModeLink mode="sandbox" className="button">
                Open the sandbox
              </ModeLink>
            </p>
            <p className="hero-note">
              Runs in your browser. No account. It simulates small models of systems; it never
              touches a real one.
            </p>
          </div>
          <figure className="hero-flow" aria-labelledby="flow-caption">
            <figcaption id="flow-caption">One of the lessons, in four lines</figcaption>
            <ol className="flow">
              {FLOW.map((item) => (
                <li key={item.text} className={`flow-item flow-${item.tone}`}>
                  {item.text}
                </li>
              ))}
            </ol>
            <p className="help">
              You pick what can go wrong, the tool tries every possible order of events within its
              limits, and you replay the shortest one that breaks the rule.
            </p>
          </figure>
        </section>

        <section className="learn-points" aria-labelledby="points-heading">
          <h2 id="points-heading">What you will learn</h2>
          <ul>
            <li>Why a repeated request can charge or confirm twice.</li>
            <li>Why an operation can succeed even when its answer is lost.</li>
            <li>Why two buyers can both get the last item.</li>
            <li>Why webhooks can arrive twice, late or in the wrong order.</li>
            <li>Why an ordinary test does not cover every possible order of events.</li>
          </ul>
        </section>

        <AppShell />

        <section id="limits-and-honesty" className="honesty" aria-labelledby="honesty-heading">
          <h2 id="honesty-heading">What a result means</h2>
          <div className="honesty-grid">
            <div>
              <h3>These are models, not your system</h3>
              <p>
                Each scenario is a small, deliberate simplification built to teach one idea. Nothing
                here runs real services, and a result says nothing about your production code.
              </p>
            </div>
            <div>
              <h3>A broken rule is a real example</h3>
              <p>
                The shortest example is replayed from the starting state and every step is checked
                again, so you can follow exactly how the rule broke. If some choices were skipped to
                save time, the result says a shorter example may exist.
              </p>
            </div>
            <div>
              <h3>“No violation found” is bounded</h3>
              <p>
                It means the search finished without finding a break, for this model, these things
                going wrong, this one rule, and these limits. It is not a proof that a system is
                correct.
              </p>
            </div>
            <div>
              <h3>Safety rules only</h3>
              <p>
                The tool checks that something bad never happens. It does not check that work
                eventually finishes, so a crash can lose work without breaking a rule.
              </p>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <p>
          Invariant Trail is a learning tool. Everything is deterministic and runs offline in your
          browser; settings live in the page address so you can share a lesson or a sandbox setup.
        </p>
      </footer>
    </>
  );
}
