#!/bin/bash
# load-test.sh — hammers POST /notes to generate CPU load for the HPA demo.
# Usage: ./load-test.sh <nodePort>
#
# In a second terminal, watch pods scale up:
#   kubectl get pods -w
#   kubectl get hpa -w

PORT=${1:-30000}
URL="http://localhost:$PORT/notes"
CONCURRENCY=20
DURATION=120  # seconds

echo "Targeting: $URL"
echo "Duration:  ${DURATION}s"
echo "Workers:   $CONCURRENCY concurrent requests"
echo ""
echo "In another terminal run:"
echo "  kubectl get pods -w"
echo "  kubectl get hpa -w"
echo ""
echo "Starting in 3 seconds... (Ctrl+C to stop early)"
sleep 3

end=$((SECONDS + DURATION))

while [ $SECONDS -lt $end ]; do
    for i in $(seq 1 $CONCURRENCY); do
        curl -s -X POST "$URL" \
            -H "Content-Type: application/json" \
            -d "{\"title\":\"load-$RANDOM\",\"content\":\"generated at $(date +%s)\"}" > /dev/null &
    done
    wait
    echo "$(date '+%H:%M:%S') — batch sent (${SECONDS}s / ${DURATION}s elapsed)"
done

echo ""
echo "Load test complete. Watch pods scale back down over the next few minutes."