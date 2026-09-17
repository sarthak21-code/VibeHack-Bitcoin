from selector import largest_first, cluster_isolated


utxos = [
    {
        "outpoint": "txid-A:0",
        "amount_sats": 1_000_000,
        "cluster": "A"
    },
    {
        "outpoint": "txid-B:0",
        "amount_sats": 1_500_000,
        "cluster": "A"
    },
    {
        "outpoint": "txid-C:0",
        "amount_sats": 3_000_000,
        "cluster": "B"
    }
]

target = 2_000_000


print("=== Candidate A: Largest First ===")

candidate_a = largest_first(utxos, target)

for utxo in candidate_a:
    print(utxo)


print("\n=== Candidate B: Cluster Isolated ===")

candidate_b = cluster_isolated(utxos, target)

for utxo in candidate_b:
    print(utxo)