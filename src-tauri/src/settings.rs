// Settings module: proxy configuration, pool management, and Tauri commands.
// Previously a single 4,217-line file, now split into focused submodules.

#[path = "settings_mod/proxy_config.rs"]
pub mod proxy_config;

#[path = "settings_mod/proxy_pool.rs"]
pub mod proxy_pool;

#[path = "settings_mod/settings_core.rs"]
pub mod settings_core;

#[path = "settings_mod/settings_commands.rs"]
pub mod settings_commands;

pub use proxy_config::ProxyConfig;
pub use proxy_pool::FailedProxyInfo;
pub use settings_core::{RateLimiterConfig, SettingsState};
pub use settings_commands::*;

#[cfg(test)]
pub use proxy_pool::ProxyPool;

#[cfg(test)]
pub use proxy_config::RotationMode;
#[cfg(test)]
pub use proxy_pool::{ProxyStats, AutoDisableThreshold, AllProxiesFailedState, HealthStatus};
#[cfg(test)]
pub use settings_core::{Settings, load_settings_file};
#[cfg(test)]
pub(crate) use settings_core::load_settings_file_at;

#[cfg(test)]
#[path = "settings_mod/settings_tests.rs"]
mod settings_tests;
