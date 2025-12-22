#!/bin/bash
FAIL=0

if [ ! -f "src/components/validation/email-input.tsx" ]; then
    echo "EmailInput component missing."
    FAIL=1
fi

if ! grep -q "EmailInput" src/App.tsx; then
    echo "EmailInput not integrated into App.tsx"
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "Input component verification passed."
    exit 0
else
    echo "Input component verification failed."
    exit 1
fi
