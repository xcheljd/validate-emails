#!/bin/bash
FAIL=0

if [ ! -f "src/components/validation/validation-dashboard.tsx" ]; then
    echo "ValidationDashboard component missing."
    FAIL=1
fi

if ! grep -q "ValidationDashboard" src/App.tsx; then
    echo "ValidationDashboard not integrated into App.tsx"
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "Dashboard component verification passed."
    exit 0
else
    echo "Dashboard component verification failed."
    exit 1
fi
