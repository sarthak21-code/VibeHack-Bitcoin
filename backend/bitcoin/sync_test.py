from pathlib import Path

import bdkpython as bdk


DB_PATH = Path(__file__).resolve().parent / "vibehack_wallet.sqlite3"

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

SIGNET_ESPLORA_URL = "https://blockstream.info/signet/api/"


def main():
    print("Starting VibeHack wallet sync...")

    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"Wallet database not found: {DB_PATH}"
        )

    print("Opening wallet database...")

    persister = bdk.Persister.new_sqlite(str(DB_PATH))

    descriptor = bdk.Descriptor(
        DESCRIPTOR,
        bdk.NetworkKind.TEST,
    )

    change_descriptor = bdk.Descriptor(
        CHANGE_DESCRIPTOR,
        bdk.NetworkKind.TEST,
    )

    wallet = bdk.Wallet.load(
        descriptor=descriptor,
        change_descriptor=change_descriptor,
        persister=persister,
    )

    print("Wallet loaded.")
    print("Network:", wallet.network())

    print("\nConnecting to Signet Esplora...")

    client = bdk.EsploraClient(SIGNET_ESPLORA_URL)

    print("Building full-scan request...")

    request = wallet.start_full_scan().build()

    print("Scanning blockchain...")

    update = client.full_scan(
        request=request,
        stop_gap=10,
        parallel_requests=1,
    )

    print("Applying blockchain update...")

    wallet.apply_update(update)
    wallet.persist(persister)

    balance = wallet.balance()

    print("\n=== WALLET BALANCE ===")
    print("Confirmed:", balance.confirmed.to_sat(), "sats")
    print("Trusted:", balance.trusted_spendable.to_sat(), "sats")
    print("Total:", balance.total.to_sat(), "sats")

    print("\n=== UTXOs ===")

    utxos = wallet.list_unspent()

    if not utxos:
        print("No UTXOs found.")
        print()
        print("Send Signet coins to:")
        address_info = wallet.reveal_next_address(
            bdk.KeychainKind.EXTERNAL
        )
        print(address_info.address)
        print("Address index:", address_info.index)
        return

    for utxo in utxos:
        print(utxo)


if __name__ == "__main__":
    main()
