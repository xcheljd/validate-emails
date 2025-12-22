#!/bin/bash
FAIL=0

if [ ! -f "src/components/validation/results-table.tsx" ]; then
    echo "ResultsTable component missing."
    FAIL=1
fi

if ! grep -q "ResultsTable" src/App.tsx; then
    echo "ResultsTable not integrated into App.tsx"
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "Results table verification passed."
    exit 0
else
    echo "Results table verification failed."
    exit 1
fi
