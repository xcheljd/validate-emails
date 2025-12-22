#!/bin/bash
if [ -d "src-tauri" ] && [ -d "src" ] && [ -f "package.json" ]; then
    echo "Tauri project structure verification passed."
    exit 0
else
    echo "Tauri project structure verification failed."
    exit 1
fi
