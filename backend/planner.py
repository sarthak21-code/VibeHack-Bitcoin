import argparse
import json
from pathlib import Path

import bdkpython as bdk

from bitcoin.psbt_analyzer import analyze_psbt
from candidate_engine.selector import largest_first, two_utxo_pair
from privacy_engine import analyze_candidate, compare_candidates


DB_PATH = Path(__file__).resolve().parent / "bitcoin" / "vibehack_wallet.sqlite3"

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

DEFAULT_AMOUNT_SATS = 3500
DEFAULT_FEE_RATE_SAT_VB = 1


def load_wallet():
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
    """Convert BDK LocalOutput objects into selector-friendly dictionaries."""

    result = []

    for utxo in wallet.list_unspent():
        result.append(
            {
                "outpoint": utxo.outpoint,
                "outpoint_str": (
                    f"{utxo.outpoint.txid}:{utxo.outpoint.vout}"
                ),
                "amount_sats": utxo.txout.value.to_sat(),
                "keychain": str(utxo.keychain),
            }
        )

    return result


def build_psbt(
    wallet,
    selected_utxos,
    destination,
    amount_sats,
    fee_rate_sat_vb,
):
    """Build one unsigned PSBT using exactly the selected UTXOs."""

    if isinstance(destination, str):
        address = bdk.Address(
            destination,
            bdk.Network.SIGNET,
        )
    else:
        address = destination

    builder = bdk.TxBuilder()

    builder = builder.add_utxos(
        [utxo["outpoint"] for utxo in selected_utxos]
    )

    builder = builder.manually_selected_only()

    builder = builder.add_recipient(
        address.script_pubkey(),
        bdk.Amount.from_sat(amount_sats),
    )

    builder = builder.fee_rate(
        bdk.FeeRate.from_sat_per_vb(fee_rate_sat_vb)
    )

    return builder.finish(wallet)


def make_demo_metadata(utxos):
    """
    Create clearly labeled DEMO sidecar privacy metadata.

    These clusters are not blockchain-derived identities.
    They are local labels used only to demonstrate the
    privacy-analysis pipeline.
    """

    metadata = {}

    for utxo in utxos:
        outpoint = utxo["outpoint_str"]

        # For the current demo:
        # 142653-sat reserve coin = separate Beta cluster.
        if utxo["amount_sats"] == 142653:
            cluster = "Beta"
            rare = True
            label = "demo_reserve"
        else:
            cluster = "Alpha"
            rare = False
            label = "demo"

        metadata[outpoint] = {
            "cluster": cluster,
            "label": label,
            "rare": rare,
        }

    return metadata


def normalize_for_json(value):
    """Convert supported result objects into JSON-safe dictionaries."""

    if hasattr(value, "to_dict"):
        return value.to_dict()

    if isinstance(value, dict):
        return {
            str(key): normalize_for_json(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [normalize_for_json(item) for item in value]

    return value


def print_candidate_summary(label, analysis):
    """Print the useful human-readable facts for one candidate."""

    data = normalize_for_json(analysis)

    transaction = data.get("transaction", {})
    privacy = data.get("privacy", {})
    optionality = data.get("future_optionality", {})

    print()
    print("=" * 48)
    print(label)
    print("=" * 48)

    print("Inputs:", transaction.get("input_count"))
    print("Input total:", transaction.get("inputs_total_sats"), "sats")
    print("Payment:", transaction.get("payment_sats"), "sats")
    print("Fee:", transaction.get("fee_sats"), "sats")
    print("Change:", transaction.get("change_sats"), "sats")
    print("Change created:", transaction.get("change_created"))

    print()
    print("Privacy:")
    print("  Clusters:", privacy.get("clusters_used"))
    print("  Cluster count:", privacy.get("clusters_count"))
    print("  Clusters merged:", privacy.get("clusters_merged"))
    print("  Multiple inputs:", privacy.get("multiple_inputs"))
    print(
        "  Address reuse:",
        privacy.get("address_reuse_detected"),
    )

    print()
    print("Future optionality:")
    print(
        "  Rare UTXO consumed:",
        optionality.get("rare_utxo_consumed"),
    )
    print(
        "  Unique cluster consumed:",
        optionality.get("unique_cluster_consumed"),
    )


def run_planner(
    destination,
    amount_sats=DEFAULT_AMOUNT_SATS,
    fee_rate_sat_vb=DEFAULT_FEE_RATE_SAT_VB,
):
    """
    Run the full VibeHack planning pipeline.

    Payment request
        -> candidate generation
        -> BDK PSBT construction
        -> PSBT analysis
        -> privacy analysis
        -> candidate comparison
    """

    wallet, persister = load_wallet()

    print("=" * 48)
    print("VIBEHACK PRE-SIGNING BITCOIN PRIVACY PLANNER")
    print("=" * 48)

    print("Network:", wallet.network())
    print("Payment:", amount_sats, "sats")
    print("Destination:", destination)
    print("Fee rate:", fee_rate_sat_vb, "sat/vB")

    utxos = get_real_utxos(wallet)

    print()
    print("Real wallet UTXOs:", len(utxos))

    # Create local demonstration metadata.
    utxo_metadata = make_demo_metadata(utxos)

    # Candidate A: prefer a small two-UTXO combination.
    candidate_a = two_utxo_pair(
        utxos,
        amount_sats,
    )

    # Candidate B: largest-first selection.
    candidate_b = largest_first(
        utxos,
        amount_sats,
    )

    print()
    print("Candidate A inputs:", len(candidate_a))
    print("Candidate B inputs:", len(candidate_b))

    # Build actual unsigned PSBTs.
    psbt_a = build_psbt(
        wallet,
        candidate_a,
        destination,
        amount_sats,
        fee_rate_sat_vb,
    )

    psbt_b = build_psbt(
        wallet,
        candidate_b,
        destination,
        amount_sats,
        fee_rate_sat_vb,
    )

    # Convert PSBTs into structured candidate dictionaries.
    candidate_a_dict = analyze_psbt(
        psbt_a,
        wallet,
        candidate_id="A",
    )

    candidate_b_dict = analyze_psbt(
        psbt_b,
        wallet,
        candidate_id="B",
    )

    # Feed structured transaction facts into the privacy engine.
    analysis_a = analyze_candidate(
        candidate_a_dict,
        utxo_metadata,
    )

    analysis_b = analyze_candidate(
        candidate_b_dict,
        utxo_metadata,
    )

    comparison = compare_candidates(
        [analysis_a, analysis_b]
    )

    print_candidate_summary(
        "CANDIDATE A",
        analysis_a,
    )

    print_candidate_summary(
        "CANDIDATE B",
        analysis_b,
    )

    print()
    print("=" * 48)
    print("COMPARISON")
    print("=" * 48)

    comparison_data = normalize_for_json(comparison)

    print(
        json.dumps(
            comparison_data,
            indent=2,
        )
    )

    print()
    print("PSBT A generated: YES")
    print("PSBT B generated: YES")
    print()
    print("Signing: NOT PERFORMED")
    print("Broadcast: NOT PERFORMED")

    wallet.persist(persister)

    return {
        "candidate_a": normalize_for_json(analysis_a),
        "candidate_b": normalize_for_json(analysis_b),
        "comparison": comparison_data,
    }


def main():
    parser = argparse.ArgumentParser(
        description="VibeHack pre-signing Bitcoin privacy planner"
    )

    parser.add_argument(
        "--destination",
        help="Signet destination address",
    )

    parser.add_argument(
        "--amount",
        type=int,
        default=DEFAULT_AMOUNT_SATS,
        help="Payment amount in satoshis",
    )

    parser.add_argument(
        "--fee-rate",
        type=int,
        default=DEFAULT_FEE_RATE_SAT_VB,
        help="Fee rate in sat/vB",
    )

    args = parser.parse_args()

    wallet, _ = load_wallet()

    # For the first integrated demo, use another derived wallet address
    # when no destination is supplied. This is a self-payment test only.
    if args.destination:
        destination = args.destination
    else:
        destination = wallet.peek_address(
            bdk.KeychainKind.EXTERNAL,
            1,
        ).address

        print(
            "No destination supplied."
        )
        print(
            "Using a wallet-derived Signet address for integration testing."
        )

    run_planner(
        destination=destination,
        amount_sats=args.amount,
        fee_rate_sat_vb=args.fee_rate,
    )


if __name__ == "__main__":
    main()
