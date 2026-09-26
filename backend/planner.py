import argparse
import hashlib
import json
from pathlib import Path

import bdkpython as bdk

from backend.bitcoin.psbt_analyzer import analyze_psbt
from backend.candidate_engine.selector import (
    largest_first,
    two_utxo_pair,
    smallest_single,
    single_cluster_only,
)
from backend.privacy_engine import analyze_candidate, compare_candidates
from backend.utxo_labels import seed_if_empty


DB_PATH = Path(__file__).resolve().parent / "bitcoin" / "coinlens_wallet.sqlite3"

# Sqlite persister files for any watch-only descriptor a user connects at
# runtime (see connect_descriptor_wallet). Keyed by a hash of the descriptor
# pair so the same descriptor always reuses its own synced chain data.
CONNECTED_WALLETS_DIR = Path(__file__).resolve().parent / "bitcoin" / "connected_wallets"

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


# Kept identical to backend/api.py's broadcast endpoint so a descriptor
# synced here sees the same chain data broadcasts are checked against.
SIGNET_ESPLORA_URL = "https://blockstream.info/signet/api/"


# ------------------------------------------------------------------
# Active wallet selection
#
# This is process-global state, not per-user session state: the app has
# one operator (as with the rest of this prototype -- see README), so
# "connecting a descriptor" simply changes which wallet subsequent /plan,
# /what-if, /utxos etc. calls read from, for every request, until reset.
# ------------------------------------------------------------------

_active_descriptor = DESCRIPTOR
_active_change_descriptor = CHANGE_DESCRIPTOR


def set_active_wallet(descriptor_str, change_descriptor_str):
    global _active_descriptor, _active_change_descriptor
    _active_descriptor = descriptor_str
    _active_change_descriptor = change_descriptor_str


def get_active_wallet_descriptors():
    return _active_descriptor, _active_change_descriptor


def is_default_wallet_active():
    return (
        _active_descriptor == DESCRIPTOR
        and _active_change_descriptor == CHANGE_DESCRIPTOR
    )


def _connected_wallet_db_path(descriptor_str, change_descriptor_str):
    digest = hashlib.sha256(
        f"{descriptor_str}|{change_descriptor_str}".encode("utf-8")
    ).hexdigest()[:16]
    CONNECTED_WALLETS_DIR.mkdir(parents=True, exist_ok=True)
    return CONNECTED_WALLETS_DIR / f"{digest}.sqlite3"


def load_wallet():
    """Load whichever wallet is currently active (the built-in demo wallet
    by default, or a descriptor connected via connect_descriptor_wallet)."""

    descriptor_str, change_descriptor_str = get_active_wallet_descriptors()

    if is_default_wallet_active():
        db_path = DB_PATH
    else:
        db_path = _connected_wallet_db_path(descriptor_str, change_descriptor_str)

    persister = bdk.Persister.new_sqlite(str(db_path))

    wallet = bdk.Wallet.load(
        descriptor=bdk.Descriptor(
            descriptor_str,
            bdk.NetworkKind.TEST,
        ),
        change_descriptor=bdk.Descriptor(
            change_descriptor_str,
            bdk.NetworkKind.TEST,
        ),
        persister=persister,
    )

    return wallet, persister


def connect_descriptor_wallet(
    descriptor_str,
    change_descriptor_str=None,
    stop_gap=25,
    parallel_requests=5,
):
    """
    Load (creating if needed) a watch-only wallet for an arbitrary descriptor
    and run a full chain scan against the public Signet Esplora endpoint to
    discover its real UTXOs, then make it the active wallet.

    NOTE ON BDK VERSIONS: this targets bdkpython's Wallet.create_with_params /
    start_full_scan / EsploraClient.full_scan / apply_update surface,
    verified against the bdkpython release used elsewhere in this codebase.
    If you upgrade bdkpython and these names change, run
    `python -c "import bdkpython as bdk; help(bdk.Wallet)"` to find the
    current equivalents.
    """

    descriptor_str = descriptor_str.strip()
    change_descriptor_str = (change_descriptor_str or "").strip() or None

    descriptor_obj = bdk.Descriptor(descriptor_str, bdk.NetworkKind.TEST)

    # A watch-only wallet with no separate change descriptor is common
    # (single-descriptor wallets); reuse the receive descriptor for change
    # in that case rather than forcing the user to supply one.
    effective_change_str = change_descriptor_str or descriptor_str
    change_descriptor_obj = bdk.Descriptor(effective_change_str, bdk.NetworkKind.TEST)

    db_path = _connected_wallet_db_path(descriptor_str, effective_change_str)
    is_new = not db_path.exists()
    persister = bdk.Persister.new_sqlite(str(db_path))

    if is_new:
        wallet = bdk.Wallet.create_with_params(
            descriptor_obj,
            change_descriptor_obj,
            bdk.Network.SIGNET,
            persister,
            bdk.CreateParams(
                genesis_hash=None,
                lookahead=25,
                use_spk_cache=True,
            ),
        )
    else:
        wallet = bdk.Wallet.load(
            descriptor=descriptor_obj,
            change_descriptor=change_descriptor_obj,
            persister=persister,
        )

    client = bdk.EsploraClient(SIGNET_ESPLORA_URL)

    # --- bdk-ffi full-scan sync (see version note above) ---
    scan_request = wallet.start_full_scan().build()
    update = client.full_scan(
        request=scan_request,
        stop_gap=stop_gap,
        parallel_requests=parallel_requests,
    )
    wallet.apply_update(update)
    # ---------------------------------------------------------

    wallet.persist(persister)

    set_active_wallet(descriptor_str, effective_change_str)

    utxos = get_real_utxos(wallet)
    balance = wallet.balance()
    confirmed_sats = None
    try:
        confirmed_sats = balance.confirmed.to_sat()
    except AttributeError:
        pass

    return {
        "descriptor": descriptor_str,
        "change_descriptor": effective_change_str,
        "utxo_count": len(utxos),
        "confirmed_sats": confirmed_sats,
        "is_new_wallet": is_new,
    }


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
    They are local labels used only as sensible defaults, until a
    user overrides them with their own tags (see backend/utxo_labels.py).
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


def build_utxo_metadata(utxos):
    """
    Merge persisted user-defined UTXO labels with sensible built-in demo
    defaults. Persisted labels always win over the defaults; any UTXO with
    no persisted label falls back to the demo defaults, so the app still
    has clusters to show the very first time it runs.
    """

    defaults = make_demo_metadata(utxos)
    persisted = seed_if_empty(defaults)

    metadata = dict(defaults)
    metadata.update(persisted)
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


def print_candidate_summary(label, data):
    """Print the useful human-readable facts for one candidate (already-normalized dict)."""

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


# Each strategy produces a genuinely distinct selection philosophy, so the
# comparison screen shows real, meaningfully different trade-offs rather
# than cosmetic variations of the same choice.
STRATEGIES = [
    {
        "id": "A",
        "name": "Two-UTXO Pair",
        "description": "Combines two UTXOs sized just above the payment plus a fee reserve.",
        "fn": lambda utxos, amount, metadata, max_inputs: (
            smallest_single(utxos, amount)
            if max_inputs == 1
            else two_utxo_pair(utxos, amount)
        ),
    },
    {
        "id": "B",
        "name": "Largest First",
        "description": "Spends the single largest UTXO(s) available, minimizing input count.",
        "fn": lambda utxos, amount, metadata, max_inputs: largest_first(utxos, amount),
    },
    {
        "id": "C",
        "name": "Smallest Covering Coin",
        "description": "Uses the smallest single UTXO that alone covers the payment, preserving larger coins for later.",
        "fn": lambda utxos, amount, metadata, max_inputs: smallest_single(utxos, amount),
    },
    {
        "id": "D",
        "name": "Single Cluster Only",
        "description": "Restricts spending to UTXOs from one wallet-side metadata cluster, even if it costs more.",
        "fn": lambda utxos, amount, metadata, max_inputs: single_cluster_only(
            utxos, amount, metadata
        ),
    },
]


def plan_candidates(
    destination,
    amount_sats=DEFAULT_AMOUNT_SATS,
    fee_rate_sat_vb=DEFAULT_FEE_RATE_SAT_VB,
    exclude_utxo_ids=None,
    max_inputs=None,
):
    """
    Core candidate planning and scenario simulation engine.

    Generates up to len(STRATEGIES) distinct transaction candidates (see
    STRATEGIES above), analyzes each for privacy trade-offs, and produces a
    quantified side-by-side comparison.

    Supports deterministic 'What If' parameterization:
    - fee_rate_sat_vb
    - amount_sats
    - exclude_utxo_ids (outpoint strings or 'reserve')
    - max_inputs (e.g. 1 for single-input constraint)
    """
    wallet, persister = load_wallet()
    all_utxos = get_real_utxos(wallet)
    utxo_metadata = build_utxo_metadata(all_utxos)

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
    candidates_data = []

    # Tracks which UTXO set each successful strategy picked, so that if a
    # later strategy lands on the exact same set (common with a small
    # demo wallet) we report it as a clear duplicate instead of silently
    # showing two "different" candidates that are actually identical.
    seen_selections = {}

    for strategy in STRATEGIES:
        cid = strategy["id"]
        data = {
            "candidate_id": cid,
            "strategy_name": strategy["name"],
            "strategy_description": strategy["description"],
        }

        try:
            if not available_utxos:
                raise ValueError("Insufficient funds: no UTXOs available after exclusion")

            selected = strategy["fn"](available_utxos, amount_sats, utxo_metadata, max_inputs)

            selection_key = frozenset(u["outpoint_str"] for u in selected)
            if selection_key in seen_selections:
                raise ValueError(
                    f"Selects the same UTXO(s) as Candidate {seen_selections[selection_key]} "
                    "under these conditions; skipped to avoid showing a duplicate transaction."
                )

            if max_inputs is not None and len(selected) > max_inputs:
                raise ValueError(
                    f"Constraint exceeded: requires <= {max_inputs} inputs, "
                    f"but {strategy['name']} selected {len(selected)}"
                )

            psbt = build_psbt(
                wallet,
                selected,
                destination,
                amount_sats,
                fee_rate_sat_vb,
            )
            cand_dict = analyze_psbt(psbt, wallet, candidate_id=cid)
            analysis = analyze_candidate(
                cand_dict,
                utxo_metadata,
                wallet_utxos=all_utxos,
            )
            norm = normalize_for_json(analysis)
            data.update(norm)
            data["txid"] = cand_dict["_metadata"]["txid"]
            data["vsize"] = cand_dict["_metadata"]["vsize"]
            data["weight"] = cand_dict["_metadata"]["weight"]
            data["valid"] = True

            seen_selections[selection_key] = cid
            psbts[cid] = str(psbt)
            valid_analyses.append(analysis)
        except Exception as exc:
            data["valid"] = False
            data["error"] = str(exc)

        candidates_data.append(data)

    if len(valid_analyses) >= 2:
        comparison = compare_candidates(valid_analyses)
        comparison_data = normalize_for_json(comparison)
    elif len(valid_analyses) == 1:
        valid_id = valid_analyses[0].candidate_id
        invalid_summaries = [
            f"{c['candidate_id']}: {c.get('error')}"
            for c in candidates_data
            if not c.get("valid")
        ]
        comparison_data = {
            "summary": (
                f"Only Candidate {valid_id} could be constructed under these scenario conditions. "
                + ("; ".join(invalid_summaries) if invalid_summaries else "")
            ),
            "tradeoffs": [
                {
                    "candidate_id": valid_id,
                    "summary": f"Single valid candidate ({valid_id}) under scenario conditions.",
                    "pros": ["Constructable under specified scenario parameters"],
                    "cons": [],
                    "metrics": {},
                }
            ],
        }
    else:
        invalid_summaries = [
            f"{c['candidate_id']}: {c.get('error')}" for c in candidates_data
        ]
        comparison_data = {
            "summary": (
                "No valid transaction candidates could be constructed under these scenario conditions. "
                + "; ".join(invalid_summaries)
            ),
            "tradeoffs": [],
        }

    wallet.persist(persister)

    return {
        "scenario": scenario_info,
        "candidates": candidates_data,
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
        -> candidate generation (N distinct strategies)
        -> BDK PSBT construction
        -> PSBT analysis
        -> privacy analysis
        -> quantified candidate comparison
    """
    result = plan_candidates(
        destination=destination,
        amount_sats=amount_sats,
        fee_rate_sat_vb=fee_rate_sat_vb,
    )

    valid_candidates = [c for c in result["candidates"] if c.get("valid")]

    if not valid_candidates:
        errors = "; ".join(
            f"{c['candidate_id']}: {c.get('error')}" for c in result["candidates"]
        )
        raise ValueError(f"No transaction candidates could be built: {errors}")

    print("=" * 48)
    print("COINLENS PRE-SIGNING BITCOIN PRIVACY PLANNER")
    print("=" * 48)

    print("Payment:", amount_sats, "sats")
    print("Destination:", destination)
    print("Fee rate:", fee_rate_sat_vb, "sat/vB")

    for candidate in result["candidates"]:
        if candidate.get("valid"):
            print_candidate_summary(f"CANDIDATE {candidate['candidate_id']}", candidate)
        else:
            print()
            print("=" * 48)
            print(f"CANDIDATE {candidate['candidate_id']}: INVALID")
            print("=" * 48)
            print(" ", candidate.get("error"))

    print()
    print("=" * 48)
    print("COMPARISON")
    print("=" * 48)
    print(json.dumps(result["comparison"], indent=2))

    print()
    for candidate in result["candidates"]:
        status = "YES" if candidate.get("valid") else "NO"
        print(f"PSBT {candidate['candidate_id']} generated:", status)
    print()
    print("Signing: NOT PERFORMED")
    print("Broadcast: NOT PERFORMED")

    return {
        "candidates": result["candidates"],
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
