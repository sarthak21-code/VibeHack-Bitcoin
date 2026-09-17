"""
Change output and address reuse detection.

Evaluates:
1. Likely change output creation and change amounts.
2. Address reuse on destination or change outputs.

Note on heuristics:
- In Bitcoin transactions, change is inferred by heuristics (round payment amounts,
  wallet-controlled scripts, or balance subtraction: inputs - payment - fee).
- The engine uses 'likely change' rather than claiming absolute certainty unless
  wallet metadata definitively flags it.
- Address reuse requires known address history; if unavailable, the engine reports
  explicitly 'insufficient metadata' instead of assuming false.
"""

from __future__ import annotations

from typing import Any, Iterable, List, Optional, Set, Tuple

from .models import CandidateInput, CandidateOutput, Finding, TransactionAnalysis


def analyze_change(
    inputs: list[CandidateInput],
    outputs: list[CandidateOutput],
    fee_sats: int,
    recipient_amount_sats: Optional[int] = None,
) -> tuple[TransactionAnalysis, list[Finding]]:
    """
    Analyze inputs, outputs, and fees to detect payment vs likely change.

    Returns:
        (TransactionAnalysis, findings)
    """
    findings: list[Finding] = []
    inputs_total_sats = sum(inp.amount_sats for inp in inputs)
    output_count = len(outputs)
    input_count = len(inputs)

    # Determine payment and change
    change_sats = 0
    payment_sats = 0
    change_created = False

    # Check if wallet-controlled change output is flagged
    wallet_outputs = [out for out in outputs if out.is_wallet_controlled is True]
    external_outputs = [out for out in outputs if out.is_wallet_controlled is False]

    if recipient_amount_sats is not None:
        payment_sats = recipient_amount_sats
        # Change is remaining amount after payment and fee
        calculated_change = inputs_total_sats - payment_sats - fee_sats
        if calculated_change > 0:
            change_created = True
            change_sats = calculated_change
        else:
            change_created = False
            change_sats = 0
    elif wallet_outputs and external_outputs:
        payment_sats = sum(out.amount_sats for out in external_outputs)
        change_sats = sum(out.amount_sats for out in wallet_outputs)
        change_created = change_sats > 0
    elif len(outputs) == 1:
        # Single output transaction (exact payment, no change)
        payment_sats = outputs[0].amount_sats
        change_sats = 0
        change_created = False
    elif len(outputs) >= 2:
        # Default fallback: inspect wallet_outputs if any, or treat smaller or residual as likely change
        if wallet_outputs:
            change_sats = sum(out.amount_sats for out in wallet_outputs)
            change_created = change_sats > 0
            payment_sats = sum(out.amount_sats for out in outputs) - change_sats
        else:
            # Estimate: if 2 outputs, the one that balances inputs - fee is analyzed
            # For candidate evaluation without explicit recipient amount, assume standard 2-output payment
            payment_sats = outputs[0].amount_sats
            change_sats = outputs[1].amount_sats
            change_created = change_sats > 0
    else:
        # No outputs provided
        payment_sats = max(0, inputs_total_sats - fee_sats)
        change_sats = 0
        change_created = False

    tx_analysis = TransactionAnalysis(
        input_count=input_count,
        output_count=output_count,
        inputs_total_sats=inputs_total_sats,
        payment_sats=payment_sats,
        fee_sats=fee_sats,
        change_sats=change_sats,
        change_created=change_created,
    )

    if change_created:
        findings.append(
            Finding(
                type="likely_change",
                severity="info",
                message=(
                    f"Transaction creates a likely change output of {change_sats:,} sats. "
                    "Change outputs can be analyzed by blockchain observers using round-number heuristics, "
                    "script matching, or wallet graph clustering."
                ),
                details={
                    "change_sats": change_sats,
                    "change_created": True,
                },
            )
        )
    else:
        findings.append(
            Finding(
                type="no_change",
                severity="info",
                message=(
                    "No change output created. Exact-payment transactions avoid change identification "
                    "heuristics and prevent linking change back to the wallet."
                ),
                details={
                    "change_sats": 0,
                    "change_created": False,
                },
            )
        )

    return tx_analysis, findings


def analyze_address_reuse(
    outputs: list[CandidateOutput],
    known_used_addresses: Optional[Iterable[str]] = None,
) -> tuple[Optional[bool], Optional[str], Optional[str], list[Finding]]:
    """
    Check candidate outputs against known used addresses.

    Returns:
        (address_reuse_detected, address_reuse_type, address_reuse_reason, findings)
    """
    findings: list[Finding] = []

    if known_used_addresses is None:
        findings.append(
            Finding(
                type="address_reuse",
                severity="info",
                message="Address reuse check skipped: insufficient address history metadata available.",
                details={"reason": "insufficient metadata"},
            )
        )
        return None, None, "insufficient metadata", findings

    known_set = set(known_used_addresses)
    reused_outputs: list[tuple[str, str]] = []

    for out in outputs:
        if out.address and out.address in known_set:
            reuse_type = "change" if out.is_wallet_controlled is True else "destination"
            reused_outputs.append((out.address, reuse_type))

    if reused_outputs:
        addr, reuse_type = reused_outputs[0]
        findings.append(
            Finding(
                type="address_reuse",
                severity="warning",
                message=(
                    f"Address reuse detected on {reuse_type} address '{addr}'. "
                    "Reusing addresses degrades privacy by explicitly linking distinct transactions together."
                ),
                details={
                    "address": addr,
                    "reuse_type": reuse_type,
                    "total_reused": len(reused_outputs),
                },
            )
        )
        return True, reuse_type, None, findings

    findings.append(
        Finding(
            type="address_reuse",
            severity="info",
            message="No address reuse detected among candidate outputs against provided address history.",
            details={"checked_outputs": len(outputs)},
        )
    )
    return False, None, None, findings
