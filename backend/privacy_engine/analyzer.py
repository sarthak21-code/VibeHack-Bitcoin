"""
Central analyzer and candidate comparison coordinator.

Takes candidate transaction structures and wallet metadata, orchestrates
privacy checks (clusters, change, address reuse, optionality), and produces
structured analysis results and comparative trade-offs.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Union

from .change import analyze_address_reuse, analyze_change
from .cluster import analyze_clusters_and_inputs
from .models import (
    CandidateAnalysisResult,
    CandidateInput,
    CandidateOutput,
    CandidateTradeoff,
    CandidateTransaction,
    ComparisonResult,
    Finding,
    FutureOptionalityAnalysis,
    PrivacyAnalysis,
    TransactionAnalysis,
    UTXOMetadata,
)
from .optionality import analyze_optionality


def analyze_candidate(
    candidate: Union[CandidateTransaction, dict[str, Any]],
    utxo_metadata: Optional[dict[str, Union[UTXOMetadata, dict[str, Any]]]] = None,
    known_used_addresses: Optional[Iterable[str]] = None,
    wallet_utxos: Optional[list[Any]] = None,
) -> CandidateAnalysisResult:
    """
    Perform complete privacy and structural analysis on a single candidate transaction.

    Args:
        candidate: A CandidateTransaction or dictionary conforming to candidate schema.
        utxo_metadata: Mapping of outpoints (txid:vout) to cluster/label/rare metadata.
        known_used_addresses: Known address history for address reuse detection.
        wallet_utxos: Full list of current wallet UTXOs to assess remaining capacity.

    Returns:
        Structured CandidateAnalysisResult containing transaction, privacy, optionality,
        and atomic findings.
    """
    if isinstance(candidate, dict):
        candidate_obj = CandidateTransaction.from_dict(candidate)
    else:
        candidate_obj = candidate

    utxo_metadata = utxo_metadata or {}

    # 1. Change & Transaction analysis
    tx_analysis, change_findings = analyze_change(
        inputs=candidate_obj.inputs,
        outputs=candidate_obj.outputs,
        fee_sats=candidate_obj.fee_sats,
        recipient_amount_sats=candidate_obj.recipient_amount_sats,
    )

    # 2. Address reuse analysis
    (
        addr_reuse,
        addr_type,
        addr_reason,
        addr_findings,
    ) = analyze_address_reuse(
        outputs=candidate_obj.outputs,
        known_used_addresses=known_used_addresses,
    )

    # 3. Cluster & Common Input Heuristic analysis
    (
        clusters_used,
        clusters_count,
        clusters_merged,
        multiple_inputs,
        cluster_findings,
    ) = analyze_clusters_and_inputs(
        inputs=candidate_obj.inputs,
        utxo_metadata=utxo_metadata,
    )

    # 4. Future Optionality & Rare UTXO analysis
    opt_analysis, opt_findings = analyze_optionality(
        inputs=candidate_obj.inputs,
        utxo_metadata=utxo_metadata,
        wallet_utxos=wallet_utxos,
        change_created=tx_analysis.change_created,
    )

    privacy_analysis = PrivacyAnalysis(
        clusters_used=clusters_used,
        clusters_count=clusters_count,
        clusters_merged=clusters_merged,
        multiple_inputs=multiple_inputs,
        address_reuse_detected=addr_reuse,
        address_reuse_type=addr_type,
        address_reuse_reason=addr_reason,
    )

    # Combine all findings deterministically
    all_findings: list[Finding] = []
    all_findings.extend(cluster_findings)
    all_findings.extend(change_findings)
    all_findings.extend(addr_findings)
    all_findings.extend(opt_findings)

    return CandidateAnalysisResult(
        candidate_id=candidate_obj.candidate_id,
        transaction=tx_analysis,
        privacy=privacy_analysis,
        future_optionality=opt_analysis,
        findings=all_findings,
    )


def compare_candidates(
    candidates_or_results: list[Union[CandidateAnalysisResult, dict[str, Any]]],
) -> ComparisonResult:
    """
    Compare multiple candidate analysis results and identify side-by-side trade-offs.

    Args:
        candidates_or_results: List of CandidateAnalysisResult instances (or their dict representations).

    Returns:
        ComparisonResult with structured trade-offs per candidate and comparative summary.
    """
    analysis_results: list[CandidateAnalysisResult] = []

    for item in candidates_or_results:
        if isinstance(item, CandidateAnalysisResult):
            analysis_results.append(item)
        elif isinstance(item, dict):
            # Parse dict back into CandidateAnalysisResult if needed
            tx = TransactionAnalysis(**item["transaction"])
            priv = PrivacyAnalysis(**item["privacy"])
            opt = FutureOptionalityAnalysis(**item["future_optionality"])
            findings = [Finding(**f) for f in item.get("findings", [])]
            analysis_results.append(
                CandidateAnalysisResult(
                    candidate_id=item["candidate_id"],
                    transaction=tx,
                    privacy=priv,
                    future_optionality=opt,
                    findings=findings,
                )
            )

    candidate_ids = [r.candidate_id for r in analysis_results]
    candidates_map = {r.candidate_id: r for r in analysis_results}
    tradeoffs: list[CandidateTradeoff] = []

    for res in analysis_results:
        pros: list[str] = []
        cons: list[str] = []

        # Evaluate Common Input
        if not res.privacy.multiple_inputs:
            pros.append("Single input avoids common-input ownership heuristic.")
        else:
            cons.append(
                f"Uses {res.transaction.input_count} inputs, linking them via the common-input ownership heuristic."
            )

        # Evaluate Clusters
        if res.privacy.clusters_merged:
            clusters_str = ", ".join(f"'{c}'" for c in res.privacy.clusters_used)
            cons.append(f"Merges {res.privacy.clusters_count} metadata clusters ({clusters_str}).")
        elif res.privacy.clusters_count == 1:
            pros.append(f"Isolates spending to a single metadata cluster ('{res.privacy.clusters_used[0]}').")

        # Evaluate Rare UTXO / Optionality
        if res.future_optionality.rare_utxo_consumed:
            cons.append("Consumes a tagged rare or important UTXO, reducing future wallet flexibility.")
        else:
            pros.append("Preserves tagged rare/important UTXOs for future spending.")

        # Evaluate Change Output
        if not res.transaction.change_created:
            pros.append("Creates no change output (avoids change detection heuristics).")
        else:
            cons.append(
                f"Creates a likely change output ({res.transaction.change_sats:,} sats)."
            )

        # Evaluate Address Reuse
        if res.privacy.address_reuse_detected is True:
            cons.append(f"Reuses address on {res.privacy.address_reuse_type} output.")

        # Construct short summary
        summary_parts = []
        if pros:
            summary_parts.append(f"Strengths: {pros[0]}")
        if cons:
            summary_parts.append(f"Trade-offs: {cons[0]}")
        candidate_summary = " | ".join(summary_parts) if summary_parts else "Standard transaction profile."

        tradeoffs.append(
            CandidateTradeoff(
                candidate_id=res.candidate_id,
                summary=candidate_summary,
                pros=pros,
                cons=cons,
            )
        )

    # Cross-candidate comparative summary
    comparison_notes: list[str] = []
    for t in tradeoffs:
        p_str = "; ".join(t.pros) if t.pros else "None"
        c_str = "; ".join(t.cons) if t.cons else "None"
        comparison_notes.append(
            f"Candidate '{t.candidate_id}': [Pros: {p_str}] [Cons: {c_str}]"
        )
    overall_summary = " Comparison:\n" + "\n".join(comparison_notes)

    return ComparisonResult(
        candidate_ids=candidate_ids,
        candidates=candidates_map,
        tradeoffs=tradeoffs,
        summary=overall_summary,
    )
