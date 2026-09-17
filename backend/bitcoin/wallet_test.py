import bdkpython as bdk
from pathlib import Path


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


def main():
    # Remove old test database so this run always starts clean.
    for path in (
        DB_PATH,
        Path(str(DB_PATH) + "-wal"),
        Path(str(DB_PATH) + "-shm"),
    ):
        if path.exists():
            path.unlink()

    print("Creating new BDK wallet...")

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

    print()
    print("Wallet created successfully!")
    print("Network:", wallet.network)
    print("Address:", address_info.address)
    print("Index:", address_info.index)
    print("Database:", DB_PATH)


if __name__ == "__main__":
    main()