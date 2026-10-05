import type { DiffSection, RowChange } from '@invariant-trail/engine';

const MARK: Record<RowChange, string> = {
  unchanged: '',
  changed: 'changed',
  added: 'new',
  removed: 'gone',
};

/** Every row of the state, grouped by owner, with changes marked in words. */
export function StateSections({ sections }: { sections: DiffSection[] }) {
  return (
    <div className="state-sections">
      {sections.map((section) => (
        <section key={section.id} className="state-section" aria-label={section.title}>
          <h5>{section.title}</h5>
          {section.rows.length === 0 ? (
            <p className="help">{section.empty}</p>
          ) : (
            <dl className="state-rows">
              {section.rows.map((row) => (
                <div
                  key={row.id}
                  className={`state-row is-${row.change}${row.evidence ? ' is-evidence' : ''}`}
                >
                  <dt>{row.label}</dt>
                  <dd>
                    <span className="value">{row.value}</span>
                    {row.change !== 'unchanged' ? (
                      <span className="change-mark">
                        {MARK[row.change]}
                        {row.previous !== undefined && row.change === 'changed'
                          ? ` (was ${row.previous})`
                          : ''}
                      </span>
                    ) : null}
                    {row.evidence ? (
                      <span className="evidence-mark">the rule checks this</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>
  );
}

/** Only the rows a step changed: item, before, after. */
export function ChangeTable({ sections }: { sections: DiffSection[] }) {
  const rows = sections.flatMap((section) =>
    section.rows
      .filter((row) => row.change !== 'unchanged')
      .map((row) => ({ section: section.title, row })),
  );
  if (rows.length === 0) {
    return <p className="help">This step changed nothing that is stored or in flight.</p>;
  }
  return (
    <table className="change-table">
      <caption className="sr-only">What changed in this step</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Before</th>
          <th scope="col">After</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ section, row }) => (
          <tr key={`${section}-${row.id}`} className={row.evidence ? 'is-evidence' : undefined}>
            <th scope="row">
              <span className="change-section">{section}</span>
              {row.label}
              {row.evidence ? <span className="evidence-mark">the rule checks this</span> : null}
            </th>
            <td>
              {row.change === 'added' ? (
                <span className="muted">not there</span>
              ) : (
                <span className="value">{row.previous ?? row.value}</span>
              )}
            </td>
            <td>
              {row.change === 'removed' ? (
                <span className="muted">gone</span>
              ) : (
                <>
                  <span aria-hidden="true">{row.change === 'added' ? '+ ' : '→ '}</span>
                  <span className="value">{row.value}</span>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
