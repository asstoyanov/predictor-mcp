"use client";

import { useMemo, useState } from "react";
import { LEAGUES, type LeagueKey } from "../lib/leagues";

type Fixture = {
  fixtureId: number;
  date: string;
  status: string;
  league: string;
  round: string;
  home: string;
  away: string;
};

export default function Page() {
  const leagueKeys = useMemo(() => Object.keys(LEAGUES) as LeagueKey[], []);
  const [leagueKey, setLeagueKey] = useState<LeagueKey>("epl");

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const defaultFrom = `${yyyy}-${mm}-${dd}`;

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultFrom);
  const [season, setSeason] = useState(yyyy);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loadingFx, setLoadingFx] = useState(false);

  const [selected, setSelected] = useState<number | null>(null);
  const [edgeData, setEdgeData] = useState<any>(null);
  const [loadingEdge, setLoadingEdge] = useState(false);

  async function loadFixtures() {
    setLoadingFx(true);
    setSelected(null);
    setEdgeData(null);
    try {
      const qs = new URLSearchParams({
        leagueKey,
        season: String(season),
        from,
        to,
      });
      const res = await fetch(`/api/fixtures?${qs.toString()}`);
      const json = await res.json();
      setFixtures(json.fixtures ?? []);
    } finally {
      setLoadingFx(false);
    }
  }

  async function loadEdge(fixtureId: number) {
    setSelected(fixtureId);
    setLoadingEdge(true);
    setEdgeData(null);
    try {
      const qs = new URLSearchParams({ fixtureId: String(fixtureId), minEdge: "0.05" });
      const res = await fetch(`/api/edge?${qs.toString()}`);
      const json = await res.json();
      setEdgeData(json);
    } finally {
      setLoadingEdge(false);
    }
  }

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Predictor</h1>

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div>League</div>
          <select value={leagueKey} onChange={(e) => setLeagueKey(e.target.value as LeagueKey)}>
            {leagueKeys.map((k) => (
              <option key={k} value={k}>
                {LEAGUES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div>Season</div>
          <input type="number" value={season} onChange={(e) => setSeason(Number(e.target.value))} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div>From</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div>To</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <button onClick={loadFixtures} disabled={loadingFx} style={{ padding: "8px 12px" }}>
          {loadingFx ? "Loading…" : "Load fixtures"}
        </button>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Fixtures ({fixtures.length})</div>

          {fixtures.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Load fixtures to begin.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {fixtures.map((f) => (
                <button
                  key={f.fixtureId}
                  onClick={() => loadEdge(f.fixtureId)}
                  style={{
                    textAlign: "left",
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    padding: 10,
                    background: selected === f.fixtureId ? "#f3f3f3" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {f.home} vs {f.away} <span style={{ opacity: 0.6, fontWeight: 500 }}>({f.status})</span>
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 13 }}>
                    {new Date(f.date).toLocaleString()} — {f.round}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Top edges</div>

          {loadingEdge ? (
            <div>Loading…</div>
          ) : edgeData?.error ? (
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(edgeData, null, 2)}</pre>
          ) : edgeData?.top ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                Book: <b>{edgeData.bookmaker?.name ?? "?"}</b>
              </div>

              {edgeData.top.map((p: any, i: number) => (
                <div key={i} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 700 }}>
                    {p.market.toUpperCase()} — {p.selection.toUpperCase()}{" "}
                    {p.value ? <span style={{ marginLeft: 6 }}>✅</span> : null}
                  </div>
                  <div style={{ opacity: 0.8, fontSize: 13 }}>
                    odds <b>{p.odds}</b> | model {p.modelProb} | implied {p.impliedProb} | edge{" "}
                    <b>{p.edge}</b>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>Select a fixture to see edges.</div>
          )}
        </div>
      </section>
    </main>
  );
}
