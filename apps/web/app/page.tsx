"use client";

import { useMemo, useState } from "react";
import { LEAGUES, type LeagueKey } from "../src/lib/leagues";

type Fixture = {
  fixtureId: number;
  date: string;
  status: string;
  league: string;
  round: string;
  home: string;
  away: string;
};

function toYMD(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function statusBadge(status?: string) {
  const s = (status ?? "").toUpperCase();

  if (s === "FT" || s === "AET" || s === "PEN")
    return { text: s, bg: "#e8f5e9", border: "#b7e1be" };
  if (s === "NS") return { text: "NS", bg: "#e3f2fd", border: "#bbdefb" };
  if (s === "1H" || s === "2H" || s === "HT" || s === "LIVE")
    return { text: s === "LIVE" ? "LIVE" : s, bg: "#fff3e0", border: "#ffe0b2" };
  if (s === "PST" || s === "SUSP" || s === "CANC")
    return { text: s, bg: "#ffebee", border: "#ffcdd2" };

  return { text: s || "?", bg: "#f5f5f5", border: "#e0e0e0" };
}

const quickBtnStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #ddd",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

export default function Page() {
  const leagueKeys = useMemo(() => Object.keys(LEAGUES) as LeagueKey[], []);
  const today = useMemo(() => new Date(), []);

  const [leagueKey, setLeagueKey] = useState<LeagueKey>("epl");
  const [from, setFrom] = useState(toYMD(today));
  const [to, setTo] = useState(toYMD(new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000)));
  const [season, setSeason] = useState<number>(() => {
    const y = today.getFullYear();
    const m = today.getMonth() + 1;
    return m < 7 ? y - 1 : y;
  });

  const [minEdge, setMinEdge] = useState<number>(0.05);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loadingFx, setLoadingFx] = useState(false);
  const [fxError, setFxError] = useState<string | null>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [edgeData, setEdgeData] = useState<any>(null);
  const [loadingEdge, setLoadingEdge] = useState(false);
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const [arbLoading, setArbLoading] = useState(false);
  const [arbData, setArbData] = useState<any>(null);
  const [arbError, setArbError] = useState<string | null>(null);


  // Local in-page cache so clicking the same fixture doesn’t refetch
  const [predCache, setPredCache] = useState<Record<number, any>>({});

  function setToday() {
    const d = new Date();
    setFrom(toYMD(d));
    setTo(toYMD(d));
  }

  function setTomorrow() {
    const d = new Date();
    setFrom(toYMD(addDays(d, 1)));
    setTo(toYMD(addDays(d, 1)));
  }

  function setNext7() {
    const d = new Date();
    setFrom(toYMD(d));
    setTo(toYMD(addDays(d, 7)));
  }

  async function loadFixtures() {
    setLoadingFx(true);
    setFxError(null);
    setFixtures([]);
    setSelected(null);
    setEdgeData(null);
    setEdgeError(null);
    setPredCache({});

    try {
      const qs = new URLSearchParams({
        leagueKey,
        season: String(season),
        from,
        to,
      });

      const res = await fetch(`/api/fixtures?${qs.toString()}`);
      const json = await res.json();

      if (!res.ok) {
        setFxError(JSON.stringify(json, null, 2));
        return;
      }

      setFixtures(json.fixtures ?? []);
    } catch (e: any) {
      setFxError(String(e?.message ?? e));
    } finally {
      setLoadingFx(false);
    }
  }

  async function loadEdge(fixtureId: number) {
    setSelected(fixtureId);
    setLoadingEdge(true);
    setEdgeData(null);
    setEdgeError(null);

    try {
      // 1) from local cache
      const cached = predCache[fixtureId];
      if (cached) {
        setEdgeData(cached);
        return;
      }

      // 2) fetch
      const qs = new URLSearchParams({
        fixtureId: String(fixtureId),
        minEdge: String(minEdge),
      });

      const res = await fetch(`/api/predict_fixture?${qs.toString()}`);
      const json = await res.json();

      if (!res.ok) {
        setEdgeError(JSON.stringify(json, null, 2));
        return;
      }

      setEdgeData(json);
      setPredCache((prev) => ({ ...prev, [fixtureId]: json }));
      loadArb(fixtureId);

    } catch (e: any) {
      setEdgeError(String(e?.message ?? e));
    } finally {
      setLoadingEdge(false);
    }
  }

  async function loadArb(fixtureId: number) {
    setArbLoading(true);
    setArbData(null);
    setArbError(null);
  
    try {
      const qs = new URLSearchParams({
        fixtureId: String(fixtureId),
        minRoi: "0.005", // 0.5% arb threshold (tweak)
      });
  
      const res = await fetch(`/api/arbitrage?${qs.toString()}`);
      const json = await res.json();
  
      if (!res.ok) {
        setArbError(JSON.stringify(json, null, 2));
        return;
      }
  
      setArbData(json);
    } catch (e: any) {
      setArbError(String(e?.message ?? e));
    } finally {
      setArbLoading(false);
    }
  }
  

  return (
    <main
      style={{
        padding: 18,
        maxWidth: 1200,
        margin: "0 auto",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>Predictor MCP</div>
          <div style={{ opacity: 0.7, marginTop: 2 }}>Fixtures → model → odds → edges</div>
        </div>

        <div style={{ opacity: 0.6, fontSize: 12 }}>Tip: Ctrl+C stops dev servers</div>
      </header>

      <section
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "end",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
        }}
      >
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>League</div>
          <select value={leagueKey} onChange={(e) => setLeagueKey(e.target.value as LeagueKey)} style={{ padding: "8px 10px" }}>
            {leagueKeys.map((k) => (
              <option key={k} value={k}>
                {LEAGUES[k].label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Season</div>
          <input type="number" value={season} onChange={(e) => setSeason(Number(e.target.value))} style={{ padding: "8px 10px", width: 110 }} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>From</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: "8px 10px" }} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>To</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: "8px 10px" }} />
        </label>

        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={setToday} style={quickBtnStyle}>
            Today
          </button>
          <button onClick={setTomorrow} style={quickBtnStyle}>
            Tomorrow
          </button>
          <button onClick={setNext7} style={quickBtnStyle}>
            Next 7d
          </button>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>minEdge</div>
          <input
            type="number"
            step="0.01"
            value={minEdge}
            onChange={(e) => setMinEdge(Number(e.target.value))}
            style={{ padding: "8px 10px", width: 110 }}
          />
        </label>

        <button
          onClick={loadFixtures}
          disabled={loadingFx}
          style={{
            padding: "9px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: loadingFx ? "#f3f3f3" : "white",
            cursor: loadingFx ? "not-allowed" : "pointer",
            fontWeight: 800,
          }}
        >
          {loadingFx ? "Loading…" : "Load fixtures"}
        </button>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 12 }}>
        {/* LEFT */}
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={{ fontWeight: 800 }}>Fixtures</div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{fixtures.length} found</div>
          </div>

          {fxError ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fff5f5", padding: 10, borderRadius: 10, border: "1px solid #ffd5d5" }}>
              {fxError}
            </pre>
          ) : fixtures.length === 0 ? (
            <div style={{ opacity: 0.7, padding: 10 }}>Load fixtures to begin.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {fixtures.map((f) => (
                <button
                  key={f.fixtureId}
                  onClick={() => loadEdge(f.fixtureId)}
                  style={{
                    textAlign: "left",
                    border: "1px solid #e5e5e5",
                    borderRadius: 12,
                    padding: 10,
                    background: selected === f.fixtureId ? "#f6f6f6" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>
                    {f.home} vs {f.away}{" "}
                    {(() => {
                      const b = statusBadge(f.status);
                      return (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 12,
                            fontWeight: 800,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: b.bg,
                            border: `1px solid ${b.border}`,
                          }}
                        >
                          {b.text}
                        </span>
                      );
                    })()}
                  </div>

                  <div style={{ opacity: 0.75, fontSize: 12, marginTop: 2 }}>
                    {new Date(f.date).toLocaleString()} — {f.round}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT */}
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
          <div style={{ marginTop: 12, marginBottom: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontWeight: 800 }}>Arbitrage</div>
              <button
                onClick={() => selected && loadArb(selected)}
                disabled={!selected || arbLoading}
                style={{ ...quickBtnStyle, padding: "6px 10px" }}
              >
                {arbLoading ? "Checking…" : "Check arb"}
              </button>
            </div>

            {arbError ? (
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fff5f5", padding: 10, borderRadius: 10, border: "1px solid #ffd5d5" }}>
                {arbError}
              </pre>
            ) : arbData?.arbs?.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {arbData.arbs.map((a: any, i: number) => (
                  <div key={i} style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>
                      {String(a.market).toUpperCase()} — ROI <b>{a.roi}</b>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                      {a.legs.map((l: any, j: number) => (
                        <div key={j}>
                          • <b>{l.selection}</b> @ <b>{l.odds}</b> — {l.bookmakerName ?? "?"}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.7, fontSize: 12, marginTop: 8 }}>
                No arbitrage detected.
              </div>
            )}
          </div>

          <div style={{ fontWeight: 800, marginBottom: 10 }}>Top edges</div>

          {loadingEdge ? (
            <div style={{ padding: 10 }}>Loading…</div>
          ) : edgeError ? (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#fff5f5", padding: 10, borderRadius: 10, border: "1px solid #ffd5d5" }}>
              {edgeError}
            </pre>
          ) : edgeData?.top ? (
            <div style={{ display: "grid", gap: 10 }}>
              <ul style={{ opacity: 0.8, fontSize: 12, display: "flex", flexDirection: "column", gap: 10, paddingInlineStart: 20 }}>
                <li>
                  Book: <b>{edgeData.bookmaker?.name ?? "?"}</b>
                </li>
                <li>
                  Elo: <b>{edgeData.modelInfo?.homeElo}</b> vs <b>{edgeData.modelInfo?.awayElo}</b>
                </li>
                <li>
                  λ: <b>{edgeData.modelInfo?.lambdaHome}</b> / <b>{edgeData.modelInfo?.lambdaAway}</b>
                </li>
              </ul>

              {edgeData?.injuries ? (
                <div style={{ marginTop: 10, border: "1px solid #e5e5e5", borderRadius: 12, padding: 10 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Will not play</div>

                  {(["home", "away"] as const).map((side) => {
                    const t = edgeData.injuries[side];
                    if (!t) return null;

                    return (
                      <div key={side} style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 900 }}>
                          {t.teamName}{" "}
                          <span style={{ opacity: 0.7, fontSize: 12 }}>({t.outCount} out)</span>
                        </div>

                        {t.flags?.length ? (
                          <div style={{ marginTop: 4, fontSize: 12 }}>
                            {t.flags.map((f: any, i: number) => (
                              <div key={i} style={{ marginTop: 2 }}>
                                ✅ <b>{f.code}</b> {f.playerName ? `— ${f.playerName}` : ""}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>No “key player” flags detected.</div>
                        )}

                        {t.outPlayers?.length ? (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>
                            {t.outPlayers.slice(0, 8).map((p: any) => (
                              <div key={p.playerId}>• {p.name}</div>
                            ))}
                            {t.outPlayers.length > 8 ? <div style={{ opacity: 0.7 }}>…and {t.outPlayers.length - 8} more</div> : null}
                          </div>
                        ) : (
                          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>No injuries listed.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {edgeData.top.map((p: any, i: number) => (
                <div key={i} style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontWeight: 900 }}>
                      {String(p.market).toUpperCase()} — {String(p.selection).toUpperCase()} {p.value ? "✅" : ""}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      odds <b>{p.odds}</b>
                    </div>
                  </div>

                  <div style={{ opacity: 0.85, fontSize: 12, marginTop: 4 }}>
                    model <b>{p.modelProb}</b> · implied <b>{p.impliedProb}</b> · edge <b>{p.edge}</b>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ opacity: 0.7, padding: 10 }}>Select a fixture to see edges.</div>
          )}
        </div>
      </section>
    </main>
  );
}
