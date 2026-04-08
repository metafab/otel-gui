#!/bin/bash
# Demo: trace reconstruction when the root span arrives last
#
# This simulates a real-world scenario where a distributed trace's root span
# (from the API gateway) is reported after the downstream service spans.
# You will see the UI progressively build the tree until the root arrives.

set -e

HOST="${OTEL_GUI_HOST:-http://localhost:4318}"
TRACE_URL="${HOST}/traces/deadbeef0000000012345678cafebabe"

send() {
  local label="$1"
  local file="$2"
  if curl -s -o /dev/null -w "%{http_code}" \
      -X POST "${HOST}/v1/traces" \
      -H "Content-Type: application/json" \
      -d "@${file}" | grep -q "^2"; then
    echo "  ✅ ${label}"
  else
    echo "  ❌ ${label} — is otel-gui running on ${HOST}?"
    exit 1
  fi
}

clear
echo === Demo: Late Root Span — Progressive Trace Assembly ===
echo ""
echo "Trace ID: deadbeef0000000012345678cafebabe"
echo "Services: payment-gateway · fraud-service · ledger-service · postgres"
echo ""
echo "Final span tree (arrives progressively):"
echo ""
echo "  POST /payment  (payment-gateway)              ← root, arrives LAST"
echo "  ├── validate card  (payment-gateway)"
echo "  ├── fraud check  (fraud-service)"
echo "  │   └── query fraud history  (fraud-service)"
echo "  │       └── SELECT fraud_history  (postgres)"
echo "  ├── debit account  (ledger-service)"
echo "  │   ├── acquire row lock  (ledger-service)"
echo "  │   └── UPDATE accounts SET balance  (postgres)"
echo "  └── send receipt email  (payment-gateway)     ← arrives with root"
echo ""
echo "Open the UI now: ${HOST}"
echo ""

# ── Part 1 ──────────────────────────────────────────────────────────────────
read -r -p "▶  Press Enter to send Part 1 (deep leaves — root missing)..."
echo ""
send "fraud check + query fraud history + SELECT fraud_history + debit account + acquire row lock" \
     "samples/sample-trace-late-root-part1.json"
echo ""
echo "  👀 What you see:"
echo "     • Trace list: tentative name '⏳ fraud check' (tooltip: root span not yet received)"
echo "     • Waterfall: a '(missing)' phantom row sits at the top"
echo "     • Its children are fraud-service and ledger-service subtrees"
echo "     • Sidebar 'Parent ID' shows the missing ID with ⚠️ (tooltip: Parent span not found in this trace)"
echo ""

# ── Part 2 ──────────────────────────────────────────────────────────────────
read -r -p "▶  Press Enter to send Part 2 (validate card + DB write — root still missing)..."
echo ""
send "validate card + UPDATE accounts SET balance" \
     "samples/sample-trace-late-root-part2.json"
echo ""
echo "  👀 What you see:"
echo "     • 'validate card' appears under the same '(missing)' phantom"
echo "     • 'UPDATE accounts SET balance' correctly attaches under 'debit account'"
echo "     • The phantom still has no resolved root"
echo ""

# ── Part 3 ──────────────────────────────────────────────────────────────────
read -r -p "▶  Press Enter to send Part 3 (root span arrives — tree reconstructs)..."
echo ""
send "POST /payment (root) + send receipt email" \
     "samples/sample-trace-late-root-part3.json"
echo ""
echo "  👀 What you see:"
echo "     • '(missing)' phantom disappears"
echo "     • 'POST /payment' becomes the root — all spans re-attach under it"
echo "     • Trace list updates with the real name and service"
echo "     • 'send receipt email' appears as the last child"
echo ""
echo "╔═════════════════════════════════════════════════════════════════╗"
echo "║  Demo complete! Full trace at:                                  ║"
echo "║  ${TRACE_URL}  ║"
echo "╚═════════════════════════════════════════════════════════════════╝"
echo ""
