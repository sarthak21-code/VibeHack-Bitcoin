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
  return (
    candidate?.name ||
    candidate?.label ||
    `Candidate ${String.fromCharCode(65 + index)}`
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
  return {
    observations: Array.isArray(candidate?.pros) ? candidate.pros : [],
    tradeoffs: Array.isArray(candidate?.cons) ? candidate.cons : [],
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
  };
}

function normalizePlannerResponse(data) {
  let candidates = [
    data?.candidate_a,
    data?.candidate_b,
  ].filter(Boolean);

  // Fallback if backend ever returns candidates[] only.
  if (!candidates.length && Array.isArray(data?.candidates)) {
    candidates = data.candidates.slice(0, 2);
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

  const psbts = {
    ...rawPsbts,

    A:
      rawPsbts.A ||
      rawPsbts.a ||
      rawPsbts.candidate_a ||
      rawPsbts["Candidate A"] ||
      "",

    B:
      rawPsbts.B ||
      rawPsbts.b ||
      rawPsbts.candidate_b ||
      rawPsbts["Candidate B"] ||
      "",
  };

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

          <div className="mb-8">
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
              Connect
            </button>
          </div>

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

function CandidateCard({
  candidate,
  index,
  selected,
  recommended,
  onSelect,
}) {
  const clusters = normalizeClusters(candidate?.clusters);

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

  const observations = Array.isArray(candidate?.observations)
    ? candidate.observations
    : [];

  if (candidate?.valid === false) {
    return (
      <div className="rounded-[22px] border border-red-200 bg-red-50 p-7">
        <div className="mb-4 text-xs font-bold uppercase tracking-[0.17em] text-red-500">
          {candidateName(candidate, index)}
        </div>

        <h3 className="mb-3 text-xl font-semibold text-red-800">
          Could not be constructed
        </h3>

        <p className="text-sm leading-6 text-red-700">
          {candidate?.error ||
            "This candidate is not valid under the current scenario."}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-[22px] border bg-white p-7 transition ${
        selected
          ? "border-[#2d67aa] shadow-[0_15px_40px_rgba(45,103,170,0.12)]"
          : "border-[#dce4ed] shadow-sm"
      }`}
    >
      <div className="mb-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-bold uppercase tracking-[0.17em] text-[#f28a18]">
            {candidateName(candidate, index)}
          </div>

          {recommended && (
            <div className="flex items-center gap-1 rounded-full bg-[#eaf2fb] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#2d67aa]">
              <Sparkles size={11} />
              Suggested
            </div>
          )}
        </div>

        {selected && (
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <Check size={13} />
            Selected
          </div>
        )}
      </div>

      <h3 className="mb-7 text-2xl font-semibold text-[#15243a]">
        Transaction candidate
      </h3>

      <div className="grid grid-cols-4 gap-3">
        <Metric
          label="Inputs"
          value={inputCount}
        />

        <Metric
          label="Input total"
          value={`${formatSats(inputTotal)} sats`}
        />

        <Metric
          label="Fee"
          value={`${formatSats(fee)} sats`}
        />

        <Metric
          label="Change"
          value={`${formatSats(change)} sats`}
        />
      </div>

      <div className="my-7 h-px bg-[#edf1f5]" />

      <div className="space-y-3">
        {observations.slice(0, 3).map((observation, observationIndex) => (
          <BulletRow
            key={observationIndex}
            text={observation}
          />
        ))}

        {clusters.length > 0 && (
          <BulletRow
            text={
              <>
                Cluster:
                <strong className="ml-1 font-bold text-[#34445b]">
                  {clusters.join(", ")}
                </strong>
              </>
            }
          />
        )}

        {candidate?.rare_utxo_consumed && (
          <BulletRow
            text={
              <>
                Future optionality:
                <strong className="ml-1 font-bold text-[#34445b]">
                  Consumes a tagged rare/reserve UTXO
                </strong>
              </>
            }
            accent
          />
        )}
      </div>

      <button
        onClick={() => onSelect(getCandidateId(candidate, index))}
        className={`mt-7 flex h-13 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold transition ${
          selected
            ? "border-[#2d67aa] bg-[#2d67aa] text-white"
            : "border-[#d8e1eb] bg-[#f8fafc] text-[#34445c] hover:bg-[#f1f5f9]"
        }`}
      >
        {selected ? "Selected candidate" : "Choose candidate"}
        <ArrowRight size={17} />
      </button>
    </div>
  );
}


function Metric({ label, value }) {
  return (
    <div>
      <div className="mb-2 text-center text-[11px] font-semibold text-[#8b98aa]">
        {label}
      </div>

      <div className="text-center text-sm font-bold text-[#1c2d45]">
        {value}
      </div>
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

        <div className="mb-8 flex items-center justify-between">
          <Brand />

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

        <div className="mb-8">
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
          <div className="grid gap-6 lg:grid-cols-2">
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

        {comparison && (
          <div className="mt-6 rounded-2xl border border-[#dce4ed] bg-white p-6">
            <div className="flex items-start gap-3">
              <Sparkles
                size={19}
                className="mt-0.5 text-[#f28a18]"
              />

              <div>
                <div className="text-sm font-bold text-[#34445a]">
                  CoinLens comparison
                </div>

                <div className="mt-1 text-sm leading-6 text-[#7c899c]">
                  {typeof comparison === "string"
                    ? comparison
                    : comparison?.summary ||
                      comparison?.recommendation ||
                      "Compare the candidates before signing."}
                </div>
              </div>
            </div>
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
      <div className="mx-auto min-h-full max-w-7xl py-5">
        <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-2xl">

          <div className="flex items-start justify-between border-b border-[#e5eaf0] px-8 py-7">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
                Window 03
              </div>

              <h2 className="text-3xl font-semibold text-[#17263c]">
                Detailed trade-offs
              </h2>
            </div>

            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#dce4ed] text-[#66758a] hover:bg-[#f7f9fc]"
            >
              <X size={21} />
            </button>
          </div>

          {comparison && (
            <div className="border-b border-[#e5eaf0] px-8 py-7 text-center text-sm leading-6 text-[#68778c]">
              {typeof comparison === "string"
                ? comparison
                : comparison?.summary ||
                  comparison?.recommendation ||
                  "Candidate comparison generated from the current transaction plan."}
            </div>
          )}

          <div className="grid gap-5 p-8 lg:grid-cols-2">
            {candidates.map((candidate, index) => {
              if (candidate?.valid === false) {
                return (
                  <div
                    key={getCandidateId(candidate, index)}
                    className="rounded-2xl border border-red-200 bg-red-50 p-7"
                  >
                    <div className="mb-5 text-center text-xs font-bold uppercase tracking-[0.18em] text-red-500">
                      {candidateName(candidate, index)}
                    </div>
                    <p className="text-center text-sm leading-6 text-red-700">
                      {candidate?.error ||
                        "This candidate is not valid under the current scenario."}
                    </p>
                  </div>
                );
              }

              const tradeoff = getTradeoff(candidate);

              const observations =
                tradeoff.observations.length > 0
                  ? tradeoff.observations
                  : [];

              const tradeoffs =
                tradeoff.tradeoffs.length > 0
                  ? tradeoff.tradeoffs
                  : [];

              return (
                <div
                  key={getCandidateId(candidate, index)}
                  className="rounded-2xl border border-[#dce4ed] bg-[#fbfcfe] p-7"
                >
                  <div className="mb-5 text-center text-xs font-bold uppercase tracking-[0.18em] text-[#f28a18]">
                    {candidateName(candidate, index)}
                  </div>

                  <div className="mb-7 text-center text-lg font-bold leading-7 text-[#34445c]">
                    {candidate?.tradeoff_summary ||
                      "Transaction construction with explicit privacy and wallet trade-offs."}
                  </div>

                  <div className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#32825c]">
                    <Check size={17} />
                    Observations
                  </div>

                  <div className="space-y-3">
                    {observations.map((item, itemIndex) => (
                      <div
                        key={itemIndex}
                        className="flex items-start gap-3 text-sm leading-6 text-[#68778c]"
                      >
                        <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e7f5ed] text-[#32825c]">
                          +
                        </span>

                        <span>{item}</span>
                      </div>
                    ))}

                    {observations.length === 0 && (
                      <div className="text-sm text-[#7c899c]">
                        No additional observations returned.
                      </div>
                    )}
                  </div>

                  <div className="mb-3 mt-7 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#bd7419]">
                    <CircleAlert size={17} />
                    Trade-offs
                  </div>

                  <div className="space-y-3">
                    {tradeoffs.map((item, itemIndex) => (
                      <div
                        key={itemIndex}
                        className="flex items-start gap-3 text-sm leading-6 text-[#68778c]"
                      >
                        <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#fff1dc] text-[#bd7419]">
                          −
                        </span>

                        <span>{item}</span>
                      </div>
                    ))}

                    {tradeoffs.length === 0 && (
                      <div className="text-sm text-[#7c899c]">
                        No additional trade-offs returned.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
    useState(true);

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
                  href={`https://mempool.space/signet/tx/${broadcast.txid}`}
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

  const handleGuestDemo = () => {
    setError("");
    setDescriptor(DEMO_DESCRIPTOR);
    setScreen("planner");
    showNotice("Guest Signet demo loaded.");
  };


  // ==========================================================
  // CONNECT WATCH-ONLY / DESCRIPTOR
  // ==========================================================

  const handleConnectDescriptor = () => {
    if (!descriptor.trim()) {
      setError("Enter a wallet descriptor first.");
      return;
    }

    setError("");
    setScreen("planner");

    showNotice("Watch-only wallet connected.");
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
        ledgerStatus={ledgerStatus}
      />
    );
  }


  // ==========================================================
  // PLANNER
  // ==========================================================

  if (screen === "planner") {
    return (
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
      />
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