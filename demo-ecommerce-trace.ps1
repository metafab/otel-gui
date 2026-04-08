#!/usr/bin/env pwsh
# Script to demonstrate incremental trace ingestion on Windows
# This simulates a realistic distributed system where spans arrive at different times

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$host_ = if ($env:OTEL_GUI_HOST) { $env:OTEL_GUI_HOST } else { 'http://localhost:4318' }
$traceUrl = "$host_/traces/7c9e4f8a3b2d1e6f5a4c3b2a1d0e9f8c"

function Send-OtlpJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,

        [Parameter(Mandatory = $true)]
        [string]$JsonFile
    )

    $payload = Get-Content -Path $JsonFile -Raw
    Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json' -Body $payload | Out-Null
}

Write-Host "=== Demo: E-commerce Checkout Trace Demo"
Write-Host ""
Write-Host "This demo shows a checkout transaction across multiple services:"
Write-Host "  - frontend: Web application"
Write-Host "  - backend-api: Core business logic"
Write-Host "  - auth-service: Authentication and authorization"
Write-Host "  - database: PostgreSQL database"
Write-Host ""
Write-Host "Features demonstrated:"
Write-Host "  [OK] Multi-service distributed trace"
Write-Host "  [OK] Trace-correlated logs"
Write-Host "  [OK] Incremental span arrival (realistic behavior)"
Write-Host "  [OK] Parent-child span hierarchy"
Write-Host "  [OK] Error handling (database deadlock with retry)"
Write-Host "  [OK] Collapse/expand functionality"
Write-Host ""

$tracePart1 = Join-Path $scriptDir 'samples/sample-trace-ecommerce-part1.json'
$logPart1 = Join-Path $scriptDir 'samples/sample-log-ecommerce-part1.json'
$tracePart2 = Join-Path $scriptDir 'samples/sample-trace-ecommerce-part2.json'
$logPart2 = Join-Path $scriptDir 'samples/sample-log-ecommerce-part2.json'

Write-Host "Sending initial trace data (frontend + backend-api)..."
try {
    Send-OtlpJson -Uri "$host_/v1/traces" -JsonFile $tracePart1
    Write-Host "Part 1 sent successfully"
}
catch {
    Write-Host "Failed to send part 1"
    Write-Host $_.Exception.Message
    exit 1
}

Write-Host ""
Write-Host "Sending correlated logs for initial spans..."
try {
    Send-OtlpJson -Uri "$host_/v1/logs" -JsonFile $logPart1
    Write-Host "Logs part 1 sent successfully"
}
catch {
    Write-Host "Failed to send logs part 1"
    Write-Host $_.Exception.Message
    exit 1
}

Write-Host ""
Write-Host "Check the UI - you should see the initial spans from frontend and backend-api"
Write-Host "   Trace ID: 7c9e4f8a3b2d1e6f5a4c3b2a1d0e9f8c"
Write-Host "   Tip: open Span Details > Correlated Logs for a span"
Write-Host ""
Read-Host "Press Enter to send remaining spans"

Write-Host ""
Write-Host "Sending delayed trace data (auth-service + database)..."
try {
    Send-OtlpJson -Uri "$host_/v1/traces" -JsonFile $tracePart2
    Write-Host "Part 2 sent successfully"
}
catch {
    Write-Host "Failed to send part 2"
    Write-Host $_.Exception.Message
    exit 1
}

Write-Host ""
Write-Host "Sending correlated logs for delayed spans..."
try {
    Send-OtlpJson -Uri "$host_/v1/logs" -JsonFile $logPart2
    Write-Host "Logs part 2 sent successfully"
}
catch {
    Write-Host "Failed to send logs part 2"
    Write-Host $_.Exception.Message
    exit 1
}

Write-Host ""
Write-Host "Demo complete!"
Write-Host ""
Write-Host "What to explore in the UI:"
Write-Host "  1. Navigate to: $traceUrl"
Write-Host "  2. Notice spans from 4 different services (color-coded)"
Write-Host "  3. Expand/collapse the 'process payment' span to see its children"
Write-Host "  4. Use error navigation buttons to find the database deadlock"
Write-Host "  5. Click on the error span to see retry logic"
Write-Host "  6. Open Correlated Logs in the sidebar and filter by ERROR"
Write-Host "  7. Use keyboard navigation (up/down/left/right Enter) to explore the tree"
Write-Host ""
Write-Host "Trace Structure:"
Write-Host "  POST /checkout (frontend)"
Write-Host "  |-- validate cart (frontend)"
Write-Host "  \-- process payment (backend-api)"
Write-Host "      |-- validate payment details (backend-api)"
Write-Host "      |-- check inventory (backend-api)"
Write-Host "      |-- verify user session (auth-service)"
Write-Host "      |   \-- query user permissions (auth-service)"
Write-Host "      |-- create order record (database)"
Write-Host "      |-- update inventory (database) [ERROR - Deadlock]"
Write-Host "      |   \-- retry inventory update (database) [OK]"
Write-Host "      \-- send confirmation email (backend-api)"
Write-Host ""
