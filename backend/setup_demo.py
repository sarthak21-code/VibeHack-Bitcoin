from pathlib import Path

import bdkpython as bdk


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

SIGNET_ESPLORA_URL = "https://blockstream.info/signet/api/"


def remove_database_files():
    for path in (
        DB_PATH,
        Path(str(DB_PATH) + "-wal"),
        Path(str(DB_PATH) + "-shm"),
    ):
        if path.exists():
            path.unlink()


def create_wallet():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    descriptor = bdk.Descriptor(
        DESCRIPTOR,
        bdk.NetworkKind.TEST,
    )

    change_descriptor = bdk.Descriptor(
        CHANGE_DESCRIPTOR,
        bdk.NetworkKind.TEST,
    )

    persister = bdk.Persister.new_sqlite(str(DB_PATH))

    wallet = bdk.Wallet(
        descriptor=descriptor,
        change_descriptor=change_descriptor,
        network=bdk.Network.SIGNET,
        persister=persister,
    )

    address_info = wallet.reveal_next_address(
        bdk.KeychainKind.EXTERNAL
    )

    wallet.persist(persister)

    return wallet, persister, address_info


def sync_wallet(wallet, persister):
    print("\nConnecting to Signet Esplora...")

    client = bdk.EsploraClient(SIGNET_ESPLORA_URL)

    print("Building full-scan request...")

    request = wallet.start_full_scan().build()

    print("Scanning Signet blockchain...")

    update = client.full_scan(
        request=request,
        stop_gap=10,
        parallel_requests=1,
    )

    print("Applying blockchain update...")

    wallet.apply_update(update)
    wallet.persist(persister)


def main():
    print("=" * 55)
    print("VIBEHACK DEMO WALLET SETUP")
    print("=" * 55)
    print("Network: Signet")
    print("Database:", DB_PATH)

    if DB_PATH.exists():
        print("\nExisting wallet database found.")
        print("Keeping the existing database and syncing it.")
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

        address_info = wallet.reveal_next_address(
            bdk.KeychainKind.EXTERNAL
        )

    else:
        print("\nNo wallet database found.")
        print("Creating a new watch-only BDK wallet...")

        wallet, persister, address_info = create_wallet()

        print("Wallet created successfully.")

    print("\nDemo address:")
    print(address_info)

    sync_wallet(wallet, persister)

    balance = wallet.balance()

    print("\n=== WALLET BALANCE ===")
    print("Confirmed:", balance.confirmed.to_sat(), "sats")
    print("Trusted:", balance.trusted_spendable.to_sat(), "sats")
    print("Total:", balance.total.to_sat(), "sats")

    print("\n=== UTXOS ===")

    utxos = wallet.list_unspent()

    if not utxos:
        print("No UTXOs found.")
        print("\nSend Signet coins to:")
        print(address_info)
        print("\nThen run this setup script again to sync.")
        return

    print("Found", len(utxos), "UTXOs.")

    for utxo in utxos:
        print(
            f"{utxo.outpoint.txid}:{utxo.outpoint.vout}"
            f" -> {utxo.txout.value.to_sat()} sats"
        )

    print("\nDemo wallet setup complete.")


if __name__ == "__main__":
    main()
