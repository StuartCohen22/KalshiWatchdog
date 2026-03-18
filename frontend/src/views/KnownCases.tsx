import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { getKnownCases } from "../api/client";
import type { KnownCase } from "../types";

export function KnownCases() {
  const [cases, setCases] = useState<KnownCase[]>([]);

  useEffect(() => {
    getKnownCases().then(setCases).catch(() => undefined);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" className="button-secondary">
          Back to dashboard
        </Link>
      </div>

      <section className="panel">
        <p className="eyebrow">Reference file</p>
        <h1 className="max-w-[12ch] font-mono text-4xl font-semibold uppercase leading-tight tracking-[-0.04em] text-text-primary">
          Known insider trading cases
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-text-secondary">
          These cases are part precedent, part narrative anchor. They give the dashboard historical context for
          why a timing pattern matters even when the underlying trades are anonymous.
        </p>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        {cases.map((item) => (
          <article key={item.id} className="panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">{item.platform}</p>
                <h2 className="text-2xl font-semibold text-text-primary">{item.title}</h2>
              </div>
              <span className="data-chip">{new Date(item.date).getFullYear()}</span>
            </div>
            <p className="mt-4 text-sm leading-7 text-text-secondary">{item.summary}</p>
            <dl className="mt-5 grid gap-3 text-sm text-text-secondary">
              <div className="flex justify-between gap-4">
                <dt>Subject</dt>
                <dd className="text-right text-text-primary">{item.subject}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Pattern</dt>
                <dd className="text-right text-text-primary">{item.pattern}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Penalty</dt>
                <dd className="text-right text-text-primary">{item.penalty}</dd>
              </div>
            </dl>
            <p className="mt-5 border-t border-border-default pt-4 text-sm leading-6 text-text-secondary">
              {item.notes}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}

