def largest_first(utxos, target_sats, fee_reserve_sats=500):
    """Select the largest UTXOs first until the target plus a fee reserve is covered."""

    required = target_sats + fee_reserve_sats

    sorted_utxos = sorted(
        utxos,
        key=lambda u: u["amount_sats"],
        reverse=True,
    )

    selected = []
    total = 0

    for utxo in sorted_utxos:
        selected.append(utxo)
        total += utxo["amount_sats"]

        if total >= required:
            return selected

    raise ValueError("Insufficient funds")


def smallest_single(utxos, target_sats, fee_reserve_sats=500):
    """
    Choose the smallest single UTXO that can cover the payment plus
    a small fee reserve, so the resulting PSBT has enough value left
    to pay the network fee.
    """

    required = target_sats + fee_reserve_sats

    candidates = [
        utxo
        for utxo in utxos
        if utxo["amount_sats"] >= required
    ]

    if not candidates:
        raise ValueError("No single UTXO can cover the target")

    return [
        min(
            candidates,
            key=lambda utxo: utxo["amount_sats"],
        )
    ]


def two_utxo_pair(utxos, target_sats, fee_reserve_sats=500):
    """
    Find two UTXOs whose combined value covers
    the payment plus a small fee reserve.
    """

    required = target_sats + fee_reserve_sats
    best_pair = None
    best_total = None

    for i in range(len(utxos)):
        for j in range(i + 1, len(utxos)):
            pair = [utxos[i], utxos[j]]
            total = sum(
                utxo["amount_sats"]
                for utxo in pair
            )

            if total >= required:
                if best_total is None or total < best_total:
                    best_pair = pair
                    best_total = total

    if best_pair is None:
        raise ValueError("No suitable two-UTXO pair found")

    return best_pair


def single_cluster_only(utxos, target_sats, utxo_metadata, fee_reserve_sats=500):
    """
    Restrict spending to UTXOs from a single wallet-side metadata cluster,
    even if that costs more inputs or a higher fee than mixing clusters would.

    Within each cluster, UTXOs are spent largest-first (fewest inputs) until
    the cluster's own value covers the payment plus a fee reserve. The
    cluster requiring the fewest inputs (ties broken by lowest total value
    spent) is chosen.
    """

    required = target_sats + fee_reserve_sats

    by_cluster = {}
    for utxo in utxos:
        meta = utxo_metadata.get(utxo["outpoint_str"], {}) or {}
        cluster = meta.get("cluster") or "unlabeled"
        by_cluster.setdefault(cluster, []).append(utxo)

    best = None  # (input_count, total_sats, utxo_list)

    for cluster_utxos in by_cluster.values():
        sorted_utxos = sorted(
            cluster_utxos,
            key=lambda u: u["amount_sats"],
            reverse=True,
        )

        selected = []
        total = 0

        for utxo in sorted_utxos:
            selected.append(utxo)
            total += utxo["amount_sats"]

            if total >= required:
                candidate = (len(selected), total, list(selected))
                if best is None or (candidate[0], candidate[1]) < (best[0], best[1]):
                    best = candidate
                break

    if best is None:
        raise ValueError(
            "No single wallet-side metadata cluster holds enough value for this payment"
        )

    return best[2]
