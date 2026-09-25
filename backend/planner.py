import argparse
import json
from pathlib import Path

import bdkpython as bdk

from backend.bitcoin.psbt_analyzer import analyze_psbt
from backend.candidate_engine.selector import (
    largest_first,
    two_utxo_pair,
    smallest_single,
)
from backend.privacy_engine import analyze_candidate, compare_candidates


DB_PATH = Path(__file__).resolve().parent / "bitcoin" / "coinlens_wallet.sqlite3"

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


def plan_candidates(
    destination,
    amount_sats=DEFAULT_AMOUNT_SATS,
    fee_rate_sat_vb=DEFAULT_FEE_RATE_SAT_VB,
    exclude_utxo_ids=None,
    max_inputs=None,
):
    """
    Core candidate planning and scenario simulation engine.

    Supports deterministic 'What If' parameterization:
    - fee_rate_sat_vb
    - amount_sats
    - exclude_utxo_ids (outpoint strings or 'reserve')
    - max_inputs (e.g. 1 for single-input constraint)
    """
    wallet, persister = load_wallet()
    all_utxos = get_real_utxos(wallet)
    utxo_metadata = make_demo_metadata(all_utxos)

    excluded_set = set(exclude_utxo_ids or [])
    available_utxos = []
    for u in all_utxos:
        outpoint = u["outpoint_str"]
        is_rare = utxo_metadata.get(outpoint, {}).get("rare", False)
        if outpoint in excluded_set:
            continue
        if "reserve" in excluded_set and is_rare:
            continue
        available_utxos.append(u)

    scenario_info = {
        "destination": str(destination),
        "amount_sats": amount_sats,
        "fee_rate_sat_vb": fee_rate_sat_vb,
        "exclude_utxo_ids": list(exclude_utxo_ids or []),
        "max_inputs": max_inputs,
    }

    psbts = {}
    valid_analyses = []

    # Candidate A
    cand_a_valid = True
    cand_a_error = None
    cand_a_data = {"candidate_id": "A"}
    try:
        if not available_utxos:
            raise ValueError("Insufficient funds: no UTXOs available after exclusion")

        if max_inputs == 1:
            cand_a_utxos = smallest_single(available_utxos, amount_sats)
        else:
            cand_a_utxos = two_utxo_pair(available_utxos, amount_sats)

        if max_inputs is not None and len(cand_a_utxos) > max_inputs:
            raise ValueError(
                f"Constraint exceeded: requires <= {max_inputs} inputs, but Candidate A selected {len(cand_a_utxos)}"
            )

        psbt_a = build_psbt(
            wallet,
            cand_a_utxos,
            destination,
            amount_sats,
            fee_rate_sat_vb,
        )
        cand_a_dict = analyze_psbt(psbt_a, wallet, candidate_id="A")
        analysis_a = analyze_candidate(cand_a_dict, utxo_metadata)
        norm_a = normalize_for_json(analysis_a)
        cand_a_data.update(norm_a)
        cand_a_data["valid"] = True
        psbts["A"] = str(psbt_a)
        valid_analyses.append(analysis_a)
    except Exception as exc:
        cand_a_valid = False
        cand_a_error = str(exc)
        cand_a_data["valid"] = False
        cand_a_data["error"] = cand_a_error

    # Candidate B
    cand_b_valid = True
    cand_b_error = None
    cand_b_data = {"candidate_id": "B"}
    try:
        if not available_utxos:
            raise ValueError("Insufficient funds: no UTXOs available after exclusion")

        cand_b_utxos = largest_first(available_utxos, amount_sats)

        if max_inputs is not None and len(cand_b_utxos) > max_inputs:
            raise ValueError(
                f"Constraint exceeded: requires <= {max_inputs} inputs, but Candidate B selected {len(cand_b_utxos)}"
            )

        psbt_b = build_psbt(
            wallet,
            cand_b_utxos,
            destination,
            amount_sats,
            fee_rate_sat_vb,
        )
        cand_b_dict = analyze_psbt(psbt_b, wallet, candidate_id="B")
        analysis_b = analyze_candidate(cand_b_dict, utxo_metadata)
        norm_b = normalize_for_json(analysis_b)
        cand_b_data.update(norm_b)
        cand_b_data["valid"] = True
        psbts["B"] = str(psbt_b)
        valid_analyses.append(analysis_b)
    except Exception as exc:
        cand_b_valid = False
        cand_b_error = str(exc)
        cand_b_data["valid"] = False
        cand_b_data["error"] = cand_b_error

    if len(valid_analyses) == 2:
        comparison = compare_candidates(valid_analyses)
        comparison_data = normalize_for_json(comparison)
    elif len(valid_analyses) == 1:
        valid_id = valid_analyses[0].candidate_id
        invalid_id = "B" if valid_id == "A" else "A"
        invalid_err = cand_b_error if valid_id == "A" else cand_a_error
        comparison_data = {
            "summary": (
                f"Candidate {valid_id} remains valid under these scenario conditions. "
                f"Candidate {invalid_id} is no longer valid: {invalid_err}."
            ),
            "tradeoffs": [
                {
                    "candidate_id": valid_id,
                    "summary": f"Single valid candidate ({valid_id}) under scenario conditions.",
                    "pros": ["Constructable under specified scenario parameters"],
                    "cons": [],
                }
            ],
        }
    else:
        comparison_data = {
            "summary": (
                f"No valid transaction candidates could be constructed under these scenario conditions. "
                f"Candidate A: {cand_a_error}. Candidate B: {cand_b_error}."
            ),
            "tradeoffs": [],
        }

    wallet.persist(persister)

    return {
        "scenario": scenario_info,
        "candidates": [cand_a_data, cand_b_data],
        "candidate_a": cand_a_data,
        "candidate_b": cand_b_data,
        "comparison": comparison_data,
        "psbts": psbts,
    }


def run_planner(
    destination,
    amount_sats=DEFAULT_AMOUNT_SATS,
    fee_rate_sat_vb=DEFAULT_FEE_RATE_SAT_VB,
):
    """
    Run the full CoinLens planning pipeline.

    Payment request
        -> candidate generation
        -> BDK PSBT construction
        -> PSBT analysis
        -> privacy analysis
        -> candidate comparison
    """
    result = plan_candidates(
        destination=destination,
        amount_sats=amount_sats,
        fee_rate_sat_vb=fee_rate_sat_vb,
    )

    if not result["candidate_a"].get("valid"):
        raise ValueError(
    f"Candidate A could not be built: {type(exc).__name__}: {repr(exc)}"
)
    if not result["candidate_b"].get("valid"):
        raise ValueError(
    f"Candidate B could not be built: {type(exc).__name__}: {repr(exc)}"
        )

    print("=" * 48)
    print("COINLENS PRE-SIGNING BITCOIN PRIVACY PLANNER")
    print("=" * 48)

    print("Payment:", amount_sats, "sats")
    print("Destination:", destination)
    print("Fee rate:", fee_rate_sat_vb, "sat/vB")

    print_candidate_summary("CANDIDATE A", result["candidate_a"])
    print_candidate_summary("CANDIDATE B", result["candidate_b"])

    print()
    print("=" * 48)
    print("COMPARISON")
    print("=" * 48)
    print(json.dumps(result["comparison"], indent=2))

    print()
    print("PSBT A generated: YES")
    print("PSBT B generated: YES")
    print()
    print("Signing: NOT PERFORMED")
    print("Broadcast: NOT PERFORMED")

    return {
        "candidate_a": result["candidate_a"],
        "candidate_b": result["candidate_b"],
        "comparison": result["comparison"],
        "psbts": result["psbts"],
    }



def main():
    parser = argparse.ArgumentParser(
        description="CoinLens pre-signing Bitcoin privacy planner"
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
