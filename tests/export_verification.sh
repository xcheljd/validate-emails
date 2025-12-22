#!/bin/bash
if grep -q "handleExport" src/App.tsx; then
    echo "Export logic integrated into App.tsx"
    exit 0
else
    echo "Export logic missing in App.tsx"
    exit 1
fi
