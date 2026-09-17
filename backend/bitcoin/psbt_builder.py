import bdkpython as bdk


def build_psbt(wallet, outpoints, destination, amount_sats, fee_rate):
    """
    Build a PSBT using exactly the supplied UTXOs.
    """

    address = bdk.Address(
        destination,
        bdk.Network.TESTNET,
    )

    builder = bdk.TxBuilder()

    builder.add_utxos(outpoints)
    builder.manually_selected_only()

    builder.add_recipient(
        address.script_pubkey(),
        bdk.Amount.from_sat(amount_sats),
    )

    builder.fee_rate(
        bdk.FeeRate.from_sat_per_vb(fee_rate)
    )

    psbt = builder.finish(wallet)

    return psbt