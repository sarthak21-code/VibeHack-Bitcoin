# Pre-Signing Bitcoin Privacy Planner (VibeHack)

**Team:** VibeHack  
**Track:** Cypherpunk  
**Hackathon:** BOSS Battle 2026 Bitcoin OSS Hackathon  

---

## 1. Overview & Architecture

> **Core Idea:** Before a Bitcoin transaction is signed, generate multiple valid transaction candidates and show the user the privacy, linkability, fee, and future-wallet trade-offs between them.

```text
Wallet UTXOs
      ↓
Candidate Generator
      ↓
Multiple transaction candidates
      ↓
BDK builds valid PSBTs
      ↓
Privacy Engine (Member 2)
      ↓
Structured privacy findings
      ↓
Candidate comparison
      ↓
User chooses PSBT
      ↓
User signs externally
```

### Separation of Responsibilities

* **BDK / Member 1:** Bitcoin correctness, PSBT construction, UTXOs, inputs, outputs, fee estimation, change script derivation, and serialization.
* **Privacy Engine / Member 2:** Privacy semantics, cluster metadata analysis, common-input heuristic evaluation, likely change detection, address reuse checks, rare/important UTXO preservation, and future optionality trade-offs.

---

## 2. Privacy Concepts & Heuristics

The privacy engine evaluates candidate transactions using deterministic heuristic rules and wallet-side metadata.

### 2.1 Common-Input Ownership Heuristic
* **What it means:** When a Bitcoin transaction spends multiple inputs together, external blockchain observers and chain surveillance algorithms typically infer that all consumed inputs are controlled by the same economic entity.
* **Engine behavior:** If `input_count > 1`, the engine flags `multiple_inputs: true` with a heuristic finding. If `input_count == 1`, the engine notes that the transaction avoids the common-input heuristic.
* **Important distinction:** This is an observer inference and heuristic rule of thumb, **not cryptographic proof** of shared ownership (e.g. PayJoin or CoinJoin transactions deliberately violate this assumption).

### 2.2 Wallet-Side Metadata Clusters
* **What it means:** A cluster represents a logical grouping of UTXOs established by the user's wallet sidecar metadata (e.g., "KYC Exchange", "P2P", "Donations", "Mining").
* **Engine behavior:** If a candidate transaction co-spends UTXOs from distinct clusters (e.g. Cluster Alpha + Cluster Beta), the engine flags `clusters_merged: true`. Co-spending them on-chain reveals that both clusters are linked under the same wallet.
* **Important distinction:** Clusters are **assumed groupings based on available wallet metadata**, not objective on-chain identities.

### 2.3 Likely Change Output Detection
* **What it means:** When the total input amount exceeds the requested payment plus the miner fee (`inputs - payment - fee > 0`), the surplus is returned to a wallet-controlled change address.
* **Engine behavior:** The engine calculates the change amount, flags `change_created: true/false`, and identifies whether the transaction creates a recognizable change output.
* **Important distinction:** Observers identify change using heuristics (e.g. round payment values, address script matching, output order). The engine refers to this as **likely change** rather than asserting certainty unless explicitly marked by wallet metadata.

### 2.4 Address Reuse
* **What it means:** Receiving bitcoin to an address that has already appeared on the blockchain links all past and future transactions involving that address.
* **Engine behavior:** The engine inspects output addresses against known address history.
* **Strict metadata rule:** If address history is unavailable (`known_used_addresses is None`), the engine returns `address_reuse_detected: null` with reason `"insufficient metadata"`. The engine **never silently assumes false**.

### 2.5 Rare / Important UTXO Preservation & Future Optionality
* **What it means:** Spending decisions today affect what options the wallet has tomorrow. Consuming a rare, large-denomination reserve or specially tagged coin reduces future spending optionality.
* **Engine behavior:** Evaluates whether consumed inputs carry `rare: true` or `label: "important"`, calculates remaining wallet UTXOs, and detects if a distinct cluster is completely exhausted.
* **No arbitrary scores:** The engine does not assign arbitrary 0-100 numerical scores. It provides deterministic, structured facts and trade-offs.

### 2.6 Limitations of Heuristic Analysis
* Heuristics are based on observed patterns on the public blockchain and available local metadata.
* They do not constitute cryptographic certainty.
* The presence of a change output or multiple inputs does not guarantee deanonymization, but it increases the attack surface for chain analysis.

---

## 3. Integration Contract (For Member 1)

The Privacy Engine is completely decoupled from Bitcoin network access and BDK dependencies. Member 1 can pass raw Python dictionaries or dataclass objects.

### 3.1 Input Formats

#### Candidate Transaction Schema:
```python
candidate_a = {
    "candidate_id": "A",
    "inputs": [
        {"outpoint": "txid1:0", "amount_sats": 4200},
        {"outpoint": "txid2:0", "amount_sats": 391},
    ],
    "outputs": [
        {"address": "tb1qrecipient...", "amount_sats": 3500, "is_wallet_controlled": False},
        {"address": "tb1qchange...", "amount_sats": 891, "is_wallet_controlled": True},
    ],
    "fee_sats": 200,
    "recipient_amount_sats": 3500,
}
```

#### UTXO Sidecar Metadata Schema:
```python
utxo_metadata = {
    "txid1:0": {"cluster": "A", "label": "clean", "rare": False},
    "txid2:0": {"cluster": "A", "label": "clean", "rare": False},
    "txid3:0": {"cluster": "B", "label": "reserve", "rare": True},
}
```

### 3.2 Integration Code Example

```python
from privacy_engine import analyze_candidate, compare_candidates

# 1. Analyze single candidates
analysis_a = analyze_candidate(
    candidate=candidate_a,
    utxo_metadata=utxo_metadata,
    known_used_addresses=None,  # Or set of known addresses
)

analysis_b = analyze_candidate(
    candidate=candidate_b,
    utxo_metadata=utxo_metadata,
)

# 2. Compare candidates side-by-side
comparison = compare_candidates([analysis_a, analysis_b])

# 3. Access structured results (or JSON export)
print(comparison.summary)
result_json = comparison.to_dict()
```

### 3.3 Output Structure Example

```json
{
  "candidate_id": "A",
  "transaction": {
    "input_count": 2,
    "output_count": 2,
    "inputs_total_sats": 4591,
    "payment_sats": 3500,
    "fee_sats": 200,
    "change_sats": 891,
    "change_created": true
  },
  "privacy": {
    "clusters_used": ["A"],
    "clusters_count": 1,
    "clusters_merged": false,
    "multiple_inputs": true,
    "address_reuse_detected": null,
    "address_reuse_type": null,
    "address_reuse_reason": "insufficient metadata"
  },
  "future_optionality": {
    "rare_utxo_consumed": false,
    "unique_cluster_consumed": false,
    "remaining_utxo_count": null,
    "warning": null
  },
  "findings": [
    {
      "type": "common_input_heuristic",
      "severity": "info",
      "message": "Common-input ownership heuristic may link these 2 inputs..."
    },
    {
      "type": "cluster_isolated",
      "severity": "info",
      "message": "All clustered inputs belong to the single wallet-side metadata cluster 'A'. No cluster merge detected."
    },
    {
      "type": "likely_change",
      "severity": "info",
      "message": "Transaction creates a likely change output of 891 sats..."
    }
  ]
}
```

---

## 4. Running Tests

The test suite uses Python's built-in `unittest` framework:

```powershell
.\.venv\Scripts\python -m unittest discover -s backend/privacy_engine/tests -p "test_*.py" -v
```
