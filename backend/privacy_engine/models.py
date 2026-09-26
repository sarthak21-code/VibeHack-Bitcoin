"""
Data models for Pre-Signing Bitcoin Privacy Planner (Privacy & Analysis Engine).

Defines structured inputs, transaction properties, privacy analysis findings,
and candidate comparison schemas. All models are standard library dataclasses
compatible with Python 3.13+.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class CandidateInput:
    """Represents a selected UTXO input for a candidate transaction."""

    outpoint: str
    amount_sats: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CandidateInput:
        return cls(
            outpoint=str(data["outpoint"]),
            amount_sats=int(data["amount_sats"]),
        )


@dataclass
class CandidateOutput:
    """Represents an output of a candidate transaction."""

    amount_sats: int
    address: Optional[str] = None
    is_wallet_controlled: Optional[bool] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CandidateOutput:
        return cls(
            amount_sats=int(data["amount_sats"]),
            address=data.get("address"),
            is_wallet_controlled=data.get("is_wallet_controlled"),
        )


@dataclass
class UTXOMetadata:
    """Sidecar wallet metadata associated with an unspent transaction output."""

    cluster: Optional[str] = None
    label: Optional[str] = None
    rare: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UTXOMetadata:
        return cls(
            cluster=data.get("cluster"),
            label=data.get("label"),
            rare=bool(data.get("rare", False)),
        )


@dataclass
class CandidateTransaction:
    """Structured representation of a candidate transaction before signing."""

    candidate_id: str
    inputs: list[CandidateInput]
    outputs: list[CandidateOutput]
    fee_sats: int
    recipient_amount_sats: Optional[int] = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CandidateTransaction:
        inputs = [
            CandidateInput.from_dict(inp) if isinstance(inp, dict) else inp
            for inp in data.get("inputs", [])
        ]
        outputs = [
            CandidateOutput.from_dict(out) if isinstance(out, dict) else out
            for out in data.get("outputs", [])
        ]
        return cls(
            candidate_id=str(data.get("candidate_id", "unnamed")),
            inputs=inputs,
            outputs=outputs,
            fee_sats=int(data.get("fee_sats", 0)),
            recipient_amount_sats=(
                int(data["recipient_amount_sats"])
                if "recipient_amount_sats" in data
                else None
            ),
        )


@dataclass
class Finding:
    """A discrete observation, warning, or informative privacy finding."""

    type: str
    severity: str  # "info", "warning", "critical"
    message: str
    details: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "type": self.type,
            "severity": self.severity,
            "message": self.message,
        }
        if self.details:
            result["details"] = self.details
        return result


@dataclass
class TransactionAnalysis:
    """Basic balance and structural properties of the candidate transaction."""

    input_count: int
    output_count: int
    inputs_total_sats: int
    payment_sats: int
    fee_sats: int
    change_sats: int
    change_created: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PrivacyAnalysis:
    """Privacy-specific heuristic findings and cluster evaluations."""

    clusters_used: list[str]
    clusters_count: int
    clusters_merged: bool
    multiple_inputs: bool
    address_reuse_detected: Optional[bool] = None
    address_reuse_type: Optional[str] = None
    address_reuse_reason: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class FutureOptionalityAnalysis:
    """Assessment of future wallet optionality and preserved UTXOs."""

    rare_utxo_consumed: bool
    unique_cluster_consumed: bool = False
    remaining_utxo_count: Optional[int] = None
    warning: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CandidateAnalysisResult:
    """Complete structured analysis of a single candidate transaction."""

    candidate_id: str
    transaction: TransactionAnalysis
    privacy: PrivacyAnalysis
    future_optionality: FutureOptionalityAnalysis
    findings: list[Finding] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "transaction": self.transaction.to_dict(),
            "privacy": self.privacy.to_dict(),
            "future_optionality": self.future_optionality.to_dict(),
            "findings": [f.to_dict() for f in self.findings],
        }


@dataclass
class CandidateTradeoff:
    """Summary of privacy and wallet tradeoffs for one candidate."""

    candidate_id: str
    summary: str
    pros: list[str] = field(default_factory=list)
    cons: list[str] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ComparisonResult:
    """Comparative analysis across multiple transaction candidates."""

    candidate_ids: list[str]
    candidates: dict[str, CandidateAnalysisResult]
    tradeoffs: list[CandidateTradeoff]
    summary: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate_ids": self.candidate_ids,
            "candidates": {
                cid: res.to_dict() for cid, res in self.candidates.items()
            },
            "tradeoffs": [t.to_dict() for t in self.tradeoffs],
            "summary": self.summary,
        }
