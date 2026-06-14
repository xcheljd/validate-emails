use std::env;
use std::fs;
use std::path::Path;

fn main() {
    // Generate capability file based on e2e-testing feature
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let capabilities_dir = Path::new(&manifest_dir).join("capabilities");

    // Check if e2e-testing feature is enabled
    let e2e_testing = env::var("CARGO_FEATURE_E2E_TESTING").is_ok();

    let mut permissions = vec!["core:default", "opener:default"];
    if e2e_testing {
        permissions.push("playwright:default");
    }

    let permissions_json: Vec<String> = permissions.iter().map(|p| format!("    \"{}\"", p)).collect();
    let default_capability = format!(
        r#"{{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
{}
  ]
}}"#,
        permissions_json.join(",\n")
    );

    let capability_path = capabilities_dir.join("default.json");
    let new_content = format!("{}\n", default_capability);
    // Only write if content differs to avoid triggering file watchers unnecessarily
    let should_write = fs::read_to_string(&capability_path)
        .map(|existing| existing != new_content)
        .unwrap_or(true);
    if should_write {
        fs::write(&capability_path, new_content).unwrap();
    }

    tauri_build::build()
}

