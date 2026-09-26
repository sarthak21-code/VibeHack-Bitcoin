import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  MapPin,
  RefreshCw,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Wallet,
  X,
  Zap,
} from "lucide-react";

import {
  connectLedger,
  signCoinLensPsbt,
  applyLedgerSignatures,
  disconnectLedger,
  isLedgerConnected,
} from "./ledger";

const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const DEMO_DESCRIPTOR =
  "tr([12071a7c/86'/1'/0']tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T/0/*)#z3x5097m";

const DEFAULT_DESTINATION =
  "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

const DEFAULT_AMOUNT = "3500";
const DEFAULT_FEE_RATE = "1";


// ============================================================
// HELPERS
// ============================================================

function formatSats(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("en-IN").format(number);
}

function shortText(value, start = 8, end = 8) {
  if (!value) return "—";

  const text = String(value);

  if (text.length <= start + end + 3) {
    return text;
  }

  return `${text.slice(0, start)}...${text.slice(-end)}`;
}

function candidateName(candidate, index = 0) {
  const letter = getCandidateId(candidate, index);

  if (candidate?.strategy_name) {
    return `${letter} · ${candidate.strategy_name}`;
  }

  return (
    candidate?.name ||
    candidate?.label ||
    `Candidate ${letter}`
  );
}

function getCandidateId(candidate, index = 0) {
  return (
    candidate?.candidate_id ||
    candidate?.id ||
    String.fromCharCode(65 + index)
  );
}

function normalizeClusters(clusters) {
  if (!clusters) return [];

  if (Array.isArray(clusters)) {
    return clusters;
  }

  if (typeof clusters === "string") {
    return [clusters];
  }

  return Object.values(clusters);
}

function getTradeoff(candidate) {
  const privacy = candidate?.privacy || {};
  const transaction = candidate?.transaction || {};
  const optionality = candidate?.future_optionality || {};

  const observations = [];
  const tradeoffs = [];

  const inputCount =
    candidate?.input_count ??
    transaction?.input_count ??
    candidate?.inputs?.length ??
    0;

  const fee =
    candidate?.fee_sats ??
    transaction?.fee_sats ??
    candidate?.fee ??
    0;

  const change =
    candidate?.change_sats ??
    transaction?.change_sats ??
    candidate?.change ??
    0;

  const feeDelta =
    candidate?.fee_delta_vs_cheapest_sats ??
    candidate?.fee_delta ??
    0;

  const clusters = normalizeClusters(
    privacy?.clusters_used ??
      privacy?.clusters ??
      []
  );

  // -----------------------------
  // OBSERVATIONS
  // -----------------------------

  if (inputCount === 1) {
    observations.push(
      "Uses a single input, avoiding the common-input ownership heuristic."
    );
  }

  if (inputCount > 1) {
    observations.push(
      `Uses ${inputCount} inputs; spending them together can create a common-input ownership heuristic.`
    );
  }

  if (clusters.length === 1) {
    observations.push(
      `Spending is isolated to the metadata cluster "${clusters[0]}".`
    );
  }

  if (clusters.length > 1) {
    observations.push(
      `Inputs span multiple metadata clusters: ${clusters.join(", ")}.`
    );
  }

  if (change > 0) {
    observations.push(
      `Creates a likely change output of ${formatSats(change)} sats.`
    );
  }

  if (Number(feeDelta) === 0 && Number(fee) > 0) {
    observations.push(
      `Lowest fee among the generated candidates at ${formatSats(fee)} sats.`
    );
  }

  // -----------------------------
  // TRADE-OFFS
  // -----------------------------

  if (Boolean(privacy?.clusters_merged)) {
    tradeoffs.push(
      "Inputs from multiple metadata clusters are merged in this transaction."
    );
  }

  if (Boolean(privacy?.address_reuse_detected)) {
    tradeoffs.push(
      "Address reuse was detected in the available wallet metadata."
    );
  }

  if (Boolean(optionality?.rare_utxo_consumed)) {
    tradeoffs.push(
      "Consumes a tagged rare or important UTXO, which may reduce future wallet flexibility."
    );
  }

  if (Boolean(optionality?.unique_cluster_consumed)) {
    tradeoffs.push(
      "Consumes a unique metadata cluster, which may reduce future wallet flexibility."
    );
  }

  if (Number(feeDelta) > 0) {
    tradeoffs.push(
      `Costs ${formatSats(feeDelta)} sats more than the cheapest generated candidate (${formatSats(fee)} sats total fee).`
    );
  }

  return {
    observations,
    tradeoffs,
  };
}

// The backend (backend/privacy_engine/models.py) returns each candidate as
// { candidate_id, valid, error?, transaction: {...}, privacy: {...},
//   future_optionality: {...}, findings: [...] } and puts the per-candidate
// pros/cons inside comparison.tradeoffs, keyed by candidate_id. This flattens
// that shape into the fields the UI components read directly.
function flattenCandidate(candidate, index, tradeoffsById) {
  const candidateId =
    candidate?.candidate_id ||
    candidate?.id ||
    String.fromCharCode(65 + index);

  const transaction = candidate?.transaction || {};
  const privacy = candidate?.privacy || {};
  const optionality = candidate?.future_optionality || {};
  const findings = Array.isArray(candidate?.findings)
    ? candidate.findings
    : [];
  const tradeoff = tradeoffsById[candidateId] || {};

  return {
    ...candidate,
    candidate_id: candidateId,
    valid: candidate?.valid !== false,
    error: candidate?.error || null,

    input_count: transaction.input_count ?? 0,
    input_total_sats: transaction.inputs_total_sats ?? 0,
    payment_sats: transaction.payment_sats ?? 0,
    fee_sats: transaction.fee_sats ?? 0,
    change_sats: transaction.change_sats ?? 0,
    change_created: Boolean(transaction.change_created),

    clusters: privacy.clusters_used || [],
    clusters_count: privacy.clusters_count ?? 0,
    clusters_merged: Boolean(privacy.clusters_merged),
    multiple_inputs: Boolean(privacy.multiple_inputs),
    address_reuse_detected: privacy.address_reuse_detected ?? null,

    rare_utxo_consumed: Boolean(optionality.rare_utxo_consumed),
    unique_cluster_consumed: Boolean(optionality.unique_cluster_consumed),

    findings,
    observations: findings.map((finding) => finding.message).filter(Boolean),

    pros: Array.isArray(tradeoff.pros) ? tradeoff.pros : [],
    cons: Array.isArray(tradeoff.cons) ? tradeoff.cons : [],
    tradeoff_summary: tradeoff.summary || "",
    metrics: tradeoff.metrics || {},
  };
}

function normalizePlannerResponse(data) {
  // The backend now returns a variable-length list of candidates (one per
  // selection strategy, see backend/planner.py STRATEGIES). Older cached
  // responses only had candidate_a/candidate_b, so fall back to those.
  let candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  if (!candidates.length) {
    candidates = [data?.candidate_a, data?.candidate_b].filter(Boolean);
  }

  const tradeoffsById = {};
  const rawTradeoffs = data?.comparison?.tradeoffs;
  if (Array.isArray(rawTradeoffs)) {
    for (const tradeoff of rawTradeoffs) {
      if (tradeoff?.candidate_id) {
        tradeoffsById[tradeoff.candidate_id] = tradeoff;
      }
    }
  }

  candidates = candidates.map((candidate, index) =>
    flattenCandidate(candidate, index, tradeoffsById)
  );

  const rawPsbts = data?.psbts || {};

  // Build a PSBT lookup keyed by every candidate id actually present, so
  // this works whether there are 2 or 4 candidates.
  const psbts = { ...rawPsbts };
  for (const candidate of candidates) {
    const cid = candidate.candidate_id;
    if (!psbts[cid]) {
      psbts[cid] =
        rawPsbts[cid?.toLowerCase?.()] ||
        rawPsbts[`candidate_${cid?.toLowerCase?.()}`] ||
        rawPsbts[`Candidate ${cid}`] ||
        "";
    }
  }

  return {
    candidates,
    comparison: data?.comparison || null,
    psbts,
  };
}


// ============================================================
// BRAND
// ============================================================

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0f2747] text-white shadow-sm">
        <ShieldCheck size={21} />
      </div>

      <div>
        <div className="text-lg font-bold tracking-tight text-[#10213b]">
          CoinLens
        </div>

        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8b98aa]">
          Secure Pre-Signing Privacy Planner
        </div>
      </div>
    </div>
  );
}


// ============================================================
// STATUS BAR
// ============================================================

function StatusBar({
  ledgerConnected,
  ledgerStatus,
}) {
  return (
    <div className="flex items-center justify-between border-b border-[#e4e9ef] bg-white px-6 py-3">
      <Brand />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-[#e4e9ef] bg-[#f8fafc] px-3 py-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              ledgerConnected ? "bg-emerald-500" : "bg-slate-300"
            }`}
          />

          <span className="text-xs font-semibold text-[#526176]">
            {ledgerConnected ? "Ledger connected" : "Watch-only mode"}
          </span>
        </div>

        {ledgerStatus && (
          <div className="max-w-[280px] truncate text-xs text-[#8793a5]">
            {ledgerStatus}
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================
// LOGIN SCREEN
// ============================================================

function LoginScreen({
  descriptor,
  setDescriptor,
  onConnectDescriptor,
  onConnectLedger,
  onGuestDemo,
  loading,
  error,
  ledgerStatus,
}) {
  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <StatusBar
        ledgerConnected={false}
        ledgerStatus={ledgerStatus}
      />

      <main className="mx-auto flex min-h-[calc(100vh-66px)] max-w-4xl items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl rounded-[28px] border border-[#e1e7ef] bg-white p-8 shadow-[0_25px_70px_rgba(15,39,71,0.08)] md:p-12">

          <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#dbe5f0] bg-[#f5f8fc] text-[#2863a8]">
            <LockKeyhole size={25} />
          </div>

          <div className="comparison-heading mb-8">
            <div className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[#f28a18]">
              Secure Access
            </div>

            <h1 className="text-4xl font-semibold tracking-tight text-[#162238]">
              Welcome back.
            </h1>

            <p className="mt-3 text-base text-[#7c899c]">
              Connect a wallet or explore the Signet demo.
            </p>
          </div>

          <button
            onClick={onConnectLedger}
            disabled={loading}
            className="group flex w-full items-center justify-between rounded-2xl bg-[#2d67aa] px-5 py-5 text-left text-white shadow-[0_15px_35px_rgba(45,103,170,0.2)] transition hover:bg-[#255d9d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
                <KeyRound size={23} />
              </div>

              <div>
                <div className="font-bold">
                  Connect Hardware Wallet
                </div>

                <div className="mt-1 text-sm text-blue-100">
                  Ledger hardware signing boundary
                </div>
              </div>
            </div>

            <ChevronRight
              size={23}
              className="transition-transform group-hover:translate-x-1"
            />
          </button>

          <div className="my-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-[#dfe5ec]" />

            <span className="text-xs font-bold uppercase tracking-widest text-[#9aa5b4]">
              OR
            </span>

            <div className="h-px flex-1 bg-[#dfe5ec]" />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Wallet
                size={19}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-[#98a4b5]"
              />

              <input
                value={descriptor}
                onChange={(event) =>
                  setDescriptor(event.target.value)
                }
                placeholder="Enter xpub, npub, or descriptor"
                className="h-14 w-full rounded-xl border border-[#d8e0ea] bg-white pl-12 pr-4 text-sm text-[#1d2a3d] outline-none transition focus:border-[#2d67aa] focus:ring-4 focus:ring-blue-50"
              />
            </div>

            <button
              onClick={onConnectDescriptor}
              disabled={!descriptor.trim() || loading}
              className="h-14 rounded-xl border border-[#ccd7e4] bg-white px-7 text-sm font-bold text-[#1d3554] transition hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Scanning Signet…" : "Connect"}
            </button>
          </div>

          <p className="mt-2 text-xs text-[#9aa5b4]">
            Connecting runs a real chain scan against Signet to find this
            wallet's UTXOs — this can take a few seconds.
          </p>

          <button
            type="button"
            onClick={onGuestDemo}
            disabled={loading}
            className="mt-4 flex w-full items-center justify-between rounded-xl border border-[#d5dfeb] bg-[#f7f9fc] px-5 py-4 text-left transition hover:border-[#2d67aa] hover:bg-[#f1f6fc] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div>
              <div className="text-sm font-bold text-[#1d3554]">
                Continue with Guest Demo
              </div>
              <div className="mt-1 text-xs text-[#7c899c]">
                Use the built-in Bitcoin Signet demo wallet. No hardware wallet required.
              </div>
            </div>

            <ChevronRight size={20} className="text-[#2d67aa]" />
          </button>

          {error && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <CircleAlert size={17} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {ledgerStatus && (
            <div className="mt-5 rounded-xl bg-[#f7f9fc] px-4 py-3 text-sm text-[#68778b]">
              {ledgerStatus}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}


// ============================================================
// PLANNER SCREEN
// ============================================================

function PlannerScreen({
  destination,
  setDestination,
  amount,
  setAmount,
  feeRate,
  setFeeRate,
  onPlan,
  loading,
  error,
  onBack,
  onManageUtxos,
}) {
  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <div className="mx-auto max-w-6xl px-6 py-8">

        <div className="mb-8 flex items-center justify-between">
          <Brand />

          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-xl border border-[#dce4ed] bg-white px-4 py-2.5 text-sm font-semibold text-[#526176] hover:bg-[#f8fafc]"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">

          <section className="rounded-[24px] border border-[#dce4ed] bg-white p-7 shadow-sm">
            <div className="mb-7">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
                Transaction Planner
              </div>

              <h1 className="text-3xl font-semibold tracking-tight text-[#14233a]">
                Build before you sign.
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7a8798]">
                CoinLens creates multiple valid transaction constructions
                before any signature is produced.
              </p>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-sm font-bold text-[#35445a]">
                Destination
              </label>

              <div className="relative">
                <MapPin
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9aa6b5]"
                />

                <input
                  value={destination}
                  onChange={(event) =>
                    setDestination(event.target.value)
                  }
                  className="h-14 w-full rounded-xl border border-[#d8e0ea] bg-white pl-11 pr-4 font-mono text-sm text-[#25344a] outline-none focus:border-[#2d67aa] focus:ring-4 focus:ring-blue-50"
                />
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">

              <div>
                <label className="mb-2 block text-sm font-bold text-[#35445a]">
                  Amount
                </label>

                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.target.value)
                    }
                    className="h-14 w-full rounded-xl border border-[#d8e0ea] bg-white px-4 pr-16 text-sm text-[#25344a] outline-none focus:border-[#2d67aa] focus:ring-4 focus:ring-blue-50"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#8c98a8]">
                    sats
                  </span>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-[#35445a]">
                  Fee rate
                </label>

                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    value={feeRate}
                    onChange={(event) =>
                      setFeeRate(event.target.value)
                    }
                    className="h-14 w-full rounded-xl border border-[#d8e0ea] bg-white px-4 pr-20 text-sm text-[#25344a] outline-none focus:border-[#2d67aa] focus:ring-4 focus:ring-blue-50"
                  />

                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#8c98a8]">
                    sat/vB
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onManageUtxos}
              className="mt-5 flex items-center gap-2 text-sm font-bold text-[#2d67aa] hover:underline"
            >
              <Tag size={15} />
              Manage UTXO tags & clusters
            </button>

            {error && (
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <CircleAlert size={18} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={onPlan}
              disabled={loading}
              className="mt-7 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#2d67aa] text-sm font-bold text-white shadow-[0_12px_25px_rgba(45,103,170,0.18)] transition hover:bg-[#255d9d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <RefreshCw size={18} className="animate-spin" />
                  Building candidates...
                </>
              ) : (
                <>
                  Plan Transaction
                  <ArrowRight size={19} />
                </>
              )}
            </button>
          </section>

          <section className="rounded-[24px] border border-[#dce4ed] bg-[#f9fbfd] p-7">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[#eaf2fb] text-[#2d67aa]">
              <Shield size={21} />
            </div>

            <h2 className="text-xl font-semibold text-[#1b2b42]">
              Pre-signing privacy
            </h2>

            <p className="mt-2 text-sm leading-6 text-[#7b8798]">
              Compare transaction construction before your wallet
              commits a signature.
            </p>

            <div className="mt-7 space-y-4">
              <InfoRow
                icon={<BarChart3 size={17} />}
                title="Multiple candidates"
                text="Different valid UTXO selections."
              />

              <InfoRow
                icon={<ShieldCheck size={17} />}
                title="Privacy trade-offs"
                text="Input linking and change implications."
              />

              <InfoRow
                icon={<Wallet size={17} />}
                title="Future wallet impact"
                text="See which UTXOs are preserved or consumed."
              />

              <InfoRow
                icon={<LockKeyhole size={17} />}
                title="Hardware signing"
                text="Signing stays behind the Ledger boundary."
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}


function InfoRow({ icon, title, text }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#2d67aa] shadow-sm">
        {icon}
      </div>

      <div>
        <div className="text-sm font-bold text-[#36465d]">
          {title}
        </div>

        <div className="mt-0.5 text-xs leading-5 text-[#8a96a6]">
          {text}
        </div>
      </div>
    </div>
  );
}


// Picks the candidate with the fewest privacy/wallet trade-offs (cons) to
// nudge undecided users, without hiding the other option or its own merits.
function getRecommendedCandidateId(candidates) {
  const valid = candidates.filter((candidate) => candidate?.valid !== false);

  if (valid.length < 2) return null;

  const sorted = [...valid].sort(
    (a, b) => (a.cons?.length || 0) - (b.cons?.length || 0)
  );

  const [best, secondBest] = sorted;

  // Only recommend when there is a clear-cut winner, not a tie.
  if ((best.cons?.length || 0) === (secondBest.cons?.length || 0)) {
    return null;
  }

  return best.candidate_id;
}


// ============================================================
// CANDIDATE CARD
// ============================================================

// ============================================================
// UTXO CLUSTER VISUALIZATION
//
// A small, dependency-free SVG diagram: one node per input (colored by its
// wallet-side metadata cluster), converging into the transaction, then
// branching out to the payment and (optionally) change outputs. This makes
// "this candidate merges two clusters" or "spends a rare coin" visible at a
// glance instead of only readable as a sentence.
// ============================================================

const CLUSTER_PALETTE = [
  "#2d67aa",
  "#f28a18",
  "#3fa37a",
  "#a45fbf",
  "#c94f4f",
  "#4aa3c4",
];

function clusterColor(clusterName, clusterOrder) {
  const idx = clusterOrder.indexOf(clusterName);
  return CLUSTER_PALETTE[idx % CLUSTER_PALETTE.length] || "#8b98aa";
}

function CandidateGraph({ candidate, compact = false }) {
  const inputCount = Math.max(candidate?.input_count ?? 0, 0);

  if (inputCount === 0) {
    return null;
  }

  // We don't have a per-input cluster breakdown from the API (only the set
  // of distinct clusters touched), so when there's more than one cluster we
  // spread the inputs across them evenly for a representative picture. A
  // single-cluster candidate (the common case) renders exactly.
  const clusters = candidate?.clusters?.length ? candidate.clusters : ["Unlabeled"];
  const inputNodes = Array.from({ length: inputCount }, (_, i) => ({
    id: i,
    cluster: clusters[i % clusters.length],
    rare: candidate?.rare_utxo_consumed && i === 0,
  }));

  const height = compact ? 116 : 168;
  const width = compact ? 260 : 340;
  const txX = width * 0.52;
  const outX = width * 0.86;
  const inX = width * 0.14;

  const inputSpacing = height / (inputNodes.length + 1);
  const hasChange = Boolean(candidate?.change_created);
  const outputYs = hasChange ? [height * 0.32, height * 0.72] : [height * 0.5];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="UTXO cluster diagram for this candidate"
    >
      {inputNodes.map((node, i) => {
        const y = inputSpacing * (i + 1);
        const color = clusterColor(node.cluster, clusters);
        return (
          <g key={node.id}>
            <line
              x1={inX + 9}
              y1={y}
              x2={txX - 9}
              y2={height / 2}
              stroke={color}
              strokeWidth="1.5"
              opacity="0.55"
            />
            <circle cx={inX} cy={y} r="9" fill={color} />
            {node.rare && (
              <circle
                cx={inX}
                cy={y}
                r="13"
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeDasharray="2,2"
              />
            )}
          </g>
        );
      })}

      <line
        x1={txX + 9}
        y1={height / 2}
        x2={outX - 9}
        y2={outputYs[0]}
        stroke="#8b98aa"
        strokeWidth="1.5"
        opacity="0.55"
      />
      {hasChange && (
        <line
          x1={txX + 9}
          y1={height / 2}
          x2={outX - 9}
          y2={outputYs[1]}
          stroke="#8b98aa"
          strokeWidth="1.5"
          opacity="0.55"
        />
      )}

      <rect
        x={txX - 9}
        y={height / 2 - 9}
        width="18"
        height="18"
        rx="4"
        fill="#15243a"
      />

      {outputYs.map((y, i) => (
        <circle
          key={i}
          cx={outX}
          cy={y}
          r="8"
          fill={i === 0 ? "#3fa37a" : "#d8cf9a"}
        />
      ))}
    </svg>
  );
}


function CandidateCard({
  candidate,
  index,
  selected,
  onSelect,
}) {
  const privacy = candidate?.privacy || {};
  const clusters = normalizeClusters(privacy?.clusters);

  const inputCount =
    candidate?.input_count ??
    candidate?.inputs?.length ??
    0;

  const inputTotal =
    candidate?.input_total_sats ??
    candidate?.input_total ??
    0;

  const fee =
    candidate?.fee_sats ??
    candidate?.fee ??
    0;

  const change =
    candidate?.change_sats ??
    candidate?.change ??
    0;

  const observations = Array.isArray(
    privacy?.observations
  )
    ? privacy.observations
    : [];

  const tradeoffs = Array.isArray(
    privacy?.tradeoffs
  )
    ? privacy.tradeoffs
    : [];

  const candidateLabel = candidateName(
    candidate,
    index
  );

  const isCheapest = Boolean(
    candidate?.is_cheapest_fee
  );

  const isSuggested = Boolean(
    candidate?.suggested ||
    candidate?.is_suggested ||
    candidate?.recommended
  );

  // A candidate with zero inputs is not a valid
  // transaction candidate.
  const isUnavailable =
    Number(inputCount) === 0;

  return (
    <div
      className={`coinlens-candidate-card ${
        selected ? "is-selected" : ""
      } ${isUnavailable ? "opacity-90" : ""}`}
    >
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="coinlens-candidate-label">
            {candidateLabel}
          </div>

          <h3 className="coinlens-candidate-title">
            {isUnavailable
              ? "Strategy unavailable"
              : "Transaction candidate"}
          </h3>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {isSuggested && !isUnavailable && (
            <span className="coinlens-badge coinlens-badge-success">
              Suggested
            </span>
          )}

          {isCheapest && !isUnavailable && (
            <span className="coinlens-badge coinlens-badge-warning">
              Cheapest fee
            </span>
          )}

          {selected && !isUnavailable && (
            <span className="coinlens-badge coinlens-badge-selected">
              <Check size={12} />
              Selected
            </span>
          )}

          {isUnavailable && (
            <span className="coinlens-badge coinlens-badge-warning">
              Unavailable
            </span>
          )}
        </div>
      </div>

      {/* UNAVAILABLE STRATEGY */}
      {isUnavailable ? (
        <div className="mt-6">
          <div className="rounded-2xl border border-[#f0dfc7] bg-[#fffaf3] p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff0d8] text-[#b87521]">
                <CircleAlert size={17} />
              </div>

              <div>
                <div className="text-sm font-bold text-[#8c5b1d]">
                  No valid transaction could be constructed
                </div>

                <div className="mt-1 text-sm leading-6 text-[#7b6b59]">
                  This strategy could not produce a
                  spendable transaction for the current
                  wallet state and payment.
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-[#f8fafc] px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-[#8b98aa]">
              Why this matters
            </div>

            <div className="mt-1 text-sm leading-6 text-[#66758a]">
              CoinLens keeps this strategy visible so
              you can see that the constraint was tested,
              rather than treating an invalid result as a
              valid transaction.
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* VALID TRANSACTION METRICS */}
          <div className="coinlens-metrics">
            <div className="coinlens-metric">
              <div className="coinlens-metric-label">
                Inputs
              </div>

              <div className="coinlens-metric-value">
                {inputCount}
              </div>
            </div>

            <div className="coinlens-metric">
              <div className="coinlens-metric-label">
                Input total
              </div>

              <div className="coinlens-metric-value">
                {formatSats(inputTotal)} sats
              </div>
            </div>

            <div className="coinlens-metric">
              <div className="coinlens-metric-label">
                Fee
              </div>

              <div className="coinlens-metric-value">
                {formatSats(fee)} sats
              </div>
            </div>

            <div className="coinlens-metric">
              <div className="coinlens-metric-label">
                Change
              </div>

              <div className="coinlens-metric-value">
                {formatSats(change)} sats
              </div>
            </div>
          </div>

          {/* PRIVACY OBSERVATIONS */}
          <div className="coinlens-info-section">
            <div className="coinlens-section-title">
              <ShieldCheck size={15} />
              Privacy observations
            </div>

            {observations.length > 0 ? (
              observations
                .slice(0, 4)
                .map(
                  (
                    observation,
                    observationIndex
                  ) => (
                    <div
                      key={observationIndex}
                      className="coinlens-observation"
                    >
                      <span className="coinlens-observation-dot" />

                      <span>
                        {observation}
                      </span>
                    </div>
                  )
                )
            ) : (
              <div className="coinlens-observation">
                <span className="coinlens-observation-dot" />

                <span>
                  No additional privacy observations
                  returned.
                </span>
              </div>
            )}

            {clusters.length > 0 && (
              <div className="coinlens-observation mt-3">
                <span className="coinlens-observation-dot" />

                <span>
                  Wallet cluster:{" "}
                  <strong className="font-bold text-[#34445b]">
                    {clusters.join(", ")}
                  </strong>
                </span>
              </div>
            )}
          </div>

          {/* TRADE-OFFS */}
          {tradeoffs.length > 0 && (
            <div className="coinlens-info-section">
              <div className="coinlens-section-title text-[#a86a20]">
                <CircleAlert size={15} />
                Trade-offs
              </div>

              {tradeoffs
                .slice(0, 3)
                .map(
                  (
                    tradeoff,
                    tradeoffIndex
                  ) => (
                    <div
                      key={tradeoffIndex}
                      className="coinlens-tradeoff"
                    >
                      <span className="coinlens-tradeoff-dot" />

                      <span>
                        {tradeoff}
                      </span>
                    </div>
                  )
                )}
            </div>
          )}

          {/* FUTURE WALLET IMPACT */}
          {privacy?.future_optionality && (
            <div className="coinlens-optionality">
              <div className="coinlens-optionality-title">
                Future wallet impact
              </div>

              <div className="coinlens-optionality-text">
                {typeof privacy.future_optionality ===
                "string"
                  ? privacy.future_optionality
                  : JSON.stringify(
                      privacy.future_optionality
                    )}
              </div>
            </div>
          )}

          {/* CHOOSE CANDIDATE */}
          <button
            onClick={() =>
              onSelect(
                getCandidateId(candidate, index)
              )
            }
            className={
              selected
                ? "coinlens-primary-button"
                : "coinlens-secondary-button mt-6 w-full"
            }
          >
            {selected
              ? "Selected candidate"
              : "Choose candidate"}

            <ArrowRight size={17} />
          </button>
        </>
      )}
    </div>
  );
}


function Metric({ label, value, badge }) {
  return (
    <div>
      <div className="mb-2 text-center text-[11px] font-semibold text-[#8b98aa]">
        {label}
      </div>

      <div className="text-center text-sm font-bold text-[#1c2d45]">
        {value}
      </div>

      {badge && (
        <div
          className={`mt-1 text-center text-[10px] font-bold ${
            badge === "Cheapest" ? "text-emerald-600" : "text-[#c9822e]"
          }`}
        >
          {badge}
        </div>
      )}
    </div>
  );
}


function BulletRow({ text, accent = false }) {
  return (
    <div className="flex items-start gap-3 text-sm leading-5 text-[#68778c]">
      <span
        className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
          accent ? "bg-[#f28a18]" : "bg-[#5a87b7]"
        }`}
      />

      <span>{text}</span>
    </div>
  );
}


// ============================================================
// COMPARISON SCREEN
// ============================================================

function ComparisonScreen({
  candidates,
  comparison,
  selectedId,
  onSelect,
  onBack,
  onDetails,
  onWhatIf,
  scenarioLabel,
  ledgerConnected,
}) {
 return (
  <div className="min-h-screen bg-[#f6f8fb]">
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 flex justify-end">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-xl border border-[#dce4ed] bg-white px-4 py-2.5 text-sm font-semibold text-[#526176] hover:bg-[#f8fafc]"
          >
            <ArrowLeft size={16} />
            Back
          </button>

            <div className="flex items-center gap-2 rounded-full border border-[#dce4ed] bg-white px-3 py-2 text-xs font-semibold text-[#66758a]">
              <span
                className={`h-2 w-2 rounded-full ${
                  ledgerConnected
                    ? "bg-emerald-500"
                    : "bg-slate-300"
                }`}
              />
              {ledgerConnected
                ? "Ledger ready"
                : "Watch-only"}
            </div>
          </div>
        </div>

        <div className="comparison-heading mb-8">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#f28a18]">
            Transaction Comparison
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-[#14233a]">
                Choose how the payment is constructed.
              </h1>

              <p className="mt-3 text-base text-[#7c899c]">
                {scenarioLabel
                  ? `What-If scenario: ${scenarioLabel}. Compare the resulting transaction constructions.`
                  : "Same payment. Different inputs. Different privacy and future-wallet trade-offs."}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={onWhatIf}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#2d67aa] bg-white px-5 py-3 text-sm font-bold text-[#2d67aa] transition hover:bg-[#f2f7fc]"
              >
                <SlidersHorizontal size={17} />
                What-If Analysis
              </button>

              <button
                onClick={onDetails}
                className="flex items-center justify-center gap-2 rounded-xl border border-[#d7e0ea] bg-white px-5 py-3 text-sm font-bold text-[#35465d] transition hover:bg-[#f8fafc]"
              >
                View Detailed Comparison
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </div>

        {candidates.length > 0 ? (
          <div className="grid gap-6 xl:grid-cols-2">
            {candidates.map((candidate, index) => (
              <CandidateCard
                key={getCandidateId(candidate, index)}
                candidate={candidate}
                index={index}
                selected={
                  selectedId === getCandidateId(candidate, index)
                }
                recommended={
                  getCandidateId(candidate, index) ===
                  getRecommendedCandidateId(candidates)
                }
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-[#dce4ed] bg-white p-10 text-center">
            <CircleAlert className="mx-auto mb-3 text-amber-500" />
            <p className="text-sm text-[#68778c]">
              No candidates were returned.
            </p>
          </div>
        )}


      </div>
    </div>
  );
}


// ============================================================
// DETAILS MODAL
// ============================================================

function DetailsModal({
  candidates,
  comparison,
  onClose,
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#12223a]/45 p-4 backdrop-blur-sm">
      <div className="mx-auto min-h-full max-w-6xl py-5">
        <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-2xl">

          {/* HEADER */}
          <div className="flex items-start justify-between border-b border-[#e5eaf0] px-8 py-7">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
                Window 03
              </div>

              <h2 className="text-3xl font-semibold tracking-tight text-[#17263c]">
                Detailed trade-offs
              </h2>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#7c899c]">
                Review what each transaction construction changes before
                selecting the PSBT to sign.
              </p>
            </div>

            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#dce4ed] text-[#66758a] transition hover:bg-[#f7f9fc]"
            >
              <X size={21} />
            </button>
          </div>

          {/* COMPARISON OVERVIEW */}
          <div className="border-b border-[#e5eaf0] bg-[#f8fafc] px-8 py-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#2d67aa] shadow-sm">
                <BarChart3 size={18} />
              </div>

              <div>
                <div className="text-sm font-bold text-[#34445a]">
                  Comparison overview
                </div>

                <div className="mt-1 text-sm leading-6 text-[#7c899c]">
                  CoinLens compares the concrete transaction differences
                  below — fees, inputs, clusters, change, and future wallet
                  implications — before any signature is produced.
                </div>
              </div>
            </div>
          </div>

          {/* CANDIDATE DETAILS */}
          <div className="grid gap-5 p-8 lg:grid-cols-2">
            {candidates.map((candidate, index) => {
              const tradeoff = getTradeoff(candidate);

              const observations = tradeoff.observations || [];
              const tradeoffs = tradeoff.tradeoffs || [];

              const privacy = candidate?.privacy || {};
              const transaction = candidate?.transaction || {};

              const clusters = normalizeClusters(
                candidate?.clusters ??
                  privacy?.clusters_used ??
                  privacy?.clusters ??
                  []
              );

              const inputCount =
                candidate?.input_count ??
                transaction?.input_count ??
                candidate?.inputs?.length ??
                0;

              const fee =
                candidate?.fee_sats ??
                transaction?.fee_sats ??
                candidate?.fee ??
                0;

              const change =
                candidate?.change_sats ??
                transaction?.change_sats ??
                candidate?.change ??
                0;

              const feeDelta =
                candidate?.fee_delta_vs_cheapest_sats ??
                candidate?.fee_delta ??
                0;

              const futureOptionality =
                candidate?.future_optionality;

              return (
                <div
                  key={getCandidateId(candidate, index)}
                  className="rounded-2xl border border-[#dce4ed] bg-[#fbfcfe] p-7"
                >

                  {/* CANDIDATE HEADER */}
                  <div className="mb-5 text-center text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
                    Candidate {getCandidateId(candidate, index)}
                  </div>

                  <div className="mb-7 text-center text-lg font-bold leading-7 text-[#34445c]">
                    {candidate?.strategy_name ||
                      candidate?.name ||
                      "Transaction construction"}
                  </div>

                  {/* METRICS */}
                  <div className="mb-7 grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-[#e3e9f0] bg-[#f8fafc] p-4 text-center">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8b98aa]">
                        Fee
                      </div>

                      <div className="mt-1 text-lg font-bold text-[#1d2c43]">
                        {formatSats(fee)} sats
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#e3e9f0] bg-[#f8fafc] p-4 text-center">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8b98aa]">
                        Change
                      </div>

                      <div className="mt-1 text-lg font-bold text-[#1d2c43]">
                        {formatSats(change)} sats
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#e3e9f0] bg-[#f8fafc] p-4 text-center">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8b98aa]">
                        Inputs
                      </div>

                      <div className="mt-1 text-lg font-bold text-[#1d2c43]">
                        {inputCount}
                      </div>
                    </div>
                  </div>

                  {/* FEE DIFFERENCE */}
                  {feeDelta !== undefined &&
                    feeDelta !== null && (
                      <div className="mb-5 rounded-xl border border-[#e8edf2] bg-[#fbfcfe] px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[#8b98aa]">
                          Fee difference
                        </div>

                        <div className="mt-1 text-sm font-bold text-[#526176]">
                          {Number(feeDelta) === 0
                            ? "Lowest fee among the generated candidates"
                            : `${formatSats(
                                feeDelta
                              )} sats more than the cheapest candidate`}
                        </div>
                      </div>
                    )}

                  {/* CLUSTERS */}
                  {clusters.length > 0 && (
                    <div className="mb-6">
                      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#8b98aa]">
                        Metadata cluster
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {clusters.map((cluster, clusterIndex) => (
                          <span
                            key={clusterIndex}
                            className="rounded-full bg-[#eef4fb] px-3 py-1.5 text-xs font-bold text-[#35679b]"
                          >
                            {cluster}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* OBSERVATIONS */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#32825c]">
                      <Check size={17} />
                      Observations
                    </div>

                    <div className="space-y-2">
                      {observations.length > 0 ? (
                        observations.map((item, itemIndex) => (
                          <div
                            key={itemIndex}
                            className="flex items-start gap-3 rounded-xl bg-[#f7fbf8] px-4 py-3"
                          >
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dff2e7] text-xs font-bold text-[#32825c]">
                              ✓
                            </span>

                            <span className="text-sm leading-6 text-[#5e6d80]">
                              {item}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl bg-[#f8fafc] px-4 py-3 text-sm text-[#7c899c]">
                          No additional observations returned.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* TRADE-OFFS */}
                  <div className="mb-6">
                    <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#bd7419]">
                      <CircleAlert size={17} />
                      Trade-offs
                    </div>

                    <div className="space-y-2">
                      {tradeoffs.length > 0 ? (
                        tradeoffs.map((item, itemIndex) => (
                          <div
                            key={itemIndex}
                            className="flex items-start gap-3 rounded-xl bg-[#fffaf3] px-4 py-3"
                          >
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ffeac8] text-xs font-bold text-[#bd7419]">
                              !
                            </span>

                            <span className="text-sm leading-6 text-[#5e6d80]">
                              {item}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl bg-[#f8fafc] px-4 py-3 text-sm text-[#7c899c]">
                          No additional trade-offs returned.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* FUTURE OPTIONALITY */}
                  {futureOptionality && (
                    <div className="rounded-xl border border-[#dce7f2] bg-[#f5f9fd] p-4">
                      <div className="text-xs font-bold uppercase tracking-wide text-[#6d7f94]">
                        Future wallet flexibility
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm text-[#65758a]">
                            Rare / important UTXO consumed
                          </span>

                          <span className="text-sm font-bold text-[#506176]">
                            {futureOptionality.rare_utxo_consumed
                              ? "Yes"
                              : "No"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sm text-[#65758a]">
                            Unique cluster consumed
                          </span>

                          <span className="text-sm font-bold text-[#506176]">
                            {futureOptionality.unique_cluster_consumed
                              ? "Yes"
                              : "No"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* FOOTER */}
          <div className="border-t border-[#e5eaf0] bg-[#fbfcfe] px-8 py-5">
            <div className="text-xs leading-5 text-[#8a97a8]">
              CoinLens presents transaction-level differences so the wallet
              owner can review the consequences before signing.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
// ============================================================
// WHAT-IF MODAL
// ============================================================

function WhatIfModal({
  destination,
  amount,
  feeRate,
  onClose,
  onApply,
  loading,
}) {
  const [scenarioType, setScenarioType] = useState("fee");

  const [feeScenario, setFeeScenario] = useState("5");
  const [customFee, setCustomFee] = useState("");

  const [paymentScenario, setPaymentScenario] =
    useState("10");

  const [customPayment, setCustomPayment] =
    useState("");

  const [preserveReserve, setPreserveReserve] =
    useState(false);

  const [maxInputs, setMaxInputs] =
    useState("any");

  const currentAmount = Number(amount || 0);
  const currentFeeRate = Number(feeRate || 0);

  const nextFeeRate =
    feeScenario === "custom"
      ? Number(customFee || 0)
      : Number(feeScenario);

  let nextAmount = currentAmount;

  if (scenarioType === "payment") {
    if (paymentScenario === "custom") {
      nextAmount =
        currentAmount + Number(customPayment || 0);
    } else {
      nextAmount =
        currentAmount + Number(paymentScenario);
    }
  }

  const scenarioLabel =
    scenarioType === "fee"
      ? `Fee rate: ${nextFeeRate} sat/vB`
      : `Payment: ${formatSats(nextAmount)} sats`;

  const runScenario = () => {
    if (!destination.trim()) return;

    const amountSats =
      scenarioType === "payment"
        ? nextAmount
        : currentAmount;

    const feeRateSatVb =
      scenarioType === "fee"
        ? nextFeeRate
        : currentFeeRate;

    const scenario =
      scenarioType === "fee"
        ? `Fee rate changed to ${feeRateSatVb} sat/vB`
        : `Payment changed to ${formatSats(amountSats)} sats`;

    onApply({
      destination,
      amount_sats: amountSats,
      fee_rate_sat_vb: feeRateSatVb,

      exclude_utxo_ids: preserveReserve
        ? ["reserve"]
        : [],

      max_inputs:
        maxInputs === "single"
          ? 1
          : null,

      scenario,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#12223a]/45 p-5 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-2xl">

        <div className="flex items-start justify-between border-b border-[#e5eaf0] px-7 py-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
              <SlidersHorizontal size={15} />
              What-If Analysis
            </div>

            <h2 className="text-2xl font-semibold text-[#17263c]">
              Change the assumptions.
            </h2>

            <p className="mt-2 text-sm text-[#7b8798]">
              Rebuild the candidates without signing anything.
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={loading}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dce4ed] text-[#66758a] hover:bg-[#f7f9fc] disabled:opacity-50"
          >
            <X size={19} />
          </button>
        </div>

        <div className="space-y-6 p-7">

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setScenarioType("fee")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                scenarioType === "fee"
                  ? "border-[#2d67aa] bg-[#eef5fc] text-[#2d67aa]"
                  : "border-[#dce4ed] bg-white text-[#65758a]"
              }`}
            >
              Change fee
            </button>

            <button
              onClick={() => setScenarioType("payment")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                scenarioType === "payment"
                  ? "border-[#2d67aa] bg-[#eef5fc] text-[#2d67aa]"
                  : "border-[#dce4ed] bg-white text-[#65758a]"
              }`}
            >
              Change payment
            </button>
          </div>

          {scenarioType === "fee" ? (
            <div>
              <label className="mb-3 block text-sm font-bold text-[#35445a]">
                New fee rate
              </label>

              <div className="grid grid-cols-4 gap-2">
                {["2", "5", "10", "custom"].map((option) => (
                  <button
                    key={option}
                    onClick={() => setFeeScenario(option)}
                    className={`rounded-xl border px-3 py-3 text-sm font-bold ${
                      feeScenario === option
                        ? "border-[#2d67aa] bg-[#eef5fc] text-[#2d67aa]"
                        : "border-[#dce4ed] text-[#68778c]"
                    }`}
                  >
                    {option === "custom"
                      ? "Custom"
                      : `${option} sat/vB`}
                  </button>
                ))}
              </div>

              {feeScenario === "custom" && (
                <input
                  type="number"
                  min="1"
                  value={customFee}
                  onChange={(event) =>
                    setCustomFee(event.target.value)
                  }
                  placeholder="Enter fee rate"
                  className="mt-3 h-12 w-full rounded-xl border border-[#d8e0ea] px-4 text-sm outline-none focus:border-[#2d67aa]"
                />
              )}
            </div>
          ) : (
            <div>
              <label className="mb-3 block text-sm font-bold text-[#35445a]">
                Increase payment by
              </label>

              <div className="grid grid-cols-4 gap-2">
                {["10", "25", "50", "custom"].map((option) => (
                  <button
                    key={option}
                    onClick={() =>
                      setPaymentScenario(option)
                    }
                    className={`rounded-xl border px-3 py-3 text-sm font-bold ${
                      paymentScenario === option
                        ? "border-[#2d67aa] bg-[#eef5fc] text-[#2d67aa]"
                        : "border-[#dce4ed] text-[#68778c]"
                    }`}
                  >
                    {option === "custom"
                      ? "Custom"
                      : `+${option} sats`}
                  </button>
                ))}
              </div>

              {paymentScenario === "custom" && (
                <input
                  type="number"
                  min="1"
                  value={customPayment}
                  onChange={(event) =>
                    setCustomPayment(event.target.value)
                  }
                  placeholder="Additional sats"
                  className="mt-3 h-12 w-full rounded-xl border border-[#d8e0ea] px-4 text-sm outline-none focus:border-[#2d67aa]"
                />
              )}
            </div>
          )}

          <div className="rounded-xl border border-[#e2e8ef] bg-[#f8fafc] p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={preserveReserve}
                onChange={(event) =>
                  setPreserveReserve(event.target.checked)
                }
                className="mt-1 h-4 w-4"
              />

              <span>
                <span className="block text-sm font-bold text-[#35445a]">
                  Preserve tagged reserve
                </span>

                <span className="mt-1 block text-xs leading-5 text-[#7e8b9c]">
                  Ask the planner to avoid the demo wallet's
                  tagged reserve UTXO.
                </span>
              </span>
            </label>
          </div>

          <div>
            <label className="mb-3 block text-sm font-bold text-[#35445a]">
              Maximum inputs
            </label>

            <select
              value={maxInputs}
              onChange={(event) =>
                setMaxInputs(event.target.value)
              }
              className="h-12 w-full rounded-xl border border-[#d8e0ea] bg-white px-4 text-sm text-[#43536a] outline-none focus:border-[#2d67aa]"
            >
              <option value="any">
                Any number of inputs
              </option>

              <option value="single">
                Single input only
              </option>
            </select>
          </div>

          <div className="rounded-xl border border-[#dbe5ef] bg-[#f7fafc] p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#8a97a8]">
              Scenario
            </div>

            <div className="mt-1 text-sm font-bold text-[#33445b]">
              {scenarioLabel}
            </div>
          </div>

          <button
            onClick={runScenario}
            disabled={loading}
            className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#2d67aa] text-sm font-bold text-white transition hover:bg-[#255d9d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <RefreshCw
                  size={17}
                  className="animate-spin"
                />
                Rebuilding candidates...
              </>
            ) : (
              <>
                Run What-If Analysis
                <ArrowRight size={17} />
              </>
            )}
          </button>

        </div>
      </div>
    </div>
  );
}
// ============================================================
// DOWNLOAD PSBT
// ============================================================

// ============================================================
// UTXO LABEL MANAGER
//
// Lets a user tag their own wallet-side clusters, free-text labels, and
// rare/reserve flags on individual UTXOs, persisted server-side (see
// backend/utxo_labels.py) instead of the fixed built-in demo metadata.
// ============================================================

function UtxoLabelModal({ onClose }) {
  const [utxos, setUtxos] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  const loadUtxos = async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/utxos`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Could not load UTXOs.");
      }

      const list = Array.isArray(data.utxos) ? data.utxos : [];
      setUtxos(list);

      const nextDrafts = {};
      for (const utxo of list) {
        nextDrafts[utxo.outpoint] = {
          cluster: utxo.cluster || "",
          label: utxo.label || "",
          rare: Boolean(utxo.rare),
        };
      }
      setDrafts(nextDrafts);
    } catch (err) {
      setError(err.message || "Could not load UTXOs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUtxos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDraft = (outpoint, patch) => {
    setDrafts((prev) => ({
      ...prev,
      [outpoint]: { ...prev[outpoint], ...patch },
    }));
  };

  const saveTag = async (outpoint) => {
    const draft = drafts[outpoint] || {};
    setSavingId(outpoint);
    setError("");

    try {
      const response = await fetch(`${API_URL}/utxos/label`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outpoint,
          cluster: draft.cluster,
          label: draft.label,
          rare: draft.rare,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || "Could not save this tag.");
      }

      setUtxos((prev) =>
        prev.map((utxo) =>
          utxo.outpoint === outpoint
            ? { ...utxo, cluster: draft.cluster, label: draft.label, rare: draft.rare }
            : utxo
        )
      );
    } catch (err) {
      setError(err.message || "Could not save this tag.");
    } finally {
      setSavingId(null);
    }
  };

  const resetTag = async (outpoint) => {
    setSavingId(outpoint);
    setError("");

    try {
      await fetch(`${API_URL}/utxos/unlabel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outpoint }),
      });

      await loadUtxos();
    } catch (err) {
      setError(err.message || "Could not reset this tag.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#12223a]/45 p-4 backdrop-blur-sm">
      <div className="mx-auto min-h-full max-w-4xl py-5">
        <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-2xl">

          <div className="flex items-start justify-between border-b border-[#e5eaf0] px-8 py-7">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
                <Tag size={14} />
                UTXO Tags
              </div>

              <h2 className="text-2xl font-semibold text-[#17263c]">
                Manage your wallet-side clusters
              </h2>

              <p className="mt-2 max-w-xl text-sm leading-6 text-[#7c899c]">
                These tags are your own labels for this wallet's coins --
                they drive the "Single Cluster Only" candidate and the
                rare/reserve-coin warnings, and they persist across sessions.
              </p>
            </div>

            <button
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#dce4ed] text-[#66758a] hover:bg-[#f7f9fc]"
            >
              <X size={21} />
            </button>
          </div>

          {error && (
            <div className="mx-8 mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <CircleAlert size={17} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto p-8">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#7c899c]">
                <RefreshCw size={16} className="animate-spin" />
                Loading UTXOs...
              </div>
            ) : utxos.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#7c899c]">
                No UTXOs found in the active wallet.
              </div>
            ) : (
              <div className="space-y-4">
                {utxos.map((utxo) => {
                  const draft = drafts[utxo.outpoint] || {
                    cluster: "",
                    label: "",
                    rare: false,
                  };
                  const isSaving = savingId === utxo.outpoint;

                  return (
                    <div
                      key={utxo.outpoint}
                      className="rounded-2xl border border-[#dce4ed] bg-[#fbfcfe] p-5"
                    >
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-xs text-[#526176]">
                          {shortText(utxo.outpoint, 10, 6)}
                        </div>
                        <div className="text-sm font-bold text-[#1c2d45]">
                          {formatSats(utxo.amount_sats)} sats
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                        <input
                          value={draft.cluster}
                          onChange={(event) =>
                            updateDraft(utxo.outpoint, { cluster: event.target.value })
                          }
                          placeholder="Cluster (e.g. Alpha)"
                          className="h-11 rounded-lg border border-[#d8e0ea] bg-white px-3 text-sm text-[#25344a] outline-none focus:border-[#2d67aa] focus:ring-4 focus:ring-blue-50"
                        />

                        <input
                          value={draft.label}
                          onChange={(event) =>
                            updateDraft(utxo.outpoint, { label: event.target.value })
                          }
                          placeholder="Label (optional)"
                          className="h-11 rounded-lg border border-[#d8e0ea] bg-white px-3 text-sm text-[#25344a] outline-none focus:border-[#2d67aa] focus:ring-4 focus:ring-blue-50"
                        />

                        <label className="flex h-11 items-center gap-2 rounded-lg border border-[#d8e0ea] bg-white px-3 text-sm text-[#526176]">
                          <input
                            type="checkbox"
                            checked={draft.rare}
                            onChange={(event) =>
                              updateDraft(utxo.outpoint, { rare: event.target.checked })
                            }
                          />
                          Rare
                        </label>

                        <div className="flex gap-2">
                          <button
                            onClick={() => saveTag(utxo.outpoint)}
                            disabled={isSaving}
                            className="h-11 rounded-lg bg-[#2d67aa] px-4 text-sm font-bold text-white transition hover:bg-[#255d9d] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Save
                          </button>

                          <button
                            onClick={() => resetTag(utxo.outpoint)}
                            disabled={isSaving}
                            className="h-11 rounded-lg border border-[#d8e0ea] px-3 text-sm font-bold text-[#526176] transition hover:bg-[#f1f5f9] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function downloadPsbt(psbt, candidateId) {
  if (!psbt) return;

  const blob = new Blob([psbt], {
    type: "text/plain;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `coinlens-candidate-${candidateId}.psbt.txt`;

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
}


// ============================================================
// REVIEW MODAL
// ============================================================

function ReviewModal({
  candidate,
  candidateId,
  psbt,
  signedPsbt,
  finalized,
  broadcast,
  ledgerConnected,
  signing,
  finalizing,
  broadcasting,
  onSign,
  onFinalize,
  onBroadcast,
  onDownload,
  onCopyPsbt,
  onClose,
}) {
  const isSigned = Boolean(signedPsbt);
  const isFinalized = Boolean(finalized);
  const isBroadcast = Boolean(broadcast);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#12223a]/45 p-5 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-[24px] bg-white shadow-2xl">

        <div className="flex items-start justify-between border-b border-[#e5eaf0] px-7 py-6">
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
              Signing Review
            </div>

            <h2 className="text-2xl font-semibold text-[#17263c]">
              Review before signing.
            </h2>
          </div>

          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#dce4ed] text-[#66758a] hover:bg-[#f7f9fc]"
          >
            <X size={19} />
          </button>
        </div>

        <div className="space-y-5 p-7">

          <div className="rounded-xl border border-[#dce4ed] bg-[#f8fafc] p-5">
            <div className="text-xs font-bold uppercase tracking-wider text-[#8a97a8]">
              Selected candidate
            </div>

            <div className="mt-2 text-lg font-bold text-[#34445a]">
              {candidateName(candidate)}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Metric
                label="Inputs"
                value={
                  candidate?.input_count ??
                  candidate?.inputs?.length ??
                  0
                }
              />

              <Metric
                label="Fee"
                value={`${formatSats(
                  candidate?.fee_sats ??
                    candidate?.fee ??
                    0
                )} sats`}
              />

              <Metric
                label="Change"
                value={`${formatSats(
                  candidate?.change_sats ??
                    candidate?.change ??
                    0
                )} sats`}
              />
            </div>
          </div>

          <div className="rounded-xl border border-[#dce4ed] p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#34445a]">
              <FileCheck2 size={17} />
              PSBT
            </div>

            <div className="break-all font-mono text-xs leading-5 text-[#7b8798]">
              {shortText(psbt, 30, 30)}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <button
                onClick={onDownload}
                className="flex items-center gap-2 text-sm font-bold text-[#2d67aa]"
              >
                <Download size={16} />
                Export PSBT
              </button>

              <button
                onClick={() => onCopyPsbt?.(psbt)}
                className="flex items-center gap-2 text-sm font-bold text-[#526176]"
              >
                <FileCheck2 size={16} />
                Copy PSBT
              </button>
            </div>
          </div>

          {!isSigned && !isFinalized && !isBroadcast && (
            <button
              onClick={onSign}
              disabled={!ledgerConnected || signing}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#2d67aa] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signing ? (
                <>
                  <RefreshCw
                    size={17}
                    className="animate-spin"
                  />
                  Signing with Ledger...
                </>
              ) : (
                <>
                  <KeyRound size={17} />
                  Sign Selected Candidate
                </>
              )}
            </button>
          )}

          {isSigned && !isFinalized && !isBroadcast && (
            <button
              onClick={onFinalize}
              disabled={finalizing}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#2d67aa] text-sm font-bold text-white disabled:opacity-50"
            >
              {finalizing ? (
                <>
                  <RefreshCw
                    size={17}
                    className="animate-spin"
                  />
                  Finalizing...
                </>
              ) : (
                <>
                  <Check size={17} />
                  Finalize Transaction
                </>
              )}
            </button>
          )}

          {isFinalized && !isBroadcast && (
            <button
              onClick={onBroadcast}
              disabled={broadcasting}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
            >
              {broadcasting ? (
                <>
                  <RefreshCw
                    size={17}
                    className="animate-spin"
                  />
                  Broadcasting...
                </>
              ) : (
                <>
                  <Zap size={17} />
                  Broadcast to Signet
                </>
              )}
            </button>
          )}

          {isBroadcast && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
                <Check size={18} />
                Broadcast successful
              </div>

              <div className="mt-2 break-all font-mono text-xs text-emerald-700">
                {broadcast?.txid || "Transaction broadcast to Signet."}
              </div>

              {broadcast?.txid && (
                <a
                  href={`https://blockstream.info/signet/tx/${broadcast.txid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 underline underline-offset-2"
                >
                  View on Signet explorer
                  <ChevronRight size={14} />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const [screen, setScreen] = useState("login");

  const [descriptor, setDescriptor] = useState("");

  const [destination, setDestination] =
    useState(DEFAULT_DESTINATION);

  const [amount, setAmount] =
    useState(DEFAULT_AMOUNT);

  const [feeRate, setFeeRate] =
    useState(DEFAULT_FEE_RATE);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [candidates, setCandidates] =
    useState([]);

  const [comparison, setComparison] =
    useState(null);

  const [psbts, setPsbts] =
    useState({});

  const [selectedId, setSelectedId] =
    useState(null);

  const [showDetails, setShowDetails] =
    useState(false);

  const [showUtxoLabels, setShowUtxoLabels] =
    useState(false);

  // ==========================================================
  // WHAT-IF STATE
  // ==========================================================

  const [showWhatIf, setShowWhatIf] =
    useState(false);

  const [whatIfLoading, setWhatIfLoading] =
    useState(false);

  const [scenarioLabel, setScenarioLabel] =
    useState("");

  // ==========================================================
  // REVIEW / LEDGER STATE
  // ==========================================================

  const [showReview, setShowReview] =
    useState(false);

  const [notice, setNotice] =
    useState("");

  const [ledgerConnected, setLedgerConnected] =
    useState(false);

  const [ledgerStatus, setLedgerStatus] =
    useState("");

  const [signedPsbts, setSignedPsbts] =
    useState({});

  const [finalizedTransactions, setFinalizedTransactions] =
    useState({});

  const [broadcastResults, setBroadcastResults] =
    useState({});

  const [signing, setSigning] =
    useState(false);

  const [finalizing, setFinalizing] =
    useState(false);

  const [broadcasting, setBroadcasting] =
    useState(false);


  // ==========================================================
  // NOTICE
  // ==========================================================

  const showNotice = (message) => {
    setNotice(message);

    window.clearTimeout(
      window.__coinlensNoticeTimer
    );

    window.__coinlensNoticeTimer =
      window.setTimeout(() => {
        setNotice("");
      }, 3500);
  };


  // ==========================================================
  // CLEANUP LEDGER
  // ==========================================================

  useEffect(() => {
    return () => {
      try {
        disconnectLedger();
      } catch {
        // Ignore cleanup errors.
      }
    };
  }, []);


  // ==========================================================
  // SELECTED CANDIDATE
  // ==========================================================

  const selectedCandidate = useMemo(() => {
    if (!selectedId) return null;

    const index = candidates.findIndex(
      (candidate, candidateIndex) =>
        getCandidateId(candidate, candidateIndex) ===
        selectedId
    );

    return index >= 0
      ? candidates[index]
      : null;
  }, [candidates, selectedId]);

  const selectedPsbt =
    selectedId ? psbts[selectedId] || "" : "";

  const selectedSignedPsbt =
    selectedId
      ? signedPsbts[selectedId] || ""
      : "";

  const selectedFinalized =
    selectedId
      ? finalizedTransactions[selectedId] || null
      : null;

  const selectedBroadcast =
    selectedId
      ? broadcastResults[selectedId] || null
      : null;


  // ==========================================================
  // GUEST SIGNET DEMO
  // ==========================================================

  const handleGuestDemo = async () => {
    setError("");
    setDescriptor(DEMO_DESCRIPTOR);

    try {
      setLoading(true);
      await fetch(`${API_URL}/wallet/reset`, { method: "POST" });
      setScreen("planner");
      showNotice("Guest Signet demo loaded.");
    } catch {
      // The backend demo wallet is the default even if this call fails,
      // so we can still proceed -- just without the confirmation notice.
      setScreen("planner");
    } finally {
      setLoading(false);
    }
  };


  // ==========================================================
  // CONNECT WATCH-ONLY / DESCRIPTOR
  // ==========================================================

  const handleConnectDescriptor = async () => {
    if (!descriptor.trim()) {
      setError("Enter a wallet descriptor first.");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/wallet/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descriptor: descriptor.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail || "Could not connect this descriptor."
        );
      }

      setScreen("planner");
      showNotice(
        `Wallet connected: ${data.utxo_count} UTXO${
          data.utxo_count === 1 ? "" : "s"
        } found on Signet.`
      );
    } catch (err) {
      setError(err.message || "Could not connect this descriptor.");
    } finally {
      setLoading(false);
    }
  };


  // ==========================================================
  // CONNECT LEDGER
  // ==========================================================

  const handleConnectLedger = async () => {
    try {
      setError("");
      setLedgerStatus("Connecting to Ledger...");
      setLoading(true);

      await connectLedger(
        (status) => {
          setLedgerStatus(status);
        }
      );

      setLedgerConnected(
        isLedgerConnected()
      );

      setScreen("planner");

      showNotice("Ledger connected.");
    } catch (err) {
      setError(
        err?.message ||
          "Unable to connect to Ledger."
      );

      setLedgerStatus("");
    } finally {
      setLoading(false);
    }
  };


  // ==========================================================
  // PLAN TRANSACTION
  // ==========================================================

  const handlePlan = async () => {
    try {
      setLoading(true);
      setError("");
      setScenarioLabel("");

      const amountSats = Number(amount);
      const feeRateSatVb = Number(feeRate);

      if (!destination.trim()) {
        throw new Error(
          "Enter a Signet destination address."
        );
      }

      if (!Number.isFinite(amountSats) || amountSats <= 0) {
        throw new Error(
          "Amount must be greater than zero."
        );
      }

      if (
        !Number.isFinite(feeRateSatVb) ||
        feeRateSatVb <= 0
      ) {
        throw new Error(
          "Fee rate must be greater than zero."
        );
      }

      const response = await fetch(
        `${API_URL}/plan`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            destination: destination.trim(),
            amount_sats: amountSats,
            fee_rate_sat_vb: feeRateSatVb,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            data?.error ||
            "Unable to plan transaction."
        );
      }

      const normalized =
        normalizePlannerResponse(data);

      if (!normalized.candidates.length) {
        throw new Error(
          "Planner returned no transaction candidates."
        );
      }

      setCandidates(
        normalized.candidates
      );

      setComparison(
        normalized.comparison
      );

      setPsbts(
        normalized.psbts
      );

      setSignedPsbts({});
      setFinalizedTransactions({});
      setBroadcastResults({});

      setSelectedId(null);
      setShowDetails(false);
      setShowReview(false);
      setShowWhatIf(false);

      setScreen("comparison");

      showNotice(
        "Two transaction candidates generated."
      );
    } catch (err) {
      setError(
        err?.message ||
          "Transaction planning failed."
      );
    } finally {
      setLoading(false);
    }
  };


  // ==========================================================
  // WHAT-IF ANALYSIS
  // ==========================================================

  const handleWhatIf = async (scenario) => {
    try {
      setWhatIfLoading(true);
      setError("");

      const response = await fetch(
        `${API_URL}/what-if`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            destination:
              scenario.destination,
            amount_sats:
              scenario.amount_sats,
            fee_rate_sat_vb:
              scenario.fee_rate_sat_vb,
            exclude_utxo_ids:
              scenario.exclude_utxo_ids || [],
            max_inputs:
              scenario.max_inputs ?? null,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            data?.error ||
            "Unable to run What-If analysis."
        );
      }

      const normalized =
        normalizePlannerResponse(data);

      if (!normalized.candidates.length) {
        throw new Error(
          "What-If returned no transaction candidates."
        );
      }

      // Replace the currently displayed candidates
      // with the newly calculated scenario.
      setCandidates(
        normalized.candidates
      );

      setComparison(
        normalized.comparison
      );

      setPsbts(
        normalized.psbts
      );

      // Keep planner fields synchronized with
      // the active scenario.
      setAmount(
        String(scenario.amount_sats)
      );

      setFeeRate(
        String(scenario.fee_rate_sat_vb)
      );

      setScenarioLabel(
        scenario.scenario ||
          "What-If scenario"
      );

      // A new scenario means the previous
      // signature state is no longer valid.
      setSignedPsbts({});
      setFinalizedTransactions({});
      setBroadcastResults({});

      setSelectedId(null);
      setShowDetails(false);
      setShowReview(false);
      setShowWhatIf(false);

      setScreen("comparison");

      showNotice(
        `What-If applied: ${
          scenario.scenario ||
          "scenario updated"
        }`
      );
    } catch (err) {
      setError(
        err?.message ||
          "What-If analysis failed."
      );

      // Keep the modal open so the user
      // can correct the scenario.
    } finally {
      setWhatIfLoading(false);
    }
  };


  // ==========================================================
  // SELECT CANDIDATE
  // ==========================================================

  const handleSelectCandidate = (candidateId) => {
    setSelectedId(candidateId);
    setError("");

    showNotice(
      `Candidate ${candidateId} selected.`
    );
  };


  // ==========================================================
  // OPEN REVIEW
  // ==========================================================

  const handleOpenReview = () => {
    if (!selectedId) {
      setError(
        "Choose a candidate before reviewing."
      );
      return;
    }

    if (!selectedPsbt) {
      setError(
        "The selected candidate does not have a PSBT."
      );
      return;
    }

    setError("");
    setShowReview(true);
  };


  // ==========================================================
  // SIGN SELECTED PSBT WITH LEDGER
  // ==========================================================

  const handleSignSelected = async () => {
    if (!selectedId || !selectedPsbt) {
      setError(
        "Select a candidate with a PSBT first."
      );
      return;
    }

    if (!ledgerConnected) {
      setError(
        "Connect a Ledger before signing."
      );
      return;
    }

    try {
      setSigning(true);
      setError("");
      setLedgerStatus(
        "Preparing PSBT for Ledger signing..."
      );

      const signatures =
        await signCoinLensPsbt(
          selectedPsbt,
          (status) => {
            setLedgerStatus(status);
          }
        );

      const signedPsbt =
        await applyLedgerSignatures(
          selectedPsbt,
          signatures
        );

      if (!signedPsbt) {
        throw new Error(
          "Ledger signing completed but no signed PSBT was returned."
        );
      }

      setSignedPsbts((previous) => ({
        ...previous,
        [selectedId]: signedPsbt,
      }));

      setLedgerStatus(
        "Ledger signature applied to PSBT."
      );

      showNotice(
        `Candidate ${selectedId} signed.`
      );
    } catch (err) {
      setError(
        err?.message ||
          "Ledger signing failed."
      );
    } finally {
      setSigning(false);
    }
  };


  // ==========================================================
  // FINALIZE
  // ==========================================================

  const handleFinalizeSelected = async () => {
    if (!selectedId) return;

    const signedPsbt =
      signedPsbts[selectedId];

    if (!signedPsbt) {
      setError(
        "Sign the selected PSBT before finalizing."
      );
      return;
    }

    try {
      setFinalizing(true);
      setError("");

      const response = await fetch(
        `${API_URL}/finalize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            psbt: signedPsbt,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.detail ||
            data?.error ||
            "Unable to finalize transaction."
        );
      }

      setFinalizedTransactions(
        (previous) => ({
          ...previous,
          [selectedId]: data,
        })
      );

      showNotice(
        `Candidate ${selectedId} finalized.`
      );
    } catch (err) {
      setError(
        err?.message ||
          "Transaction finalization failed."
      );
    } finally {
      setFinalizing(false);
    }
  };


  // ==========================================================
  // BROADCAST
  // ==========================================================

  const handleBroadcastSelected = async () => {
    if (!selectedId) return;

    const finalized =
      finalizedTransactions[selectedId];

    if (!finalized?.raw_transaction_hex) {
      setError(
        "Finalize the transaction before broadcasting."
      );
      return;
    }

    try {
      setBroadcasting(true);
      setError("");

      const response = await fetch(
        `${API_URL}/broadcast`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw_transaction_hex:
              finalized.raw_transaction_hex,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.detail ||
            data?.error ||
            "Unable to broadcast transaction."
        );
      }

      setBroadcastResults(
        (previous) => ({
          ...previous,
          [selectedId]: data,
        })
      );

      showNotice(
        "Transaction broadcast to Signet."
      );
    } catch (err) {
      setError(
        err?.message ||
          "Transaction broadcast failed."
      );
    } finally {
      setBroadcasting(false);
    }
  };


  // ==========================================================
  // COPY PSBT
  // ==========================================================

  const handleCopyPsbt = async (psbt) => {
    if (!psbt) return;

    try {
      await navigator.clipboard.writeText(psbt);
      showNotice("PSBT copied to clipboard.");
    } catch {
      setError("Could not copy PSBT to clipboard.");
    }
  };


  // ==========================================================
  // BACK TO PLANNER
  // ==========================================================

  const handleBackToPlanner = () => {
    setScreen("planner");
    setError("");
    setShowDetails(false);
    setShowWhatIf(false);
    setShowReview(false);
    setSelectedId(null);
    setScenarioLabel("");
  };


  // ==========================================================
  // LOGIN
  // ==========================================================

  if (screen === "login") {
    return (
      <LoginScreen
        descriptor={descriptor}
        setDescriptor={setDescriptor}
        onConnectDescriptor={
          handleConnectDescriptor
        }
        onConnectLedger={
          handleConnectLedger
        }
        onGuestDemo={handleGuestDemo}
        loading={loading}
        error={error}
        ledgerStatus={ledgerStatus}
      />
    );
  }


  // ==========================================================
  // PLANNER
  // ==========================================================

  if (screen === "planner") {
    return (
      <>
        <PlannerScreen
          destination={destination}
          setDestination={setDestination}
          amount={amount}
          setAmount={setAmount}
          feeRate={feeRate}
          setFeeRate={setFeeRate}
          onPlan={handlePlan}
          loading={loading}
          error={error}
          onBack={() => {
            setScreen("login");
            setError("");
          }}
          onManageUtxos={() => setShowUtxoLabels(true)}
        />

        {showUtxoLabels && (
          <UtxoLabelModal
            onClose={() => setShowUtxoLabels(false)}
          />
        )}
      </>
    );
  }


  // ==========================================================
  // COMPARISON
  // ==========================================================

  return (
    <div className="min-h-screen bg-[#f6f8fb]">

      <StatusBar
        ledgerConnected={ledgerConnected}
        ledgerStatus={ledgerStatus}
      />

      <ComparisonScreen
        candidates={candidates}
        comparison={comparison}
        selectedId={selectedId}
        onSelect={handleSelectCandidate}
        onBack={handleBackToPlanner}
        onDetails={() =>
          setShowDetails(true)
        }
        onWhatIf={() => {
          setError("");
          setShowWhatIf(true);
        }}
        scenarioLabel={scenarioLabel}
        ledgerConnected={ledgerConnected}
      />

      {/* ====================================================
          GLOBAL ERROR
      ==================================================== */}

      {error && (
        <div className="fixed bottom-5 left-1/2 z-[80] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border border-red-200 bg-white px-5 py-4 text-sm text-red-700 shadow-2xl">
          <CircleAlert
            size={18}
            className="mt-0.5 shrink-0"
          />

          <span className="flex-1">
            {error}
          </span>

          <button
            onClick={() => setError("")}
            className="text-red-400 hover:text-red-600"
          >
            <X size={17} />
          </button>
        </div>
      )}

      {/* ====================================================
          NOTICE
      ==================================================== */}

      {notice && (
        <div className="fixed right-5 top-20 z-[80] flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-5 py-3.5 text-sm font-semibold text-emerald-700 shadow-2xl">
          <Check size={17} />
          {notice}
        </div>
      )}

      {/* ====================================================
          DETAILS
      ==================================================== */}

      {showDetails && (
        <DetailsModal
          candidates={candidates}
          comparison={comparison}
          onClose={() =>
            setShowDetails(false)
          }
        />
      )}

      {/* ====================================================
          WHAT-IF
      ==================================================== */}

      {showWhatIf && (
        <WhatIfModal
          destination={destination}
          amount={amount}
          feeRate={feeRate}
          loading={whatIfLoading}
          onClose={() =>
            setShowWhatIf(false)
          }
          onApply={handleWhatIf}
        />
      )}

      {/* ====================================================
          REVIEW
      ==================================================== */}

      {showReview && selectedCandidate && (
        <ReviewModal
          candidate={selectedCandidate}
          candidateId={selectedId}
          psbt={selectedPsbt}
          signedPsbt={selectedSignedPsbt}
          finalized={selectedFinalized}
          broadcast={selectedBroadcast}
          ledgerConnected={ledgerConnected}
          signing={signing}
          finalizing={finalizing}
          broadcasting={broadcasting}
          onSign={handleSignSelected}
          onFinalize={
            handleFinalizeSelected
          }
          onBroadcast={
            handleBroadcastSelected
          }
          onDownload={() =>
            downloadPsbt(
              selectedPsbt,
              selectedId
            )
          }
          onCopyPsbt={handleCopyPsbt}
          onClose={() =>
            setShowReview(false)
          }
        />
      )}

      {/* ====================================================
          SELECTED CANDIDATE ACTION BAR
      ==================================================== */}

      {selectedId && !showReview && (
        <div className="fixed bottom-5 left-1/2 z-40 flex w-[calc(100%-32px)] max-w-2xl -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-[#dce4ed] bg-white px-5 py-4 shadow-[0_20px_50px_rgba(15,39,71,0.16)]">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-[#8b98aa]">
              Selected
            </div>

            <div className="text-sm font-bold text-[#304159]">
              Candidate {selectedId}
            </div>
          </div>

          <button
            onClick={handleOpenReview}
            className="flex items-center gap-2 rounded-xl bg-[#2d67aa] px-5 py-3 text-sm font-bold text-white hover:bg-[#255d9d]"
          >
            Review & Sign
            <ArrowRight size={17} />
          </button>
        </div>
      )}
    </div>
  );
}