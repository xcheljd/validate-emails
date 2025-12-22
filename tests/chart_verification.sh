#!/bin/bash
if grep -q "PieChart" src/components/validation/validation-dashboard.tsx; then
    echo "PieChart integrated into Dashboard."
    exit 0
else
    echo "PieChart missing in Dashboard."
    exit 1
fi
