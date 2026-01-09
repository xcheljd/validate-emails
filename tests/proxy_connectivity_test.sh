#!/bin/bash

# Helper script to run live proxy connectivity checks.
# This runs the Rust tests that are marked as #[ignore] by default.

echo "🚀 Starting Live Proxy Connectivity Checks..."
echo "============================================"

cd src-tauri

# Run the specific ignored test. 
# Note: You may need to edit src-tauri/src/tests/proxy_integration.rs 
# to provide a working proxy if you haven't already.

cargo test -- --ignored tests::proxy_integration::test_live_proxy_connectivity_check --nocapture

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Live connectivity check passed!"
else
    echo ""
    echo "❌ Live connectivity check failed or was not configured."
    echo "💡 Make sure to provide a valid proxy string in 'src-tauri/src/tests/proxy_integration.rs'."
fi
