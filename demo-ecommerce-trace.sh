#!/bin/bash
# Script to demonstrate incremental trace ingestion
# This simulates a realistic distributed system where spans arrive at different times

echo "=== E-commerce Checkout Trace Demo ==="
echo ""
echo "This demo shows a checkout transaction across multiple services:"
echo "  - frontend: Web application"
echo "  - backend-api: Core business logic"
echo "  - auth-service: Authentication and authorization"
echo "  - database: PostgreSQL database"
echo ""
echo "Features demonstrated:"
echo "  ✓ Multi-service distributed trace"
echo "  ✓ Incremental span arrival (realistic behavior)"
echo "  ✓ Parent-child span hierarchy"
echo "  ✓ Error handling (database deadlock with retry)"
echo "  ✓ Collapse/expand functionality"
echo ""

# Send first batch of spans
echo "📤 Sending initial trace data (frontend + backend-api)..."
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @samples/sample-trace-ecommerce-part1.json \
  -s -o /dev/null

if [ $? -eq 0 ]; then
  echo "✅ Part 1 sent successfully"
else
  echo "❌ Failed to send part 1"
  exit 1
fi

echo ""
echo "🔍 Check the UI - you should see the initial spans from frontend and backend-api"
echo "   Trace ID: 7c9e4f8a3b2d1e6f5a4c3b2a1d0e9f8c"
echo ""
read -r -p "⏳ Press Enter to send remaining spans..."

# Send second batch of spans (simulating delayed arrival)
echo ""
echo "📤 Sending delayed trace data (auth-service + database)..."
curl -X POST http://localhost:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d @samples/sample-trace-ecommerce-part2.json \
  -s -o /dev/null

if [ $? -eq 0 ]; then
  echo "✅ Part 2 sent successfully"
else
  echo "❌ Failed to send part 2"
  exit 1
fi

echo ""
echo "✨ Demo complete!"
echo ""
echo "🎯 What to explore in the UI:"
echo "  1. Navigate to: http://localhost:5173/trace/7c9e4f8a3b2d1e6f5a4c3b2a1d0e9f8c"
echo "  2. Notice spans from 4 different services (color-coded)"
echo "  3. Expand/collapse the 'process payment' span to see its children"
echo "  4. Use error navigation buttons to find the database deadlock"
echo "  5. Click on the error span to see retry logic"
echo "  6. Use keyboard navigation (↑↓←→ Enter) to explore the tree"
echo ""
echo "📊 Trace Structure:"
echo "  POST /checkout (frontend)"
echo "  ├── validate cart (frontend)"
echo "  └── process payment (backend-api)"
echo "      ├── validate payment details (backend-api)"
echo "      ├── check inventory (backend-api)"
echo "      ├── verify user session (auth-service)"
echo "      │   └── query user permissions (auth-service)"
echo "      ├── create order record (database)"
echo "      ├── update inventory (database) ⚠️ ERROR - Deadlock"
echo "      │   └── retry inventory update (database) ✓"
echo "      └── send confirmation email (backend-api)"
echo ""
