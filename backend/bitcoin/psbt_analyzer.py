"""
PSBT Analyzer - Extracts structured transaction facts from BDK PSBT objects.

Translates consensus-level PSBT and wallet data into candidate transaction facts
for consumption by Member 2's Privacy Engine:
- Inputs with outpoints (txid:vout) and satoshi amounts.
- Outputs with decoded addresses, satoshi amounts, and wallet ownership status.
- Exact transaction fee derived from inputs - outputs or psbt.fee().
- Intended recipient payment amount.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
import bdkpython as bdk


def extract_inputs(
    psbt: bdk.Psbt,
    wallet: Optional[bdk.Wallet] = None,
) -> list[dict[str, Any]]:
    """
    Extract inputs from PSBT with outpoints and satoshi amounts.

    Uses PSBT witness_utxo / non_witness_utxo and falls back to wallet UTXO records.
    """
    tx = psbt.extract_tx_unchecked_fee_rate()
    tx_inputs = tx.input()
    psbt_inputs = psbt.input()

    extracted: list[dict[str, Any]] = []

    for i, txin in enumerate(tx_inputs):
        prevout = txin.previous_output
        outpoint_str = f"{prevout.txid}:{prevout.vout}"
        amount_sats: Optional[int] = None

        # 1. Inspect PSBT input witness_utxo
        if i < len(psbt_inputs):
            p_in = psbt_inputs[i]
            if p_in.witness_utxo is not None:
                amount_sats = p_in.witness_utxo.value.to_sat()
            elif p_in.non_witness_utxo is not None:
                # Extract output from non_witness_utxo
                nw_tx = p_in.non_witness_utxo
                nw_outputs = nw_tx.output()
                if prevout.vout < len(nw_outputs):
                    amount_sats = nw_outputs[prevout.vout].value.to_sat()

        # 2. Fallback to wallet UTXO lookup if amount not yet found
        if amount_sats is None and wallet is not None:
            try:
                utxo = wallet.get_utxo(prevout)
                if utxo is not None:
                    amount_sats = utxo.txout.value.to_sat()
            except Exception:
                pass

        extracted.append(
            {
                "outpoint": outpoint_str,
                "amount_sats": amount_sats,
            }
        )

    return extracted


def extract_outputs(
    psbt: bdk.Psbt,
    wallet: Optional[bdk.Wallet] = None,
    network: Optional[bdk.Network] = None,
) -> list[dict[str, Any]]:
    """
    Extract outputs from PSBT with amounts, addresses, and wallet ownership status.

    Uses BDK's wallet.is_mine() and wallet.derivation_of_spk() to reliably classify
    wallet-controlled change vs external recipient outputs.
    """
    tx = psbt.extract_tx_unchecked_fee_rate()
    tx_outputs = tx.output()

    if network is None and wallet is not None:
        try:
            network = wallet.network()
        except Exception:
            network = bdk.Network.SIGNET
    elif network is None:
        network = bdk.Network.SIGNET

    extracted: list[dict[str, Any]] = []

    for tout in tx_outputs:
        amount_sats = tout.value.to_sat()
        script_pubkey = tout.script_pubkey

        # Decode address
        address_str: Optional[str] = None
        try:
            addr = bdk.Address.from_script(script_pubkey, network)
            address_str = str(addr)
        except Exception:
            address_str = None

        # Determine wallet ownership
        is_wallet_controlled: Optional[bool] = None
        if wallet is not None:
            is_mine = wallet.is_mine(script_pubkey)
            deriv = wallet.derivation_of_spk(script_pubkey)

            if not is_mine:
                # Truly external recipient
                is_wallet_controlled = False
            elif deriv is not None and deriv.keychain == bdk.KeychainKind.INTERNAL:
                # Definite change output on internal change descriptor
                is_wallet_controlled = True
            elif deriv is not None and deriv.keychain == bdk.KeychainKind.EXTERNAL:
                # Derived from external receive keychain (e.g. self-transfer or test recipient)
                # In transaction semantics, external keychain is the receive destination
                is_wallet_controlled = False
            else:
                is_wallet_controlled = is_mine

        extracted.append(
            {
                "address": address_str,
                "amount_sats": amount_sats,
                "is_wallet_controlled": is_wallet_controlled,
            }
        )

    return extracted


def calculate_fee(
    psbt: bdk.Psbt,
    inputs: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
) -> tuple[Optional[int], Optional[str]]:
    """
    Calculate the actual fee in satoshis.

    Attempts BDK psbt.fee() first, then falls back to total_inputs - total_outputs.
    """
    # 1. Attempt BDK's native fee calculation
    try:
        fee = psbt.fee()
        if fee is not None and fee >= 0:
            return fee, None
    except Exception:
        pass

    # 2. Arithmetic fallback from extracted inputs and outputs
    input_values = [inp["amount_sats"] for inp in inputs]
    output_values = [out["amount_sats"] for out in outputs]

    if all(v is not None for v in input_values) and all(v is not None for v in output_values):
        total_in = sum(v for v in input_values if v is not None)
        total_out = sum(v for v in output_values if v is not None)
        fee = total_in - total_out
        if fee >= 0:
            return fee, None

    return None, "Fee could not be determined: input prevout values missing or inconsistent."


def identify_recipient_amount(
    outputs: list[dict[str, Any]],
) -> Optional[int]:
    """
    Identify intended payment recipient amount.

    Sums amounts for external (not wallet-controlled) outputs.
    """
    external_outputs = [
        out for out in outputs if out.get("is_wallet_controlled") is False
    ]
    if external_outputs:
        return sum(out["amount_sats"] for out in external_outputs)

    # If only 1 output exists total, that single output is the payment
    if len(outputs) == 1:
        return outputs[0]["amount_sats"]

    return None


def analyze_psbt(
    psbt: bdk.Psbt,
    wallet: Optional[bdk.Wallet] = None,
    candidate_id: str = "A",
) -> dict[str, Any]:
    """
    Analyze a BDK Psbt and return structured transaction facts compatible
    with Member 2's Privacy Engine.

    Args:
        psbt: BDK Psbt object.
        wallet: Optional BDK Wallet used for UTXO and ownership resolution.
        candidate_id: Identifier label (e.g. 'A', 'B').

    Returns:
        Dictionary adhering to Member 2's CandidateTransaction schema.
    """
    inputs = extract_inputs(psbt, wallet)
    outputs = extract_outputs(psbt, wallet)
    fee_sats, fee_error = calculate_fee(psbt, inputs, outputs)
    recipient_amount_sats = identify_recipient_amount(outputs)

    tx = psbt.extract_tx_unchecked_fee_rate()
    txid_str = str(tx.compute_txid())

    return {
        "candidate_id": candidate_id,
        "inputs": inputs,
        "outputs": outputs,
        "fee_sats": fee_sats,
        "recipient_amount_sats": recipient_amount_sats,
        "_metadata": {
            "txid": txid_str,
            "vsize": tx.vsize(),
            "weight": tx.weight(),
            "fee_error": fee_error,
        },
    }
