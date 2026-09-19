import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  GitCompareArrows,
  LockKeyhole,
  Shield,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

const defaultDestination =
  "tb1pv537m7m6w0gdrcdn3mqqdpgrk3j400yrdrjwf5c9whyl2f8f4p6qg5eh2l";

function formatSats(value) {
  if (value === null || value === undefined) return "—";
  return `${value.toLocaleString()} sats`;
}

function getFindingIcon(severity) {
  if (severity === "warning") {
    return <CircleAlert size={16} />;
  }

  return <Shield size={16} />;
}

function CandidateCard({
  candidate,
  label,
  selected,
  onSelect,
  onExport,
}) {
  const transaction = candidate.transaction || {};
  const privacy = candidate.privacy || {};
  const optionality = candidate.future_optionality || {};
  const findings = candidate.findings || [];

  const hasLinkabilityRisk =
    privacy.multiple_inputs || privacy.clusters_merged;

  return (
    <div className={`candidate-card ${selected ? "selected" : ""}`}>
      <div className="candidate-top">
        <div>
          <div className="eyebrow">{label}</div>
          <h2>Candidate {candidate.candidate_id}</h2>
        </div>

        {selected && (
          <div className="selected-badge">
            <Check size={14} />
            Selected
          </div>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat">
          <span>Inputs</span>
          <strong>{transaction.input_count}</strong>
        </div>

        <div className="stat">
          <span>Input total</span>
          <strong>
            {formatSats(transaction.inputs_total_sats)}
          </strong>
        </div>

        <div className="stat">
          <span>Fee</span>
          <strong>{formatSats(transaction.fee_sats)}</strong>
        </div>

        <div className="stat">
          <span>Change</span>
          <strong>{formatSats(transaction.change_sats)}</strong>
        </div>
      </div>

      <div className="candidate-section">
        <div className="section-label">
          <LockKeyhole size={15} />
          Privacy
        </div>

        <div className="privacy-highlights">
          <div className="highlight-row">
            <span className="highlight-title">
              {privacy.multiple_inputs
                ? "Potential input linkability"
                : "Single-input construction"}
            </span>

            <span
              className={
                privacy.multiple_inputs
                  ? "highlight-status caution"
                  : "highlight-status"
              }
            >
              {privacy.multiple_inputs
                ? "2+ inputs"
                : "1 input"}
            </span>
          </div>

          <div className="highlight-row">
            <span className="highlight-title">
              Metadata clusters
            </span>

            <span className="highlight-status">
              {privacy.clusters_count ?? 0} cluster
              {(privacy.clusters_count ?? 0) === 1 ? "" : "s"}
            </span>
          </div>

          <div className="highlight-row">
            <span className="highlight-title">
              Cluster merge
            </span>

            <span
              className={
                privacy.clusters_merged
                  ? "highlight-status caution"
                  : "highlight-status"
              }
            >
              {privacy.clusters_merged
                ? "Detected"
                : "None detected"}
            </span>
          </div>
        </div>
      </div>

      <div className="candidate-section">
        <div className="section-label">
          <Clock3 size={15} />
          Future optionality
        </div>

        <div
          className={`optionality-box ${
            optionality.rare_utxo_consumed
              ? "optionality-warning"
              : ""
          }`}
        >
          {optionality.rare_utxo_consumed ? (
            <>
              <CircleAlert size={16} />
              <div>
                <strong>Rare UTXO consumed</strong>
                <p>
                  This candidate spends a tagged reserve
                  coin that may be useful for future payments.
                </p>
              </div>
            </>
          ) : (
            <>
              <Check size={16} />
              <div>
                <strong>Reserve preserved</strong>
                <p>
                  No tagged rare or important UTXO is consumed.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="candidate-section">
        <button
          className="details-toggle"
          onClick={() => {
            const details = document.getElementById(
              `details-${candidate.candidate_id}`
            );

            if (details) {
              details.hidden = !details.hidden;
            }
          }}
        >
          <Shield size={15} />
          View technical details
          <span>+</span>
        </button>

        <div
          id={`details-${candidate.candidate_id}`}
          className="technical-details"
          hidden
        >
          <div className="findings">
            {findings.map((finding, index) => (
              <div
                key={`${finding.type}-${index}`}
                className={`finding ${
                  finding.severity === "warning"
                    ? "warning"
                    : ""
                }`}
              >
                {getFindingIcon(finding.severity)}

                <div>
                  <strong>
                    {finding.type.replaceAll("_", " ")}
                  </strong>

                  <p>{finding.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button
        className={`select-button ${
          selected ? "selected-button" : ""
        }`}
        onClick={onSelect}
      >
        {selected ? (
          <>
            <Check size={18} />
            Candidate selected
          </>
        ) : (
          <>
            Choose Candidate {candidate.candidate_id}
            <ArrowRight size={18} />
          </>
        )}
      </button>

      {selected && (
        <button
          className="download-button"
          onClick={onExport}
        >
          Export Candidate {candidate.candidate_id} PSBT
        </button>
      )}
    </div>
  );
}
function App() {
  const [destination, setDestination] = useState(defaultDestination);
  const [amount, setAmount] = useState("3500");
  const [feeRate, setFeeRate] = useState("1");

  const [result, setResult] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function planTransaction(event) {
    event.preventDefault();

    setLoading(true);
    setError("");
    setResult(null);
    setSelectedCandidate(null);

    try {
      const response = await fetch(`${API_URL}/plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          destination,
          amount_sats: Number(amount),
          fee_rate_sat_vb: Number(feeRate),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail || "Unable to generate transaction candidates."
        );
      }

      setResult(data);
    } catch (err) {
      setError(
        err.message ||
          "Could not connect to the VibeHack backend."
      );
    } finally {
      setLoading(false);
    }
  }

  const comparison = result?.comparison;
  const candidateA = result?.candidate_a;
  const candidateB = result?.candidate_b;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <GitCompareArrows size={20} />
          </div>

          <div>
            <div className="brand-name">VIBEHACK</div>
            <div className="brand-subtitle">
              Pre-Signing Bitcoin Privacy Planner
            </div>
          </div>
        </div>

        <div className="status-pill">
          <span className="status-dot" />
          Signet
        </div>
      </header>

      <main className="main-content">
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-tag">
              <Sparkles size={15} />
              PLAN BEFORE YOU SIGN
            </div>

            <h1>
              Don't just create
              <span> a Bitcoin transaction.</span>
              <br />
              Compare it first.
            </h1>

            <p>
              VibeHack generates multiple transaction candidates,
              analyzes their privacy implications, and shows you the
              trade-offs before anything is signed.
            </p>
          </div>

          <div className="hero-visual">
            <div className="orb orb-one" />
            <div className="orb orb-two" />

            <div className="visual-card">
              <Wallet size={28} />
              <span>UTXOs</span>
              <strong>→ Candidates →</strong>
              <span>PSBT</span>
            </div>
          </div>
        </section>

        <section className="planner-panel">
          <div className="panel-heading">
            <div>
              <div className="eyebrow">TRANSACTION PLANNER</div>
              <h2>Plan a payment</h2>
            </div>

            <div className="safe-badge">
              <LockKeyhole size={14} />
              Pre-signing
            </div>
          </div>

          <form onSubmit={planTransaction}>
            <div className="form-grid">
              <label className="field field-wide">
                <span>Destination address</span>
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="tb1p..."
                  required
                />
              </label>

              <label className="field">
                <span>Amount</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                  <span>sats</span>
                </div>
              </label>

              <label className="field">
                <span>Fee rate</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min="1"
                    value={feeRate}
                    onChange={(e) => setFeeRate(e.target.value)}
                    required
                  />
                  <span>sat/vB</span>
                </div>
              </label>
            </div>

            <button
              className="plan-button"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <div className="spinner" />
                  Analyzing candidates...
                </>
              ) : (
                <>
                  Plan transaction
                  <ArrowRight size={19} />
                </>
              )}
            </button>
          </form>

          {error && (
            <div className="error-box">
              <CircleAlert size={18} />
              <span>{error}</span>
            </div>
          )}
        </section>

        {result && (
          <section className="results">
            <div className="results-heading">
              <div>
                <div className="eyebrow">ANALYSIS COMPLETE</div>
                <h2>
                  Two ways to make the same payment.
                </h2>
              </div>

              <div className="same-payment">
                <Zap size={16} />
                {formatSats(Number(amount))}
              </div>
            </div>

            <div className="candidate-grid">
              <CandidateCard
                candidate={candidateA}
                label="TWO-UTXO STRATEGY"
                selected={selectedCandidate === "A"}
                onSelect={() => setSelectedCandidate("A")}
              />

              <CandidateCard
                candidate={candidateB}
                label="LARGEST-FIRST STRATEGY"
                selected={selectedCandidate === "B"}
                onSelect={() => setSelectedCandidate("B")}
              />
            </div>

            <div className="comparison-panel">
              <div className="comparison-heading">
                <div className="section-label">
                  <GitCompareArrows size={17} />
                  Candidate comparison
                </div>

                <span>Observed trade-offs</span>
              </div>

              <div className="tradeoff-grid">
                {comparison?.tradeoffs?.map((tradeoff) => (
                  <div
                    className="tradeoff-card"
                    key={tradeoff.candidate_id}
                  >
                    <h3>
                      Candidate {tradeoff.candidate_id}
                    </h3>

                    <p className="tradeoff-summary">
                      {tradeoff.summary}
                    </p>

                    <div className="tradeoff-list">
                      {(tradeoff.pros || []).map((pro, index) => (
                        <div className="tradeoff-item pro" key={index}>
                          <Check size={15} />
                          <span>{pro}</span>
                        </div>
                      ))}

                      {(tradeoff.cons || []).map((con, index) => (
                        <div className="tradeoff-item con" key={index}>
                          <CircleAlert size={15} />
                          <span>{con}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedCandidate && (
              <div className="selection-banner">
                <div>
                  <div className="eyebrow">READY FOR NEXT STEP</div>
                  <strong>
                    Candidate {selectedCandidate} selected
                  </strong>
                  <p>
                    This selection is only recorded in the UI.
                    Nothing has been signed or broadcast.
                  </p>
                </div>

                <div className="selection-status">
                  <Check size={18} />
                  Pre-signing
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        <div>
          <strong>VIBEHACK</strong>
          <span>Cypherpunk transaction planning</span>
        </div>

        <div className="footer-safe">
          <Shield size={15} />
          No signing · No broadcast
        </div>
      </footer>
    </div>
  );
}

export default App;