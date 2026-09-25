import sys
from pathlib import Path

# Ensure backend root is on sys.path for sibling imports
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import bdkpython as bdk

from backend.candidate_engine.selector import largest_first, two_utxo_pair
from backend.bitcoin.psbt_analyzer import analyze_psbt
from backend.privacy_engine import analyze_candidate, compare_candidates


DB_PATH = Path(__file__).resolve().parent / "coinlens_wallet.sqlite3"

DESCRIPTOR = (
    "tr([12071a7c/86'/1'/0']"
    "tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T"
    "/0/*)#z3x5097m"
)

CHANGE_DESCRIPTOR = (
    "tr([12071a7c/86'/1'/0']"
    "tpubDCaLkqfh67Qr7ZuRrUNrCYQ54sMjHfsJ4yQSGb3aBr1yqt3yXpamRBUwnGSnyNnxQYu7rqeBiPfw3mjBcFNX4ky2vhjj9bDrGstkfUbLB9T"
    "/1/*)#n9r4jswr"
)

# Same payment for both candidates.
TARGET_SATS = 3_500

# Very low Signet test fee rate.
FEE_RATE_SAT_VB = 1

# Standard external Signet destination address for pre-signing planner tests
EXTERNAL_RECIPIENT_ADDR = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"


def load_wallet():
    """Load the existing BDK wallet from SQLite."""

    persister = bdk.Persister.new_sqlite(str(DB_PATH))

    wallet = bdk.Wallet.load(
        descriptor=bdk.Descriptor(
            DESCRIPTOR,
            bdk.NetworkKind.TEST,
        ),
        change_descriptor=bdk.Descriptor(
            CHANGE_DESCRIPTOR,
            bdk.NetworkKind.TEST,
        ),
        persister=persister,
    )

    return wallet, persister


def get_real_utxos(wallet):
    """
    Convert BDK LocalOutput objects into the format
    expected by our candidate selector.
    """

    result = []

    for utxo in wallet.list_unspent():
        result.append(
            {
                "outpoint": utxo.outpoint,
                "amount_sats": utxo.txout.value.to_sat(),
                "keychain": str(utxo.keychain),
            }
        )

    return result


def build_candidate(wallet, name, selected_utxos, recipient=None):
    """Build one PSBT using exactly the selected UTXOs."""

    if recipient is None:
        recipient = bdk.Address(EXTERNAL_RECIPIENT_ADDR, bdk.Network.SIGNET)

    # BDK 3.1.0 Python binding exposes TxBuilder directly.
    builder = bdk.TxBuilder()

    # Force BDK to use our candidate's exact inputs.
    builder = builder.add_utxos(
        [utxo["outpoint"] for utxo in selected_utxos]
    )

    builder = builder.manually_selected_only()

    # Add the exact same payment for every candidate.
    builder = builder.add_recipient(
        recipient.script_pubkey(),
        bdk.Amount.from_sat(TARGET_SATS),
    )

    # Set the same fee rate for every candidate.
    builder = builder.fee_rate(
        bdk.FeeRate.from_sat_per_vb(FEE_RATE_SAT_VB)
    )

    # BDK creates the actual PSBT.
    psbt = builder.finish(wallet)
    return psbt


def print_candidate_summary(candidate_id: str, facts: dict):
    """Print readable candidate facts."""
    inputs_count = len(facts["inputs"])
    inputs_total = sum(inp["amount_sats"] for inp in facts["inputs"])

    recipient_sats = facts.get("recipient_amount_sats") or TARGET_SATS
    fee_sats = facts.get("fee_sats")

    change_outs = [o for o in facts["outputs"] if o.get("is_wallet_controlled") is True]
    change_sats = sum(o["amount_sats"] for o in change_outs) if change_outs else (inputs_total - recipient_sats - (fee_sats or 0))

    print("====================================")
    print(f"CANDIDATE {candidate_id.upper()}")
    print("====================================")
    print(f"Inputs:        {inputs_count}")
    print(f"Input total:   {inputs_total:,} sats")
    print("Outputs:")
    print(f"  Recipient:   {recipient_sats:,} sats")
    print(f"  Change:      {change_sats:,} sats")
    print(f"Fee:           {fee_sats} sats")
    print("PSBT generated: YES\n")


def print_privacy_comparison(comparison):
    """Display Member 2's structured privacy comparison."""
    print("====================================")
    print("PRIVACY ANALYSIS & TRADE-OFFS")
    print("====================================")
    for tradeoff in comparison.tradeoffs:
        print(f"\n--- {tradeoff.candidate_id} ---")
        print(f"Summary: {tradeoff.summary}")
        if tradeoff.pros:
            print("Pros:")
            for pro in tradeoff.pros:
                print(f"  + {pro}")
        if tradeoff.cons:
            print("Trade-offs / Risks:")
            for con in tradeoff.cons:
                print(f"  - {con}")

    print("\n------------------------------------")
    print("COMPARATIVE SUMMARY:")
    print(comparison.summary.strip())
    print("====================================\n")


def main():
    wallet, persister = load_wallet()

    # Get real Signet UTXOs from BDK
    utxos = get_real_utxos(wallet)

    # Candidate A: Find two UTXOs whose combined value covers payment
    candidate_a_utxos = two_utxo_pair(utxos, TARGET_SATS)

    # Candidate B: Choose largest UTXO first
    candidate_b_utxos = largest_first(utxos, TARGET_SATS)

    # Build actual PSBTs
    recipient = bdk.Address(EXTERNAL_RECIPIENT_ADDR, bdk.Network.SIGNET)
    psbt_a = build_candidate(wallet, "Candidate A", candidate_a_utxos, recipient)
    psbt_b = build_candidate(wallet, "Candidate B", candidate_b_utxos, recipient)

    # Persist wallet state
    wallet.persist(persister)

    # 1. PSBT Analyzer extracts structured transaction facts from PSBTs
    facts_a = analyze_psbt(psbt_a, wallet, candidate_id="Candidate A")
    facts_b = analyze_psbt(psbt_b, wallet, candidate_id="Candidate B")

    # Display clean candidate summaries
    print_candidate_summary("A", facts_a)
    print_candidate_summary("B", facts_b)

    # 2. Local sidecar metadata for UTXOs (wallet-side assumed clusters & labels)
    utxo_metadata = {
        facts_a["inputs"][0]["outpoint"]: {
            "cluster": "Alpha",
            "label": "clean_signet",
            "rare": False,
        },
        facts_a["inputs"][1]["outpoint"]: {
            "cluster": "Alpha",
            "label": "clean_signet",
            "rare": False,
        },
        facts_b["inputs"][0]["outpoint"]: {
            "cluster": "Beta",
            "label": "large_reserve",
            "rare": True,
        },
    }

    # 3. Privacy Engine analyzes both candidates
    analysis_a = analyze_candidate(facts_a, utxo_metadata)
    analysis_b = analyze_candidate(facts_b, utxo_metadata)

    # 4. Compare candidates side-by-side
    comparison = compare_candidates([analysis_a, analysis_b])

    # 5. Display comparison
    print_privacy_comparison(comparison)


if __name__ == "__main__":
    main()
