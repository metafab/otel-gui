#!/usr/bin/env pwsh
# Script to demonstrate OTLP metrics ingestion with staged samples on Windows

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$host_ = if ($env:OTEL_GUI_HOST) { $env:OTEL_GUI_HOST } else { 'http://localhost:4318' }
$metricsUrl = "$host_/metrics"

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

function Send-MetricSample {
    param(
        [Parameter(Mandatory = $true)]
        [string]$File,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    Write-Host "Sending $Label..."
    try {
        Send-OtlpJson -Uri "$host_/v1/metrics" -JsonFile $File
        Write-Host "Sent: $Label"
    }
    catch {
        Write-Host "Failed: $Label"
        Write-Host $_.Exception.Message
        exit 1
    }
}

$gaugeFile = Join-Path $scriptDir 'samples/sample-metrics-gauge.json'
$sumFile = Join-Path $scriptDir 'samples/sample-metrics-sum-counter.json'
$histFile = Join-Path $scriptDir 'samples/sample-metrics-histogram.json'

Write-Host "=== Demo: OTLP Metrics Samples ==="
Write-Host ""
Write-Host "This demo sends three metrics payloads:"
Write-Host "  - Gauge: process.runtime.memory.usage"
Write-Host "  - Sum/Counter: http.server.request.count"
Write-Host "  - Histogram: db.client.operation.duration"
Write-Host ""

Send-MetricSample -File $gaugeFile -Label 'Gauge sample'

Write-Host ""
Write-Host "Open metrics UI: $metricsUrl"
Read-Host 'Press Enter to send the Sum/Counter sample'

Write-Host ""
Send-MetricSample -File $sumFile -Label 'Sum/Counter sample'

Read-Host 'Press Enter to send the Histogram sample'

Write-Host ""
Send-MetricSample -File $histFile -Label 'Histogram sample'

Write-Host ""
Write-Host "Demo complete."
Write-Host ""
Write-Host "What to explore:"
Write-Host "  1. Open $metricsUrl"
Write-Host "  2. Filter metrics by name and service"
Write-Host "  3. Open a Sum metric and inspect computed rate"
Write-Host "  4. Open a Histogram metric and inspect bucket distribution"
