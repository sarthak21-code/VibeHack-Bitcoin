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

def main():
    persister = bdk.Persister.new_sqlite(str(DB_PATH))

    wallet = bdk.Wallet.load(
        descriptor=bdk.Descriptor(DESCRIPTOR, bdk.NetworkKind.TEST),
        change_descriptor=bdk.Descriptor(
            CHANGE_DESCRIPTOR,
            bdk.NetworkKind.TEST,
        ),
        persister=persister,
    )

    utxos = wallet.list_unspent()

    print("Number of UTXOs:", len(utxos))
    print()

    for i, utxo in enumerate(utxos, start=1):
        print(f"UTXO #{i}")
        print("TXID:", utxo.outpoint.txid)
        print("Vout:", utxo.outpoint.vout)
        print("Value:", utxo.txout.value.to_sat(), "sats")
        print("Keychain:", utxo.keychain)
        print("Spent:", utxo.is_spent)
        print()

if __name__ == "__main__":
    main()
