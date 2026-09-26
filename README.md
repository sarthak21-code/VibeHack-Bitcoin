# CoinLens — Pre-Signing Bitcoin Privacy Planner

> **Don't just create a Bitcoin transaction. Compare it first.**

CoinLens is a pre-signing Bitcoin transaction planner that generates multiple valid transaction candidates for the same payment, analyzes their privacy-relevant trade-offs, and lets the user choose which PSBT to export and sign externally.

The key idea is simple:

> **The transaction is not the only decision. Coin selection is a privacy decision too.**

---

## What CoinLens Does

A typical Bitcoin wallet selects UTXOs and builds a transaction.

CoinLens exposes that decision **before signing**.

```text
Wallet / Descriptor
       ↓
UTXO Discovery
       ↓
Candidate Generator
       ↓
Multiple Transaction Candidates
       ↓
BDK Transaction Construction
       ↓
PSBT Analyzer
       ↓
Privacy Engine
       ↓
Candidate Comparison
       ↓
User chooses
       ↓
PSBT Export / External Signing

Instead of forcing the user to accept one transaction construction, CoinLens presents multiple valid alternatives and explains how their structure differs.

Why This Matters

Bitcoin transactions reveal information through their structure.

For example, spending multiple inputs together may allow observers to apply the common-input ownership heuristic.

Choosing a particular UTXO can also affect:

transaction fees
change
wallet-side clusters
rare or important UTXOs
future spending options

CoinLens makes these decisions visible before the transaction is signed.

The goal is deliberately not to produce a single universal "privacy score."

Instead, CoinLens exposes structured observations and trade-offs so the user can make the final decision.

Core Features
1. Multiple Transaction Candidates

CoinLens can generate multiple candidate constructions for the same payment.

Current candidate strategies include:

Largest First
Smallest Single UTXO
Two-UTXO Pair
Single-Cluster Only

The candidate engine is designed so additional selection strategies can be added without changing the core privacy-analysis layer.

2. Descriptor-Based Wallet Connection

CoinLens supports connecting a wallet using a Bitcoin descriptor.

The descriptor is used to create/load a wallet-specific state and discover UTXOs on Bitcoin Signet.

Descriptor
    ↓
Wallet Connection
    ↓
Signet Synchronization
    ↓
UTXO Discovery
    ↓
Candidate Planning

Wallet-specific state is separated from the transaction-planning logic.

The current prototype is intentionally limited to Bitcoin Signet.

3. Bitcoin Transaction Construction

Transactions are constructed using the Bitcoin Development Kit (BDK).

BDK handles Bitcoin transaction and PSBT construction while CoinLens controls candidate UTXO selection.

This keeps Bitcoin transaction correctness separate from the privacy-analysis layer.

4. PSBT Analysis

The PSBT analyzer extracts transaction-level facts including:

transaction inputs
input amounts
outputs
output amounts
wallet-controlled outputs
recipient amount
transaction fee
transaction size information

These structured facts are passed to the privacy engine.

5. Privacy Analysis

The privacy engine analyzes privacy-relevant transaction properties such as:

common-input ownership heuristic
wallet-side cluster relationships
likely change
address reuse when sufficient metadata exists
rare or important UTXO consumption
future wallet optionality

The system distinguishes between:

observable transaction facts
wallet-side metadata
heuristics
incomplete information

These findings are not absolute privacy guarantees.

6. UTXO Labels and Metadata

CoinLens supports wallet-side UTXO metadata such as:

labels
clusters
rare / important UTXOs

This metadata can be used by the privacy engine when comparing candidates.

Example:

UTXO
0.004 BTC

Label: Savings
Cluster: Personal
Rare: Yes

The purpose is to allow wallet-specific knowledge to influence candidate comparison.

Cluster metadata should not be interpreted as objectively proven ownership identity on the blockchain.

7. Future Wallet Optionality

A transaction should not only be evaluated by what happens immediately.

CoinLens can identify when a candidate consumes a rare or important UTXO and expose the possible impact on future wallet spending.

For example:

Candidate A
✓ Preserves tagged reserve UTXO

Candidate B
⚠ Consumes tagged reserve UTXO

This makes the user consider both the current transaction and the future state of the wallet.

8. What-If Simulation

CoinLens supports transaction what-if scenarios.

Users can explore how candidate construction changes when constraints such as:

excluded UTXOs
payment amount
fee rate
maximum input count

are changed.

This allows the user to explore transaction decisions before committing to a candidate.

9. Candidate Graph Visualization

CoinLens includes a visual representation of candidate inputs and their wallet-side relationships.

The graph helps make concepts such as:

UTXO grouping
clusters
selected inputs
candidate differences

easier to understand without requiring the user to know Bitcoin privacy terminology.

10. Side-by-Side Candidate Comparison

Candidates are compared using structured findings rather than an arbitrary universal privacy score.

The user can compare:

number of inputs
input amount
fee
change
privacy observations
wallet-side clusters
important UTXO consumption
future optionality

The final choice remains with the user.

11. PSBT Export

After comparing candidates, the user can choose a candidate and export its unsigned PSBT.

The PSBT can then be taken to an external signing environment.

The signing boundary is intentionally kept separate from the planning and analysis layers.

Example

Suppose the user wants to send:

3,500 sats

CoinLens can construct different valid candidates for the same payment.

Candidate A — Largest First
Inputs:       multiple
Fee:          candidate-dependent
Change:       candidate-dependent

Privacy observations may include:

- Multiple inputs
- Common-input ownership heuristic applies
- Wallet-side cluster information
- Future UTXO consequences
Candidate B — Smallest Single UTXO
Inputs:       1
Fee:          candidate-dependent
Change:       candidate-dependent

Privacy observations may include:

- Single-input construction
- Reduced input linkage
- Potential consumption of an important UTXO
Candidate C — Two-UTXO Pair
Inputs:       2
Fee:          candidate-dependent
Change:       candidate-dependent
Candidate D — Single-Cluster Only
Inputs:
Selected from one wallet-side cluster

Privacy objective:
Avoid unnecessary cross-cluster input merging

The important point is that the user can see the trade-offs before signing.

Architecture
Design Principle

CoinLens separates two responsibilities.

Bitcoin correctness
UTXO selection
transaction construction
fee calculation
PSBT generation
transaction structure
Privacy semantics
common-input analysis
cluster heuristics
change analysis
address reuse analysis
rare UTXO analysis
future optionality

This separation makes the system easier to test and extend.

Technology Stack
Backend
Python 3.13
FastAPI
Uvicorn
BDK Python (bdkpython)
SQLite
Frontend
React
Vite
JavaScript
CSS
Lucide React
Bitcoin
Bitcoin Development Kit (BDK)
Bitcoin Signet
PSBT / BIP174 workflow
Repository Structure
VibeHack-Bitcoin/
│
├── backend/
│   ├── api.py
│   ├── planner.py
│   ├── utxo_labels.py
│   │
│   ├── bitcoin/
│   │   ├── psbt_analyzer.py
│   │   └── ...
│   │
│   ├── candidate_engine/
│   │   └── selector.py
│   │
│   └── privacy_engine/
│       ├── models.py
│       ├── cluster.py
│       ├── change.py
│       ├── optionality.py
│       ├── analyzer.py
│       └── tests/
│
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── App.css
│       └── ...
│
├── .gitignore
├── LICENSE
└── README.md
Running the Backend

From the project root:

python -m venv .venv

Activate:

.\.venv\Scripts\activate

Install dependencies:

pip install bdkpython fastapi uvicorn

Start the API:

python -m uvicorn backend.api:app --reload --port 8000

Backend:

http://127.0.0.1:8000

Interactive API documentation:

http://127.0.0.1:8000/docs
Running the Frontend

Open another terminal:

cd frontend

Install dependencies:

npm install

Start:

npm run dev

The Vite development server will display the frontend URL.

The frontend communicates with the FastAPI backend on port 8000.

Bitcoin Network

CoinLens currently uses Bitcoin Signet for development and demonstration.

Signet allows the project to work with real Bitcoin transaction and PSBT structures without using mainnet funds.

The current prototype does not use Bitcoin mainnet for transaction operations.

API
GET /health

Returns the service status.

Example:

{
  "status": "ok",
  "service": "coinlens-planner"
}
POST /plan

Creates and compares transaction candidates for a requested payment.

Example:

{
  "destination": "tb1p...",
  "amount_sats": 3500,
  "fee_rate_sat_vb": 1
}

The response contains candidate analysis, privacy findings, future optionality information, comparisons, and PSBT data.

POST /what-if

Runs a candidate simulation with additional constraints.

Supported inputs include:

destination
amount
fee rate
excluded UTXOs
maximum input count
POST /wallet/connect

Connects a wallet using a descriptor and prepares wallet-specific state for Signet planning.

GET /utxos

Returns available wallet UTXOs and associated metadata.

POST /utxos/label

Adds or updates wallet-side UTXO metadata.

POST /utxos/unlabel

Removes wallet-side UTXO metadata.

Privacy Model
Common-Input Ownership Heuristic

Multiple inputs appearing in the same transaction may be interpreted by observers as belonging to the same entity.

CoinLens surfaces this as a heuristic.

It is not proof of ownership.

Clusters

Clusters are currently represented using wallet-side metadata.

They should not be interpreted as objectively proven identities on the blockchain.

The purpose of cluster metadata is to demonstrate how wallet knowledge can affect candidate comparison.

Change

A wallet-controlled output receiving remaining value after payment and fee can be analyzed as a likely change output.

CoinLens avoids claiming certainty when the available information is insufficient.

Address Reuse

Address reuse analysis depends on available address-history metadata.

When sufficient history is unavailable, CoinLens reports insufficient metadata rather than assuming that reuse did not occur.

Future Optionality

A UTXO may be considered rare or important for future spending.

CoinLens can warn when a candidate consumes such a UTXO.

This allows the user to consider not only the current transaction but also the future state of the wallet.

Why There Is No Universal Privacy Score

CoinLens intentionally avoids reducing all privacy considerations to a single number such as:

Privacy = 87/100

Different candidates can have different trade-offs.

For example:

Candidate A

+ preserves a tagged reserve coin
- uses multiple inputs
Candidate B

+ uses a single input
- consumes the tagged reserve coin

There is no single number that can fully represent these trade-offs.

CoinLens exposes the underlying observations and leaves the final decision to the user.

Security and Signing Boundary

CoinLens is primarily a pre-signing planner.

The core workflow is:

Construct
   ↓
Analyze
   ↓
Compare
   ↓
Choose
   ↓
Export
   ↓
External signing

The project is intentionally designed around a separation between transaction planning and private-key signing.

Development and demonstration use Bitcoin Signet.

Testing

The project includes tests covering areas such as:

UTXO selection
PSBT analysis
input/output extraction
fee calculation
wallet ownership
common-input heuristic
cluster analysis
change analysis
address reuse handling
future optionality
candidate comparison

Run the backend tests from the project root:

.\.venv\Scripts\python -m unittest discover -s backend -p "test_*.py" -v
Development Philosophy

CoinLens is designed around:

Transaction Construction
        +
Privacy Analysis
        +
User Decision

AI or natural-language explanations can be added as an interpretation layer over structured findings.

AI should not become the source of truth for:

transaction validity
cryptographic correctness
PSBT correctness
deterministic privacy-analysis calculations
Current Prototype Limitations

The current prototype is intentionally focused on the pre-signing workflow.

Current limitations include:

limited UTXO-selection strategies
wallet-side metadata for cluster relationships
limited address-history information
Signet-based development environment
external signing workflow
no mainnet transaction workflow
no universal privacy score

These limitations are part of the current prototype scope.

Demo Flow
1. Connect / load wallet

2. Enter destination and amount

3. Choose or configure transaction constraints

4. Click "Plan Transaction"

5. CoinLens generates multiple candidates

6. Compare:
   - inputs
   - fees
   - change
   - privacy observations
   - cluster relationships
   - future optionality

7. Inspect candidate graph

8. Choose a candidate

9. Export unsigned PSBT

10. Sign externally
Team
VibeHack
Member 1 — Sarthak Agiwale
Bitcoin / BDK integration
UTXO selection
transaction construction
PSBT generation
PSBT analysis
API integration
frontend
Member 2 — Gauri Bhosale
privacy analysis
cluster heuristics
change analysis
address reuse analysis
future optionality
candidate comparison
privacy-engine testing
Open Source

CoinLens is released as open-source software under the MIT License.

See LICENSE for the full license text.

Core Product Idea

Most transaction tools focus on what happens after a Bitcoin transaction exists.

CoinLens focuses on the decision before signing.

Traditional flow:

Choose transaction
       ↓
Sign
       ↓
Broadcast
       ↓
Analyze

CoinLens:

Payment request
       ↓
Generate candidates
       ↓
Analyze trade-offs
       ↓
Compare
       ↓
Choose
       ↓
Export PSBT
       ↓
Sign externally

Same payment. Different transaction construction. Different trade-offs.

CoinLens turns coin selection from a hidden wallet operation into a visible user decision.




