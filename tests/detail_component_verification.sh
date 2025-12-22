#!/bin/bash
FAIL=0

if [ ! -f "src/components/validation/result-details.tsx" ]; then
    echo "ResultDetails component missing."
    FAIL=1
fi

if ! grep -q "ResultDetails" src/App.tsx; then
    echo "ResultDetails not integrated into App.tsx"
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "Detail component verification passed."
    exit 0
else
    echo "Detail component verification failed."
    exit 1
fi
