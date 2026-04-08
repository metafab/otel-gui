#!/usr/bin/env pwsh
# Demo: trace reconstruction when the root span arrives last
#
# This simulates a real-world scenario where a distributed trace's root span
# (from the API gateway) is reported after the downstream service spans.
# You will see the UI progressively build the tree until the root arrives.

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$host_ = if ($env:OTEL_GUI_HOST) { $env:OTEL_GUI_HOST } else { 'http://localhost:4318' }
$traceUrl = "$host_/traces/deadbeef0000000012345678cafebabe"

function Send-Spans {
    param(
        [string]$Label,
        [string]$File
    )

    $path = Join-Path $scriptDir $File
    $payload = Get-Content -Path $path -Raw
    try {
        Invoke-RestMethod -Method Post -Uri "$host_/v1/traces" `
            -ContentType 'application/json' -Body $payload | Out-Null
        Write-Host "  [OK] $Label"
    }
    catch {
        Write-Host "  [FAIL] $Label -- is otel-gui running on $host_?"
        Write-Host "         $($_.Exception.Message)"
        exit 1
    }
}

Clear-Host
Write-Host "=== Demo: Late Root Span -- Progressive Trace Assembly ==="
Write-Host ""
Write-Host "Trace ID: deadbeef0000000012345678cafebabe"
Write-Host "Services: payment-gateway, fraud-service, ledger-service, postgres"
Write-Host ""
Write-Host "Final span tree (arrives progressively):"
Write-Host ""
Write-Host "  POST /payment  (payment-gateway)              <- root, arrives LAST"
Write-Host "  |-- validate card  (payment-gateway)"
Write-Host "  |-- fraud check  (fraud-service)"
Write-Host "  |   \-- query fraud history  (fraud-service)"
Write-Host "  |       \-- SELECT fraud_history  (postgres)"
Write-Host "  |-- debit account  (ledger-service)"
Write-Host "  |   |-- acquire row lock  (ledger-service)"
Write-Host "  |   \-- UPDATE accounts SET balance  (postgres)"
Write-Host "  \-- send receipt email  (payment-gateway)     <- arrives with root"
Write-Host ""
Write-Host "Open the UI now: $host_"
Write-Host ""

# -- Part 1 ------------------------------------------------------------------
Read-Host "Press Enter to send Part 1 (deep leaves -- root missing)"
Write-Host ""
Send-Spans `
    -Label "fraud check + query fraud history + SELECT fraud_history + debit account + acquire row lock" `
    -File "samples/sample-trace-late-root-part1.json"
Write-Host ""
Write-Host "  What you see:"
Write-Host "     - Trace list: tentative name 'fraud check' (tooltip: root span not yet received)"
Write-Host "     - Waterfall: a '(missing)' phantom row sits at the top"
Write-Host "     - Its children are fraud-service and ledger-service subtrees"
Write-Host "     - Sidebar 'Parent ID' shows the missing ID with [!] (tooltip: Parent span not found in this trace)"
Write-Host ""

# -- Part 2 ------------------------------------------------------------------
Read-Host "Press Enter to send Part 2 (validate card + DB write -- root still missing)"
Write-Host ""
Send-Spans `
    -Label "validate card + UPDATE accounts SET balance" `
    -File "samples/sample-trace-late-root-part2.json"
Write-Host ""
Write-Host "  What you see:"
Write-Host "     - 'validate card' appears under the same '(missing)' phantom"
Write-Host "     - 'UPDATE accounts SET balance' correctly attaches under 'debit account'"
Write-Host "     - The phantom still has no resolved root"
Write-Host ""

# -- Part 3 ------------------------------------------------------------------
Read-Host "Press Enter to send Part 3 (root span arrives -- tree reconstructs)"
Write-Host ""
Send-Spans `
    -Label "POST /payment (root) + send receipt email" `
    -File "samples/sample-trace-late-root-part3.json"
Write-Host ""
Write-Host "  What you see:"
Write-Host "     - '(missing)' phantom disappears"
Write-Host "     - 'POST /payment' becomes the root -- all spans re-attach under it"
Write-Host "     - Trace list updates with the real name and service"
Write-Host "     - 'send receipt email' appears as the last child"
Write-Host ""
Write-Host "+-------------------------------------------------------------------+"
Write-Host "|  Demo complete! Full trace at:                                    |"
Write-Host ("|  {0,-65}|" -f $traceUrl)
Write-Host "+-------------------------------------------------------------------+"
Write-Host ""
