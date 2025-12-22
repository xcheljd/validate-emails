#!/bin/bash
FAIL=0

if [ ! -f "tailwind.config.js" ] && [ ! -f "tailwind.config.ts" ]; then
    echo "Tailwind config missing."
    FAIL=1
fi

if [ ! -f "postcss.config.js" ] && [ ! -f "postcss.config.ts" ]; then
    echo "PostCSS config missing."
    FAIL=1
fi

if [ ! -f "components.json" ]; then
    echo "Shadcn components.json missing."
    FAIL=1
fi

if [ $FAIL -eq 0 ]; then
    echo "UI Configuration verification passed."
    exit 0
else
    echo "UI Configuration verification failed."
    exit 1
fi
