#!/bin/bash
FAIL=0

if ! grep -q "Sidebar" src/App.tsx && ! grep -q "MainLayout" src/App.tsx; then
    echo "Sidebar or MainLayout component missing in App.tsx"
    FAIL=1
fi

if ! grep -q "main" src/components/layout/main-layout.tsx; then
    echo "Content area (main tag) missing in main-layout.tsx"
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "Layout verification passed."
    exit 0
else
    echo "Layout verification failed."
    exit 1
fi