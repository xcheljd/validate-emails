#!/bin/bash
# Mission initialization script for ValidateEmails proxy feature
# This script is idempotent - safe to run multiple times

set -e

echo "Initializing ValidateEmails mission..."

# Check Node.js dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install
else
    echo "Node.js dependencies already installed"
fi

# Check Rust dependencies
if [ ! -d "src-tauri/target" ]; then
    echo "Building Rust dependencies..."
    cargo check --manifest-path src-tauri/Cargo.toml
else
    echo "Rust dependencies already built"
fi

# Verify TypeScript compiles
echo "Verifying TypeScript..."
npm run typecheck || echo "TypeScript check completed with warnings"

echo "Initialization complete!"
