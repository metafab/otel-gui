#!/bin/bash
# Script to demonstrate OTLP metrics ingestion with staged samples

HOST="${OTEL_GUI_HOST:-http://localhost:4318}"
METRICS_URL="${HOST}/metrics"

send_metrics() {
  local file="$1"
  local label="$2"

  echo "Sending ${label}..."
  curl -X POST "$HOST/v1/metrics" \
    -H "Content-Type: application/json" \
    -d "@${file}" \
    -s -o /dev/null

  if [ $? -eq 0 ]; then
    echo "Sent: ${label}"
  else
    echo "Failed: ${label}"
    exit 1
  fi
}

echo "=== Demo: OTLP Metrics Samples ==="
echo ""
echo "This demo sends three metrics payloads:"
echo "  - Gauge: process.runtime.memory.usage"
echo "  - Sum/Counter: http.server.request.count"
echo "  - Histogram: db.client.operation.duration"
echo ""

send_metrics "samples/sample-metrics-gauge.json" "Gauge sample"

echo ""
echo "Open metrics UI: ${METRICS_URL}"
read -r -p "Press Enter to send the Sum/Counter sample..."

echo ""
send_metrics "samples/sample-metrics-sum-counter.json" "Sum/Counter sample"

read -r -p "Press Enter to send the Histogram sample..."

echo ""
send_metrics "samples/sample-metrics-histogram.json" "Histogram sample"

echo ""
echo "Demo complete."
echo ""
echo "What to explore:"
echo "  1. Open ${METRICS_URL}"
echo "  2. Filter metrics by name and service"
echo "  3. Open a Sum metric and inspect computed rate"
echo "  4. Open a Histogram metric and inspect bucket distribution"
