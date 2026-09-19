def largest_first(utxos, target_sats):
    """Select the largest UTXOs first until the target is covered."""

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

        if total >= target_sats:
            return selected

    raise ValueError("Insufficient funds")


def smallest_single(utxos, target_sats):
    """Choose the smallest single UTXO that can cover the payment."""

    candidates = [
        utxo
        for utxo in utxos
        if utxo["amount_sats"] >= target_sats
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
