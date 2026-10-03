    use super::*;

    // =====================
    // ProxyConfig Tests
    // =====================

    #[test]
    fn test_proxy_config_new() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_with_auth() {
        let proxy = ProxyConfig::with_auth(
            "proxy.example.com".to_string(),
            1080,
            "user".to_string(),
            "pass".to_string(),
        );
        assert_eq!(proxy.host, "proxy.example.com");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, Some("user".to_string()));
        assert_eq!(proxy.password, Some("pass".to_string()));
    }

    #[test]
    fn test_proxy_config_id() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        assert_eq!(proxy.id(), "192.168.1.1:8080");
    }

    #[test]
    fn test_proxy_config_parse_host_port() {
        let proxy = ProxyConfig::parse("192.168.1.1:8080").unwrap();
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_parse_hostname_port() {
        let proxy = ProxyConfig::parse("proxy.example.com:1080").unwrap();
        assert_eq!(proxy.host, "proxy.example.com");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_parse_with_auth() {
        let proxy = ProxyConfig::parse("socks5://user:pass@1.2.3.4:1080").unwrap();
        assert_eq!(proxy.host, "1.2.3.4");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, Some("user".to_string()));
        assert_eq!(proxy.password, Some("pass".to_string()));
    }

    #[test]
    fn test_proxy_config_parse_socks5_without_auth() {
        let proxy = ProxyConfig::parse("socks5://192.168.1.1:8080").unwrap();
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
        assert_eq!(proxy.username, None);
        assert_eq!(proxy.password, None);
    }

    #[test]
    fn test_proxy_config_parse_ipv6() {
        let proxy = ProxyConfig::parse("[::1]:1080").unwrap();
        assert_eq!(proxy.host, "::1");
        assert_eq!(proxy.port, 1080);
    }

    #[test]
    fn test_proxy_config_parse_ipv6_with_auth() {
        let proxy = ProxyConfig::parse("socks5://user:pass@[::1]:1080").unwrap();
        assert_eq!(proxy.host, "::1");
        assert_eq!(proxy.port, 1080);
        assert_eq!(proxy.username, Some("user".to_string()));
        assert_eq!(proxy.password, Some("pass".to_string()));
    }

    #[test]
    fn test_proxy_config_parse_invalid_missing_port() {
        let result = ProxyConfig::parse("192.168.1.1");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("missing port"));
    }

    #[test]
    fn test_proxy_config_parse_invalid_port() {
        let result = ProxyConfig::parse("192.168.1.1:abc");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid port"));
    }

    #[test]
    fn test_proxy_config_parse_port_zero() {
        let result = ProxyConfig::parse("192.168.1.1:0");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Port cannot be 0"));
    }

    #[test]
    fn test_proxy_config_parse_empty_host() {
        let result = ProxyConfig::parse(":8080");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Host cannot be empty"));
    }

    #[test]
    fn test_proxy_config_parse_invalid_auth_format() {
        let result = ProxyConfig::parse("socks5://user@192.168.1.1:8080");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("user:pass"));
    }

    #[test]
    fn test_proxy_config_parse_empty_credentials() {
        let result = ProxyConfig::parse("socks5://:pass@192.168.1.1:8080");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn test_proxy_config_parse_whitespace() {
        let proxy = ProxyConfig::parse("  192.168.1.1:8080  ").unwrap();
        assert_eq!(proxy.host, "192.168.1.1");
        assert_eq!(proxy.port, 8080);
    }

    #[test]
    fn test_proxy_config_validate_valid_ipv4() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        assert!(proxy.validate().is_ok());
    }

    #[test]
    fn test_proxy_config_validate_valid_hostname() {
        let proxy = ProxyConfig::new("proxy.example.com".to_string(), 1080);
        assert!(proxy.validate().is_ok());
    }

    #[test]
    fn test_proxy_config_validate_valid_ipv6() {
        let mut proxy = ProxyConfig::new("::1".to_string(), 1080);
        assert!(proxy.validate().is_ok());

        proxy.host = "2001:db8::1".to_string();
        assert!(proxy.validate().is_ok());
    }

    #[test]
    fn test_proxy_config_validate_empty_host() {
        let proxy = ProxyConfig {
            host: "".to_string(),
            port: 8080,
            username: None,
            password: None,
            timeout_ms: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Host cannot be empty"));
    }

    #[test]
    fn test_proxy_config_validate_port_zero() {
        let proxy = ProxyConfig {
            host: "192.168.1.1".to_string(),
            port: 0,
            username: None,
            password: None,
            timeout_ms: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Port cannot be 0"));
    }

    #[test]
    fn test_proxy_config_validate_username_without_password() {
        let proxy = ProxyConfig {
            host: "192.168.1.1".to_string(),
            port: 8080,
            username: Some("user".to_string()),
            password: None,
            timeout_ms: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Password required"));
    }

    #[test]
    fn test_proxy_config_validate_password_without_username() {
        let proxy = ProxyConfig {
            host: "192.168.1.1".to_string(),
            port: 8080,
            username: None,
            password: Some("pass".to_string()),
            timeout_ms: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Username required"));
    }

    #[test]
    fn test_proxy_config_validate_invalid_hostname() {
        let proxy = ProxyConfig {
            host: "-invalid-host".to_string(),
            port: 8080,
            username: None,
            password: None,
            timeout_ms: None,
        };
        let result = proxy.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid host"));
    }

    #[test]
    fn test_proxy_config_serialize_deserialize() {
        let proxy = ProxyConfig::with_auth(
            "proxy.example.com".to_string(),
            1080,
            "user".to_string(),
            "pass".to_string(),
        );

        let json = serde_json::to_string(&proxy).unwrap();
        let deserialized: ProxyConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(proxy, deserialized);
    }

    #[test]
    fn test_proxy_config_serialize_camel_case() {
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let json = serde_json::to_string(&proxy).unwrap();

        // Verify camelCase field names
        assert!(json.contains("\"host\""));
        assert!(json.contains("\"port\""));
        assert!(json.contains("\"username\""));
        assert!(json.contains("\"password\""));
    }

    // =====================
    // RotationMode Tests
    // =====================

    #[test]
    fn test_rotation_mode_default() {
        let mode = RotationMode::default();
        assert_eq!(mode, RotationMode::Manual);
    }

    #[test]
    fn test_rotation_mode_serialize() {
        let mode = RotationMode::Automatic;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, "\"automatic\"");
    }

    #[test]
    fn test_rotation_mode_deserialize() {
        let mode: RotationMode = serde_json::from_str("\"perDomain\"").unwrap();
        assert_eq!(mode, RotationMode::PerDomain);
    }

    // =====================
    // ProxyPool Tests
    // =====================

    #[test]
    fn test_proxy_pool_new() {
        let pool = ProxyPool::new();
        assert!(pool.is_empty());
        assert_eq!(pool.len(), 0);
        assert!(!pool.enabled);
        assert_eq!(pool.rotation_mode, RotationMode::Manual);
    }

    #[test]
    fn test_proxy_pool_add_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        assert!(pool.add_proxy(proxy).is_ok());
        assert_eq!(pool.len(), 1);
        assert!(pool.has_proxies());
    }

    #[test]
    fn test_proxy_pool_add_duplicate_proxy() {
        let mut pool = ProxyPool::new();
        let proxy1 = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let proxy2 = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        assert!(pool.add_proxy(proxy1).is_ok());
        let result = pool.add_proxy(proxy2);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_proxy_pool_add_invalid_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig {
            host: "".to_string(),
            port: 8080,
            username: None,
            password: None,
            timeout_ms: None,
        };

        let result = pool.add_proxy(proxy);
        assert!(result.is_err());
    }

    #[test]
    fn test_proxy_pool_remove_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        pool.add_proxy(proxy).unwrap();

        assert!(pool.remove_proxy("192.168.1.1:8080"));
        assert!(pool.is_empty());
    }

    #[test]
    fn test_proxy_pool_remove_nonexistent() {
        let mut pool = ProxyPool::new();
        assert!(!pool.remove_proxy("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_get_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        pool.add_proxy(proxy).unwrap();

        let retrieved = pool.get_proxy("192.168.1.1:8080");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().host, "192.168.1.1");
    }

    #[test]
    fn test_proxy_pool_get_proxy_ids() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        let ids = pool.get_proxy_ids();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"192.168.1.1:8080".to_string()));
        assert!(ids.contains(&"192.168.1.2:8080".to_string()));
    }

    #[test]
    fn test_proxy_pool_update_proxy() {
        let mut pool = ProxyPool::new();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        pool.add_proxy(proxy).unwrap();

        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);
        assert!(pool.update_proxy("192.168.1.1:8080", updated).is_ok());

        let retrieved = pool.get_proxy("192.168.1.1:9090");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().port, 9090);
    }

    #[test]
    fn test_proxy_pool_update_nonexistent() {
        let mut pool = ProxyPool::new();
        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);

        let result = pool.update_proxy("192.168.1.1:8080", updated);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_proxy_pool_clear() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        pool.clear();
        assert!(pool.is_empty());
    }

    #[test]
    fn test_proxy_pool_domain_assignment() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Assign proxy to gmail.com
        assert!(pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).is_ok());

        // Get assigned proxy
        let gmail_proxy = pool.get_domain_proxy("gmail.com");
        assert!(gmail_proxy.is_some());
        assert_eq!(gmail_proxy.unwrap().host, "192.168.1.1");

        // Unassigned domain returns None
        assert!(pool.get_domain_proxy("yahoo.com").is_none());
    }

    #[test]
    fn test_proxy_pool_domain_assignment_case_insensitive() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        pool.assign_domain("GMAIL.COM".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Should work with lowercase lookup
        let proxy = pool.get_domain_proxy("gmail.com");
        assert!(proxy.is_some());
    }

    #[test]
    fn test_proxy_pool_assign_nonexistent_proxy() {
        let mut pool = ProxyPool::new();

        let result = pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_proxy_pool_unassign_domain() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        assert!(pool.unassign_domain("gmail.com"));
        assert!(pool.get_domain_proxy("gmail.com").is_none());
    }

    #[test]
    fn test_proxy_pool_remove_proxy_clears_assignments() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        pool.remove_proxy("192.168.1.1:8080");

        // Assignment should be removed
        assert!(pool.get_domain_proxy("gmail.com").is_none());
    }

    #[test]
    fn test_proxy_pool_update_proxy_updates_assignments() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Update proxy to new port
        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);
        pool.update_proxy("192.168.1.1:8080", updated).unwrap();

        // Assignment should be updated
        let gmail_proxy = pool.get_domain_proxy("gmail.com");
        assert!(gmail_proxy.is_some());
        assert_eq!(gmail_proxy.unwrap().id(), "192.168.1.1:9090");
    }

    #[test]
    fn test_proxy_pool_serialize_deserialize() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let json = serde_json::to_string(&pool).unwrap();
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();

        assert_eq!(pool.enabled, deserialized.enabled);
        assert_eq!(pool.rotation_mode, deserialized.rotation_mode);
        assert_eq!(pool.len(), deserialized.len());
    }

    #[test]
    fn test_proxy_pool_default_domain_assignments() {
        // Test that deserialization works without domainAssignments field
        let json = r#"{"proxies":[{"host":"192.168.1.1","port":8080,"username":null,"password":null}],"enabled":true,"rotationMode":"manual"}"#;
        let pool: ProxyPool = serde_json::from_str(json).unwrap();

        assert_eq!(pool.len(), 1);
        assert!(pool.domain_assignments.is_empty());
    }

    // =====================
    // Proxy Selection Tests
    // =====================

    #[test]
    fn test_get_next_proxy_empty_pool() {
        let pool = ProxyPool::new();
        let mut index = 0;

        let proxy = pool.get_next_proxy(&mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_next_proxy_single_proxy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should always return the same proxy
        let proxy1 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.1");
    }

    #[test]
    fn test_get_next_proxy_rotation() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should rotate through proxies in order
        let proxy1 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.2");

        let proxy3 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy3.host, "192.168.1.3");

        // Should wrap around
        let proxy4 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(proxy4.host, "192.168.1.1");
    }

    #[test]
    fn test_get_proxy_for_email_manual_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Manual;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should always return first proxy in manual mode
        let proxy1 = pool.get_proxy_for_email("test@gmail.com", &mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_proxy_for_email("test@yahoo.com", &mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.1");

        // Index should not change in manual mode
        assert_eq!(index, 0);
    }

    #[test]
    fn test_get_proxy_for_email_automatic_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Should rotate through proxies
        let proxy1 = pool.get_proxy_for_email("test1@example.com", &mut index).unwrap();
        assert_eq!(proxy1.host, "192.168.1.1");

        let proxy2 = pool.get_proxy_for_email("test2@example.com", &mut index).unwrap();
        assert_eq!(proxy2.host, "192.168.1.2");

        let proxy3 = pool.get_proxy_for_email("test3@example.com", &mut index).unwrap();
        assert_eq!(proxy3.host, "192.168.1.1");
    }

    #[test]
    fn test_get_proxy_for_email_per_domain_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();
        pool.assign_domain("yahoo.com".to_string(), "192.168.1.2:8080".to_string()).unwrap();
        let mut index = 0;

        // Gmail should use proxy 1
        let gmail_proxy = pool.get_proxy_for_email("user@gmail.com", &mut index).unwrap();
        assert_eq!(gmail_proxy.host, "192.168.1.1");

        // Yahoo should use proxy 2
        let yahoo_proxy = pool.get_proxy_for_email("user@yahoo.com", &mut index).unwrap();
        assert_eq!(yahoo_proxy.host, "192.168.1.2");

        // Unassigned domain should fall back to first proxy
        let unknown_proxy = pool.get_proxy_for_email("user@unknown.com", &mut index).unwrap();
        assert_eq!(unknown_proxy.host, "192.168.1.1");
    }

    #[test]
    fn test_get_proxy_for_email_empty_pool() {
        let pool = ProxyPool::new();
        let mut index = 0;

        let proxy = pool.get_proxy_for_email("test@example.com", &mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_proxy_for_email_disabled_pool() {
        let mut pool = ProxyPool::new();
        pool.enabled = false;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        let mut index = 0;

        // Even if disabled, get_proxy_for_email returns a proxy
        // (the enabled flag should be checked by the caller)
        let proxy = pool.get_proxy_for_email("test@example.com", &mut index);
        assert!(proxy.is_some());
    }

    #[test]
    fn test_get_proxy_by_domain_per_domain_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        let proxy = pool.get_proxy_by_domain("gmail.com");
        assert!(proxy.is_some());
        assert_eq!(proxy.unwrap().host, "192.168.1.1");

        let no_proxy = pool.get_proxy_by_domain("yahoo.com");
        assert!(no_proxy.is_none());
    }

    #[test]
    fn test_get_proxy_by_domain_wrong_mode() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Should return None when not in PerDomain mode
        let proxy = pool.get_proxy_by_domain("gmail.com");
        assert!(proxy.is_none());
    }

    #[test]
    fn test_rotation_index_wrapping() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Start with index at max value that could overflow
        let mut index = usize::MAX - 1;
        pool.rotation_mode = RotationMode::Automatic;

        // Should not panic on overflow
        let proxy1 = pool.get_proxy_for_email("test1@example.com", &mut index).unwrap();
        let proxy2 = pool.get_proxy_for_email("test2@example.com", &mut index).unwrap();
        
        // Just verify it doesn't panic and returns valid proxies
        assert!(proxy1.host.starts_with("192.168.1"));
        assert!(proxy2.host.starts_with("192.168.1"));
    }

    // =====================
    // Bad Proxy Detection Tests
    // =====================

    #[test]
    fn test_is_proxy_bad_no_stats() {
        let pool = ProxyPool::new();
        // Proxy with no stats should not be considered bad
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_is_proxy_bad_below_threshold() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // 2 consecutive failures - not bad yet
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_is_proxy_bad_at_threshold() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // 3 consecutive failures - now bad
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_is_proxy_bad_resets_on_success() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // 3 consecutive failures - now bad
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));
        
        // Success resets consecutive failures
        pool.record_success("192.168.1.1:8080");
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_get_available_proxies_empty_pool() {
        let pool = ProxyPool::new();
        assert!(pool.get_available_proxies().is_empty());
    }

    #[test]
    fn test_get_available_proxies_all_healthy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 2);
    }

    #[test]
    fn test_get_available_proxies_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // Mark second proxy as bad (3 failures)
        for _ in 0..3 {
            pool.record_failure("192.168.1.2:8080");
        }
        
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 2);
        assert!(available.iter().all(|p| p.host != "192.168.1.2"));
    }

    #[test]
    fn test_get_available_proxies_all_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark all proxies as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let available = pool.get_available_proxies();
        assert!(available.is_empty());
    }

    #[test]
    fn test_has_available_proxies_with_healthy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        assert!(pool.has_available_proxies());
    }

    #[test]
    fn test_has_available_proxies_all_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Mark as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        assert!(!pool.has_available_proxies());
    }

    #[test]
    fn test_get_next_proxy_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // Mark second proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        
        // Get multiple proxies and verify we never get the bad one
        for _ in 0..10 {
            let proxy = pool.get_next_proxy(&mut index).unwrap();
            assert_ne!(proxy.host, "192.168.1.2");
        }
    }

    #[test]
    fn test_get_next_proxy_all_bad_returns_none() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark all as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_next_proxy(&mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_proxy_for_email_manual_mode_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Manual;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark first proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_proxy_for_email("test@example.com", &mut index).unwrap();
        
        // Should return second proxy (first available non-bad)
        assert_eq!(proxy.host, "192.168.1.2");
    }

    #[test]
    fn test_get_proxy_for_email_automatic_mode_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // Mark second proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        
        // All returned proxies should skip the bad one
        for _ in 0..10 {
            let proxy = pool.get_proxy_for_email("test@example.com", &mut index).unwrap();
            assert_ne!(proxy.host, "192.168.1.2");
        }
    }

    #[test]
    fn test_get_proxy_for_email_per_domain_excludes_bad_assigned() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();
        
        // Mark assigned proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_proxy_for_email("user@gmail.com", &mut index).unwrap();
        
        // Should fall back to second proxy since assigned one is bad
        assert_eq!(proxy.host, "192.168.1.2");
    }

    #[test]
    fn test_get_proxy_for_email_all_bad_returns_none() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::Automatic;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Mark all as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let mut index = 0;
        let proxy = pool.get_proxy_for_email("test@example.com", &mut index);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_get_proxy_by_domain_excludes_bad() {
        let mut pool = ProxyPool::new();
        pool.rotation_mode = RotationMode::PerDomain;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();
        
        // Mark assigned proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let proxy = pool.get_proxy_by_domain("gmail.com");
        assert!(proxy.is_none());
    }

    // =====================
    // Settings with ProxyPool Tests
    // =====================

    #[test]
    fn test_settings_default_has_proxy_pool() {
        let settings = Settings::default();
        assert!(!settings.proxy_pool.enabled);
        assert_eq!(settings.proxy_pool.rotation_mode, RotationMode::Manual);
        assert!(settings.proxy_pool.proxies.is_empty());
    }

    #[test]
    fn test_settings_serialize_with_proxy_pool() {
        let settings = Settings::default();
        let json = serde_json::to_string(&settings).unwrap();

        // Verify proxy_pool is in the JSON (uses snake_case in backend Settings)
        assert!(json.contains("proxy_pool"));
        // ProxyPool fields use camelCase due to #[serde(rename_all = "camelCase")]
        assert!(json.contains("proxies"));
        assert!(json.contains("enabled"));
        assert!(json.contains("rotationMode"));
    }

    #[test]
    fn test_settings_deserialize_with_proxy_pool() {
        // Settings uses snake_case, but ProxyPool uses camelCase
        let json = r#"{
            "validation_mode": "standard",
            "timeout_ms": 30000,
            "concurrency": 5,
            "max_retries": 3,
            "auto_save_interval": 10,
            "history_retention_days": 90,
            "rate_limiter": {"max_per_second": 1, "max_per_minute": 60},
            "proxy_pool": {
                "proxies": [{"host": "192.168.1.1", "port": 8080, "username": null, "password": null}],
                "enabled": true,
                "rotationMode": "automatic",
                "domainAssignments": {}
            }
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();

        assert!(settings.proxy_pool.enabled);
        assert_eq!(settings.proxy_pool.rotation_mode, RotationMode::Automatic);
        assert_eq!(settings.proxy_pool.proxies.len(), 1);
        assert_eq!(settings.proxy_pool.proxies[0].host, "192.168.1.1");
        assert_eq!(settings.proxy_pool.proxies[0].port, 8080);
    }

    #[test]
    fn test_settings_deserialize_without_proxy_pool() {
        // Test that settings deserialize correctly even without proxyPool field
        let json = r#"{
            "validation_mode": "standard",
            "timeout_ms": 30000,
            "concurrency": 5,
            "max_retries": 3,
            "auto_save_interval": 10,
            "history_retention_days": 90,
            "rate_limiter": {"max_per_second": 1, "max_per_minute": 60}
        }"#;
        let settings: Settings = serde_json::from_str(json).unwrap();

        // proxyPool should use default
        assert!(!settings.proxy_pool.enabled);
        assert!(settings.proxy_pool.proxies.is_empty());
    }

    // =====================
    // Proxy Command Logic Tests
    // =====================

    #[test]
    fn test_add_proxy_command_logic() {
        let mut settings = Settings::default();
        let proxy = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        // Simulate add_proxy command
        let result = settings.proxy_pool.add_proxy(proxy);
        assert!(result.is_ok());
        assert_eq!(settings.proxy_pool.proxies.len(), 1);
    }

    #[test]
    fn test_add_proxy_duplicate_command_logic() {
        let mut settings = Settings::default();
        let proxy1 = ProxyConfig::new("192.168.1.1".to_string(), 8080);
        let proxy2 = ProxyConfig::new("192.168.1.1".to_string(), 8080);

        settings.proxy_pool.add_proxy(proxy1).unwrap();
        let result = settings.proxy_pool.add_proxy(proxy2);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_update_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);
        let result = settings.proxy_pool.update_proxy("192.168.1.1:8080", updated);
        assert!(result.is_ok());

        // Verify update
        let proxy = settings.proxy_pool.get_proxy("192.168.1.1:9090");
        assert!(proxy.is_some());
        assert_eq!(proxy.unwrap().port, 9090);
    }

    #[test]
    fn test_update_proxy_not_found_command_logic() {
        let mut settings = Settings::default();
        let updated = ProxyConfig::new("192.168.1.1".to_string(), 9090);

        let result = settings.proxy_pool.update_proxy("192.168.1.1:8080", updated);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_delete_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Simulate delete_proxy command
        let removed = settings.proxy_pool.remove_proxy("192.168.1.1:8080");
        assert!(removed);
        assert!(settings.proxy_pool.proxies.is_empty());
    }

    #[test]
    fn test_delete_proxy_not_found_command_logic() {
        let mut settings = Settings::default();

        let removed = settings.proxy_pool.remove_proxy("192.168.1.1:8080");
        assert!(!removed);
    }

    #[test]
    fn test_get_proxies_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Simulate get_proxies command
        let proxies = settings.proxy_pool.proxies.clone();
        assert_eq!(proxies.len(), 2);
    }

    #[test]
    fn test_clear_proxies_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        settings.proxy_pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Simulate clear_proxies command
        settings.proxy_pool.clear();

        assert!(settings.proxy_pool.proxies.is_empty());
        assert!(settings.proxy_pool.domain_assignments.is_empty());
    }

    #[test]
    fn test_get_proxy_pool_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.enabled = true;
        settings.proxy_pool.rotation_mode = RotationMode::Automatic;
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Simulate get_proxy_pool command
        let pool = settings.proxy_pool.clone();
        assert!(pool.enabled);
        assert_eq!(pool.rotation_mode, RotationMode::Automatic);
        assert_eq!(pool.proxies.len(), 1);
    }

    #[test]
    fn test_update_proxy_pool_config_command_logic() {
        let mut settings = Settings::default();

        // Simulate update_proxy_pool_config command - enable proxy
        settings.proxy_pool.enabled = true;
        settings.proxy_pool.rotation_mode = RotationMode::Automatic;

        assert!(settings.proxy_pool.enabled);
        assert_eq!(settings.proxy_pool.rotation_mode, RotationMode::Automatic);
    }

    #[test]
    fn test_assign_domain_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Simulate assign_domain_proxy command
        let result = settings.proxy_pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string());
        assert!(result.is_ok());

        let assigned = settings.proxy_pool.get_domain_proxy("gmail.com");
        assert!(assigned.is_some());
        assert_eq!(assigned.unwrap().host, "192.168.1.1");
    }

    #[test]
    fn test_unassign_domain_proxy_command_logic() {
        let mut settings = Settings::default();
        settings.proxy_pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        settings.proxy_pool.assign_domain("gmail.com".to_string(), "192.168.1.1:8080".to_string()).unwrap();

        // Simulate unassign_domain_proxy command
        let removed = settings.proxy_pool.unassign_domain("gmail.com");
        assert!(removed);

        let assigned = settings.proxy_pool.get_domain_proxy("gmail.com");
        assert!(assigned.is_none());
    }

    // =====================
    // ProxyStats Tests
    // =====================

    #[test]
    fn test_proxy_stats_new() {
        let stats = ProxyStats::new();
        assert_eq!(stats.attempts, 0);
        assert_eq!(stats.successes, 0);
        assert_eq!(stats.failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    }

    #[test]
    fn test_proxy_stats_record_success() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        
        assert_eq!(stats.attempts, 1);
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    }

    #[test]
    fn test_proxy_stats_record_failure() {
        let mut stats = ProxyStats::new();
        stats.record_failure();
        
        assert_eq!(stats.attempts, 1);
        assert_eq!(stats.successes, 0);
        assert_eq!(stats.failures, 1);
        assert_eq!(stats.consecutive_failures, 1);
    }

    #[test]
    fn test_proxy_stats_consecutive_failures_reset_on_success() {
        let mut stats = ProxyStats::new();
        stats.record_failure();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.consecutive_failures, 3);
        
        stats.record_success();
        assert_eq!(stats.consecutive_failures, 0);
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.failures, 3);
    }

    #[test]
    fn test_proxy_stats_success_rate_no_attempts() {
        let stats = ProxyStats::new();
        // No attempts should return 100 (neutral/healthy)
        assert_eq!(stats.success_rate(), 100);
    }

    #[test]
    fn test_proxy_stats_success_rate_all_success() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_success();
        stats.record_success();
        
        assert_eq!(stats.success_rate(), 100);
    }

    #[test]
    fn test_proxy_stats_success_rate_all_failures() {
        let mut stats = ProxyStats::new();
        stats.record_failure();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.success_rate(), 0);
    }

    #[test]
    fn test_proxy_stats_success_rate_mixed() {
        let mut stats = ProxyStats::new();
        // 3 successes, 2 failures = 60%
        stats.record_success();
        stats.record_success();
        stats.record_success();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.success_rate(), 60);
    }

    #[test]
    fn test_proxy_stats_health_status_healthy() {
        let mut stats = ProxyStats::new();
        // 95% success rate
        for _ in 0..95 {
            stats.record_success();
        }
        for _ in 0..5 {
            stats.record_failure();
        }
        
        assert_eq!(stats.health_status(), HealthStatus::Healthy);
    }

    #[test]
    fn test_proxy_stats_health_status_degraded() {
        let mut stats = ProxyStats::new();
        // 70% success rate
        for _ in 0..70 {
            stats.record_success();
        }
        for _ in 0..30 {
            stats.record_failure();
        }
        
        assert_eq!(stats.health_status(), HealthStatus::Degraded);
    }

    #[test]
    fn test_proxy_stats_health_status_failed() {
        let mut stats = ProxyStats::new();
        // 40% success rate
        for _ in 0..40 {
            stats.record_success();
        }
        for _ in 0..60 {
            stats.record_failure();
        }
        
        assert_eq!(stats.health_status(), HealthStatus::Failed);
    }

    #[test]
    fn test_proxy_stats_health_status_new_proxy() {
        let stats = ProxyStats::new();
        // No attempts = 100% = Healthy
        assert_eq!(stats.health_status(), HealthStatus::Healthy);
    }

    #[test]
    fn test_proxy_stats_is_bad() {
        let mut stats = ProxyStats::new();
        
        // 2 failures - not bad yet
        stats.record_failure();
        stats.record_failure();
        assert!(!stats.is_bad());
        
        // 3 failures - now bad
        stats.record_failure();
        assert!(stats.is_bad());
        
        // Success resets consecutive failures
        stats.record_success();
        assert!(!stats.is_bad());
    }

    #[test]
    fn test_proxy_stats_reset() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_failure();
        stats.record_failure();
        
        stats.reset();
        
        assert_eq!(stats.attempts, 0);
        assert_eq!(stats.successes, 0);
        assert_eq!(stats.failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    }

    #[test]
    fn test_proxy_stats_serialize_deserialize() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_failure();
        
        let json = serde_json::to_string(&stats).unwrap();
        let deserialized: ProxyStats = serde_json::from_str(&json).unwrap();
        
        assert_eq!(stats, deserialized);
    }

    #[test]
    fn test_proxy_stats_serialize_camel_case() {
        let mut stats = ProxyStats::new();
        stats.record_success();
        stats.record_failure();
        
        let json = serde_json::to_string(&stats).unwrap();
        
        // Verify camelCase field names
        assert!(json.contains("\"attempts\""));
        assert!(json.contains("\"successes\""));
        assert!(json.contains("\"failures\""));
        assert!(json.contains("\"consecutiveFailures\""));
    }

    #[test]
    fn test_health_status_serialize() {
        assert_eq!(serde_json::to_string(&HealthStatus::Healthy).unwrap(), "\"healthy\"");
        assert_eq!(serde_json::to_string(&HealthStatus::Degraded).unwrap(), "\"degraded\"");
        assert_eq!(serde_json::to_string(&HealthStatus::Failed).unwrap(), "\"failed\"");
    }

    #[test]
    fn test_health_status_deserialize() {
        assert_eq!(serde_json::from_str::<HealthStatus>("\"healthy\"").unwrap(), HealthStatus::Healthy);
        assert_eq!(serde_json::from_str::<HealthStatus>("\"degraded\"").unwrap(), HealthStatus::Degraded);
        assert_eq!(serde_json::from_str::<HealthStatus>("\"failed\"").unwrap(), HealthStatus::Failed);
    }

    // =====================
    // Cooldown Tests
    // =====================

    #[test]
    fn test_proxy_stats_enter_cooldown() {
        let mut stats = ProxyStats::new();
        assert!(!stats.is_in_cooldown());
        
        stats.enter_cooldown(60);
        assert!(stats.is_in_cooldown());
        assert!(stats.remaining_cooldown_secs() > 0);
        assert!(stats.remaining_cooldown_secs() <= 60);
    }

    #[test]
    fn test_proxy_stats_cooldown_expiry() {
        let mut stats = ProxyStats::new();
        
        // Enter cooldown for 1 second
        stats.enter_cooldown(1);
        assert!(stats.is_in_cooldown());
        
        // Wait for cooldown to expire
        std::thread::sleep(std::time::Duration::from_secs(2));
        
        assert!(!stats.is_in_cooldown());
        assert_eq!(stats.remaining_cooldown_secs(), 0);
    }

    #[test]
    fn test_proxy_stats_clear_cooldown() {
        let mut stats = ProxyStats::new();
        stats.enter_cooldown(60);
        assert!(stats.is_in_cooldown());
        
        stats.clear_cooldown();
        assert!(!stats.is_in_cooldown());
        assert_eq!(stats.remaining_cooldown_secs(), 0);
    }

    #[test]
    fn test_proxy_stats_cooldown_persists_in_json() {
        let mut stats = ProxyStats::new();
        stats.enter_cooldown(60);
        
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"cooldownUntil\""));
        
        let deserialized: ProxyStats = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_in_cooldown());
    }

    #[test]
    fn test_proxy_pool_default_cooldown_duration() {
        let pool = ProxyPool::new();
        assert_eq!(pool.cooldown_duration_secs, 60);
    }

    #[test]
    fn test_proxy_pool_set_cooldown_duration() {
        let mut pool = ProxyPool::new();
        
        // Test clamping to minimum
        pool.set_cooldown_duration(10);
        assert_eq!(pool.cooldown_duration_secs, 30);
        
        // Test clamping to maximum
        pool.set_cooldown_duration(500);
        assert_eq!(pool.cooldown_duration_secs, 300);
        
        // Test valid value
        pool.set_cooldown_duration(120);
        assert_eq!(pool.cooldown_duration_secs, 120);
    }

    #[test]
    fn test_proxy_pool_is_proxy_in_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Not in cooldown initially
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        
        // Make it bad (3 failures)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Should now be in cooldown
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_bypass_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Make it bad (3 failures) - enters cooldown
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));
        
        // Bypass cooldown
        pool.bypass_cooldown("192.168.1.1:8080");
        
        // Should no longer be in cooldown or bad
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_record_success_clears_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Make it bad (3 failures) - enters cooldown
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        
        // Record success - should clear cooldown
        pool.record_success("192.168.1.1:8080");
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_get_available_proxies_excludes_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Make first proxy bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].host, "192.168.1.2");
    }

    #[test]
    fn test_proxy_pool_is_proxy_available() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Available initially
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
        
        // 2 failures - still available
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
        
        // 3 failures - now bad and in cooldown
        pool.record_failure("192.168.1.1:8080");
        assert!(!pool.is_proxy_available("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_get_remaining_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // No cooldown initially
        assert_eq!(pool.get_remaining_cooldown("192.168.1.1:8080"), 0);
        
        // Make it bad (enters cooldown with default 60s)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let remaining = pool.get_remaining_cooldown("192.168.1.1:8080");
        assert!(remaining > 0);
        assert!(remaining <= 60);
    }

    #[test]
    fn test_proxy_pool_cooldown_persists_in_json() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Make it bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let json = serde_json::to_string(&pool).unwrap();
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();
        
        // Should still be in cooldown after deserialization
        assert!(deserialized.is_proxy_in_cooldown("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_cooldown_duration_in_json() {
        let mut pool = ProxyPool::new();
        pool.set_cooldown_duration(120);
        
        let json = serde_json::to_string(&pool).unwrap();
        assert!(json.contains("\"cooldownDurationSecs\":120"));
        
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.cooldown_duration_secs, 120);
    }

    // =====================
    // ProxyPool Stats Tests
    // =====================

    #[test]
    fn test_proxy_pool_get_stats_new_proxy() {
        let pool = ProxyPool::new();
        let stats = pool.get_stats("192.168.1.1:8080");
        
        // Should return default stats for non-existent proxy
        assert_eq!(stats.attempts, 0);
    }

    #[test]
    fn test_proxy_pool_record_success() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        pool.record_success("192.168.1.1:8080");
        
        let stats = pool.get_stats("192.168.1.1:8080");
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.attempts, 1);
    }

    #[test]
    fn test_proxy_pool_record_failure() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        pool.record_failure("192.168.1.1:8080");
        
        let stats = pool.get_stats("192.168.1.1:8080");
        assert_eq!(stats.failures, 1);
        assert_eq!(stats.attempts, 1);
    }

    #[test]
    fn test_proxy_pool_remove_proxy_clears_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        
        pool.remove_proxy("192.168.1.1:8080");
        
        // Stats should be removed
        assert!(!pool.proxy_stats.contains_key("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_pool_clear_clears_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        
        pool.clear();
        
        assert!(pool.proxy_stats.is_empty());
    }

    #[test]
    fn test_proxy_pool_reset_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        
        pool.reset_stats("192.168.1.1:8080");
        
        let stats = pool.get_stats("192.168.1.1:8080");
        assert_eq!(stats.attempts, 0);
    }

    #[test]
    fn test_proxy_pool_reset_all_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.2:8080");
        
        pool.reset_all_stats();
        
        assert!(pool.proxy_stats.is_empty());
    }

    #[test]
    fn test_proxy_pool_stats_persist_in_json() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        let json = serde_json::to_string(&pool).unwrap();
        let deserialized: ProxyPool = serde_json::from_str(&json).unwrap();
        
        let stats = deserialized.get_stats("192.168.1.1:8080");
        assert_eq!(stats.successes, 1);
        assert_eq!(stats.failures, 1);
    }

    // =====================
    // Weighted Rotation Tests
    // =====================

    #[test]
    fn test_proxy_stats_get_weight_new_proxy() {
        // New proxies (no attempts) get neutral weight of 50
        let stats = ProxyStats::new();
        assert_eq!(stats.get_weight(), 50);
    }

    #[test]
    fn test_proxy_stats_get_weight_full_success() {
        let mut stats = ProxyStats::new();
        // 100% success rate
        stats.record_success();
        stats.record_success();
        stats.record_success();
        
        assert_eq!(stats.get_weight(), 100);
    }

    #[test]
    fn test_proxy_stats_get_weight_full_failure() {
        let mut stats = ProxyStats::new();
        // 0% success rate
        stats.record_failure();
        stats.record_failure();
        stats.record_failure();
        
        assert_eq!(stats.get_weight(), 0);
    }

    #[test]
    fn test_proxy_stats_get_weight_mixed() {
        let mut stats = ProxyStats::new();
        // 70% success rate
        for _ in 0..7 {
            stats.record_success();
        }
        for _ in 0..3 {
            stats.record_failure();
        }
        
        assert_eq!(stats.get_weight(), 70);
    }

    #[test]
    fn test_proxy_stats_get_weight_cooldown() {
        let mut stats = ProxyStats::new();
        // 100% success rate
        stats.record_success();
        stats.record_success();
        stats.record_success();
        assert_eq!(stats.get_weight(), 100);
        
        // Enter cooldown - weight should be 0
        stats.enter_cooldown(60);
        assert_eq!(stats.get_weight(), 0);
        
        // Clear cooldown - weight should be back
        stats.clear_cooldown();
        assert_eq!(stats.get_weight(), 100);
    }

    #[test]
    fn test_proxy_pool_get_proxy_weight_new_proxy() {
        let pool = ProxyPool::new();
        // New proxy (not in stats) gets neutral weight of 50
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 50);
    }

    #[test]
    fn test_proxy_pool_get_proxy_weight_with_stats() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Record 80% success rate
        for _ in 0..8 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..2 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 80);
    }

    #[test]
    fn test_proxy_pool_get_proxy_weight_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        // Record some successes
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 100);
        
        // Make it bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Weight should be 0 when in cooldown
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 0);
    }

    #[test]
    fn test_proxy_pool_all_weights_equal_single_proxy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        let available = pool.get_available_proxies();
        assert!(pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_all_weights_equal_new_proxies() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // All new proxies have weight 50
        let available = pool.get_available_proxies();
        assert!(pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_all_weights_equal_same_success_rate() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Both get 100% success rate
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        assert!(pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_all_weights_not_equal() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Different success rates
        pool.record_success("192.168.1.1:8080"); // 100%
        pool.record_failure("192.168.1.2:8080"); // 0%
        
        let available = pool.get_available_proxies();
        assert!(!pool.all_weights_equal(&available));
    }

    #[test]
    fn test_proxy_pool_weighted_selection_returns_proxy() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Set different weights
        pool.record_success("192.168.1.1:8080"); // 100%
        pool.record_failure("192.168.1.2:8080"); // 0%
        
        let available = pool.get_available_proxies();
        
        // Select many times - should always return a valid proxy
        for _ in 0..100 {
            let proxy = pool.select_weighted_proxy(&available);
            assert!(proxy.is_some());
            let host = proxy.unwrap().host;
            assert!(host == "192.168.1.1" || host == "192.168.1.2");
        }
    }

    #[test]
    fn test_proxy_pool_weighted_selection_favors_higher_weight() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Proxy 1: 100% success, Proxy 2: 10% success
        for _ in 0..10 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..9 {
            pool.record_failure("192.168.1.2:8080");
        }
        pool.record_success("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        
        // Count selections over many iterations
        let mut proxy1_count = 0;
        let mut proxy2_count = 0;
        
        for _ in 0..1000 {
            let proxy = pool.select_weighted_proxy(&available).unwrap();
            if proxy.host == "192.168.1.1" {
                proxy1_count += 1;
            } else {
                proxy2_count += 1;
            }
        }
        
        // Proxy 1 should be selected much more often (weight 100 vs weight 10)
        // Expected ratio is roughly 100:10 = 10:1
        // So proxy1_count should be much higher than proxy2_count
        assert!(proxy1_count > proxy2_count * 5, 
            "Expected proxy1 to be selected much more often. Got proxy1: {}, proxy2: {}", 
            proxy1_count, proxy2_count);
    }

    #[test]
    fn test_proxy_pool_weighted_selection_empty() {
        let pool = ProxyPool::new();
        let available: Vec<ProxyConfig> = vec![];
        
        let proxy = pool.select_weighted_proxy(&available);
        assert!(proxy.is_none());
    }

    #[test]
    fn test_proxy_pool_weighted_selection_zero_total_weight() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Both proxies have 0% success rate
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        
        // Should still return a proxy (fallback to first)
        let proxy = pool.select_weighted_proxy(&available);
        assert!(proxy.is_some());
    }

    #[test]
    fn test_proxy_pool_get_next_proxy_uses_round_robin_when_equal() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();
        
        // All proxies have equal weight (50 - new proxies)
        let mut index = 0;
        
        // Should rotate in order (round-robin)
        let p1 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p1.host, "192.168.1.1");
        
        let p2 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p2.host, "192.168.1.2");
        
        let p3 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p3.host, "192.168.1.3");
        
        let p4 = pool.get_next_proxy(&mut index).unwrap();
        assert_eq!(p4.host, "192.168.1.1");
    }

    #[test]
    fn test_proxy_pool_get_next_proxy_uses_weighted_when_different() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Proxy 1: 100% success, Proxy 2: 20% success
        for _ in 0..10 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..8 {
            pool.record_failure("192.168.1.2:8080");
        }
        for _ in 0..2 {
            pool.record_success("192.168.1.2:8080");
        }
        
        let mut index = 0;
        
        // Count how often each proxy is selected
        let mut proxy1_count = 0;
        let mut proxy2_count = 0;
        
        for _ in 0..100 {
            let proxy = pool.get_next_proxy(&mut index).unwrap();
            if proxy.host == "192.168.1.1" {
                proxy1_count += 1;
            } else {
                proxy2_count += 1;
            }
        }
        
        // Proxy 1 should be selected more often due to higher weight
        assert!(proxy1_count > proxy2_count, 
            "Expected proxy1 to be selected more often. Got proxy1: {}, proxy2: {}", 
            proxy1_count, proxy2_count);
    }

    #[test]
    fn test_proxy_pool_weighted_excludes_cooldown() {
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        
        // Proxy 1 in cooldown (3 failures)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        // Proxy 2 healthy
        pool.record_success("192.168.1.2:8080");
        
        let available = pool.get_available_proxies();
        
        // Only proxy 2 should be available
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].host, "192.168.1.2");
    }

    #[test]
    fn test_proxy_pool_weighted_distribution() {
        // Test that weights are correctly calculated and used
        let mut pool = ProxyPool::new();
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap(); // Will have 80%
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap(); // Will have 50%
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap(); // Will have 30%
        
        // Proxy 1: 80% success rate (8 success, 2 failure - alternating to avoid consecutive failures)
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_success("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");
        
        // Proxy 2: 50% success rate (5 success, 5 failure - alternating)
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        pool.record_success("192.168.1.2:8080");
        pool.record_failure("192.168.1.2:8080");
        
        // Proxy 3: 30% success rate (3 success, 7 failure - but ensure no 3 consecutive failures)
        pool.record_failure("192.168.1.3:8080");
        pool.record_success("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        pool.record_success("192.168.1.3:8080"); // Reset consecutive failures
        pool.record_failure("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        pool.record_success("192.168.1.3:8080"); // Reset consecutive failures
        pool.record_failure("192.168.1.3:8080");
        pool.record_failure("192.168.1.3:8080");
        
        // Verify weights
        assert_eq!(pool.get_proxy_weight("192.168.1.1:8080"), 80);
        assert_eq!(pool.get_proxy_weight("192.168.1.2:8080"), 50);
        assert_eq!(pool.get_proxy_weight("192.168.1.3:8080"), 30);
        
        // Verify all proxies are available (not in cooldown, not bad)
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 3);
        
        // Verify that proxies with different weights use weighted selection
        assert!(!pool.all_weights_equal(&available));
        
        // Verify that select_weighted_proxy returns a valid proxy
        for _ in 0..100 {
            let proxy = pool.select_weighted_proxy(&available);
            assert!(proxy.is_some());
            let host = proxy.unwrap().host.clone();
            assert!(host == "192.168.1.1" || host == "192.168.1.2" || host == "192.168.1.3");
        }
    }

    // =====================
    // All Proxies Failed Detection Tests
    // =====================

    #[test]
    fn test_all_proxies_failed_disabled_pool() {
        let mut pool = ProxyPool::new();
        pool.enabled = false;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Even if all proxies are bad, should return false if disabled
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        assert!(!pool.all_proxies_failed());
    }

    #[test]
    fn test_all_proxies_failed_empty_pool() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;

        // Empty pool should not trigger all-proxies-failed
        assert!(!pool.all_proxies_failed());
    }

    #[test]
    fn test_all_proxies_failed_has_available() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Mark first proxy as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Second proxy is still available
        assert!(!pool.all_proxies_failed());
    }

    #[test]
    fn test_all_proxies_failed_all_bad() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Mark all proxies as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        assert!(pool.all_proxies_failed());
    }

    #[test]
    fn test_all_proxies_failed_all_in_cooldown() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Mark proxy as bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        assert!(pool.all_proxies_failed());
    }

    #[test]
    fn test_get_all_proxies_failed_state_returns_none_when_not_failed() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Not in failed state
        assert!(pool.get_all_proxies_failed_state().is_none());
    }

    #[test]
    fn test_get_all_proxies_failed_state_returns_state_when_failed() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Mark all as bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
        }
        
        let state = pool.get_all_proxies_failed_state();
        assert!(state.is_some());
        
        let state = state.unwrap();
        assert_eq!(state.total_proxies, 2);
        assert_eq!(state.bad_count, 2);
        assert!(state.proxy_enabled);
        assert_eq!(state.failed_proxies.len(), 2);
    }

    #[test]
    fn test_get_all_proxies_failed_state_includes_cooldown_info() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Mark as bad (enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let state = pool.get_all_proxies_failed_state().unwrap();
        assert!(state.failed_proxies[0].is_bad);
        assert!(state.failed_proxies[0].remaining_cooldown_secs > 0);
        assert!(state.nearest_cooldown_secs > 0);
    }

    #[test]
    fn test_get_all_proxies_failed_state_consecutive_failures() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // 3 failures
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let state = pool.get_all_proxies_failed_state().unwrap();
        assert_eq!(state.failed_proxies[0].consecutive_failures, 3);
    }

    #[test]
    fn test_get_all_proxies_failed_state_success_rate() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // 1 success, 3 failures = 25% success rate
        pool.record_success("192.168.1.1:8080");
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        let state = pool.get_all_proxies_failed_state().unwrap();
        assert_eq!(state.failed_proxies[0].success_rate, 25);
    }

    #[test]
    fn test_no_proxies_configured_enabled_empty() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        
        assert!(pool.no_proxies_configured());
    }

    #[test]
    fn test_no_proxies_configured_disabled_empty() {
        let mut pool = ProxyPool::new();
        pool.enabled = false;
        
        // Should be false because proxy is disabled
        assert!(!pool.no_proxies_configured());
    }

    #[test]
    fn test_no_proxies_configured_enabled_with_proxies() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        
        assert!(!pool.no_proxies_configured());
    }

    #[test]
    fn test_failed_proxy_info_serialize() {
        let info = FailedProxyInfo {
            id: "192.168.1.1:8080".to_string(),
            is_bad: true,
            remaining_cooldown_secs: 45,
            consecutive_failures: 3,
            success_rate: 50,
            auto_disabled: false,
        };
        
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"id\""));
        assert!(json.contains("\"isBad\""));
        assert!(json.contains("\"remainingCooldownSecs\""));
        assert!(json.contains("\"consecutiveFailures\""));
        assert!(json.contains("\"successRate\""));
    }

    #[test]
    fn test_all_proxies_failed_state_serialize() {
        let state = AllProxiesFailedState {
            failed_proxies: vec![FailedProxyInfo {
                id: "192.168.1.1:8080".to_string(),
                is_bad: true,
                remaining_cooldown_secs: 45,
                consecutive_failures: 3,
                success_rate: 50,
                auto_disabled: false,
            }],
            proxy_enabled: true,
            total_proxies: 1,
            bad_count: 1,
            cooldown_count: 1,
            nearest_cooldown_secs: 45,
        };
        
        let json = serde_json::to_string(&state).unwrap();
        assert!(json.contains("\"failedProxies\""));
        assert!(json.contains("\"proxyEnabled\""));
        assert!(json.contains("\"totalProxies\""));
        assert!(json.contains("\"badCount\""));
        assert!(json.contains("\"cooldownCount\""));
        assert!(json.contains("\"nearestCooldownSecs\""));
    }

    #[test]
    fn test_all_proxies_failed_mixed_bad_and_cooldown() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // First proxy: bad (3 consecutive failures, enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Second proxy: manually put in cooldown without being bad
        // Use entry API to ensure the stats entry exists
        pool.proxy_stats.entry("192.168.1.2:8080".to_string()).or_default().enter_cooldown(60);
        
        assert!(pool.all_proxies_failed());
        
        let state = pool.get_all_proxies_failed_state().unwrap();
        assert_eq!(state.total_proxies, 2);
        assert_eq!(state.bad_count, 1); // Only first proxy is bad
        assert_eq!(state.cooldown_count, 2); // Both in cooldown
    }

    #[test]
    fn test_all_proxies_failed_nearest_cooldown() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // First proxy: bad with default cooldown (60s)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        
        // Second proxy: put in cooldown manually (will have ~60s as well)
        // Use entry API to ensure the stats entry exists
        pool.proxy_stats.entry("192.168.1.2:8080".to_string()).or_default().enter_cooldown(60);
        
        let state = pool.get_all_proxies_failed_state().unwrap();
        // Both should have similar cooldown times, nearest should be > 0
        assert!(state.nearest_cooldown_secs > 0);
        assert!(state.nearest_cooldown_secs <= 60);
    }

    // =====================
    // Retry with Cooldown Tests (VAL-FLR-004, VAL-FLR-006)
    // =====================

    #[test]
    fn test_proxy_becomes_available_after_cooldown_expires() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Make proxy bad (3 failures → enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }

        // Proxy should be unavailable while in cooldown
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(!pool.is_proxy_available("192.168.1.1:8080"));
        assert!(pool.all_proxies_failed());

        // Simulate cooldown expiry by clearing cooldown
        pool.proxy_stats.entry("192.168.1.1:8080".to_string()).or_default().clear_cooldown();

        // Proxy should now be available even though consecutive_failures >= 3
        assert!(!pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
        assert!(!pool.all_proxies_failed());
    }

    #[test]
    fn test_proxy_reenters_cooldown_after_failed_retry() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Make proxy bad (3 failures → enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));

        // Simulate cooldown expiry
        pool.proxy_stats.entry("192.168.1.1:8080".to_string()).or_default().clear_cooldown();
        assert!(pool.is_proxy_available("192.168.1.1:8080"));

        // Proxy fails again → should re-enter cooldown (consecutive_failures now 4)
        pool.record_failure("192.168.1.1:8080");
        assert!(pool.is_proxy_in_cooldown("192.168.1.1:8080"));
        assert!(!pool.is_proxy_available("192.168.1.1:8080"));
    }

    #[test]
    fn test_proxy_success_after_cooldown_clears_bad_status() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();

        // Make proxy bad (3 failures → enters cooldown)
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.is_proxy_bad("192.168.1.1:8080"));

        // Simulate cooldown expiry
        pool.proxy_stats.entry("192.168.1.1:8080".to_string()).or_default().clear_cooldown();

        // Proxy succeeds → consecutive_failures resets to 0
        pool.record_success("192.168.1.1:8080");
        assert!(!pool.is_proxy_bad("192.168.1.1:8080"));
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
    }

    #[test]
    fn test_partial_proxy_recovery_after_cooldown() {
        // VAL-FLR-006: Some proxies recover from cooldown while others remain failed
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.3".to_string(), 8080)).unwrap();

        // Make all proxies bad
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
            pool.record_failure("192.168.1.2:8080");
            pool.record_failure("192.168.1.3:8080");
        }
        assert!(pool.all_proxies_failed());

        // Simulate first proxy's cooldown expiring
        pool.proxy_stats.entry("192.168.1.1:8080".to_string()).or_default().clear_cooldown();

        // Now only proxy 1 should be available (2 and 3 still in cooldown)
        assert!(!pool.all_proxies_failed());
        let available = pool.get_available_proxies();
        assert_eq!(available.len(), 1);
        assert_eq!(available[0].host, "192.168.1.1");
    }

    #[test]
    fn test_nearest_cooldown_secs_after_partial_recovery() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();

        // Make all proxies bad with different cooldowns
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        // Second proxy: manually set shorter cooldown
        pool.proxy_stats.entry("192.168.1.2:8080".to_string()).or_default().enter_cooldown(30);

        let state = pool.get_all_proxies_failed_state().unwrap();
        // Nearest cooldown should be from proxy 2 (30s)
        assert!(state.nearest_cooldown_secs <= 30);
    }

    // =====================
    // ProxyStats Duration Tracking Tests (VAL-PROXY-005, VAL-PROXY-006, VAL-PROXY-007)
    // =====================

    #[test]
    fn test_proxy_stats_default_includes_avg_duration_ms() {
        let stats = ProxyStats::default();
        assert_eq!(stats.avg_duration_ms, 0.0);
        assert!(!stats.auto_disabled);
    }

    #[test]
    fn test_proxy_stats_record_success_with_duration_first() {
        let mut stats = ProxyStats::new();
        stats.record_success_with_duration(150.0);
        assert_eq!(stats.avg_duration_ms, 150.0);
        assert_eq!(stats.successes, 1);
    }

    #[test]
    fn test_proxy_stats_record_success_with_duration_rolling_average() {
        let mut stats = ProxyStats::new();
        stats.record_success_with_duration(100.0);
        stats.record_success_with_duration(200.0);
        stats.record_success_with_duration(300.0);

        // Rolling average: ((100 * 1) + 200) / 2 = 150, then ((150 * 2) + 300) / 3 = 200
        assert!((stats.avg_duration_ms - 200.0).abs() < f64::EPSILON);
        assert_eq!(stats.successes, 3);
    }

    #[test]
    fn test_proxy_stats_failure_does_not_change_avg_duration() {
        let mut stats = ProxyStats::new();
        stats.record_success_with_duration(100.0);
        assert_eq!(stats.avg_duration_ms, 100.0);

        stats.record_failure();
        // avg_duration_ms should be unchanged after failure
        assert_eq!(stats.avg_duration_ms, 100.0);
        assert_eq!(stats.failures, 1);
    }

    #[test]
    fn test_proxy_stats_record_success_without_duration_keeps_zero() {
        let mut stats = ProxyStats::new();
        stats.record_success(); // duration defaults to 0.0
        assert_eq!(stats.avg_duration_ms, 0.0);
    }

    #[test]
    fn test_proxy_stats_serialization_includes_new_fields() {
        let mut stats = ProxyStats::new();
        stats.record_success_with_duration(123.5);
        stats.auto_disabled = true;

        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("avgDurationMs"));
        assert!(json.contains("autoDisabled"));

        let deserialized: ProxyStats = serde_json::from_str(&json).unwrap();
        assert!((deserialized.avg_duration_ms - 123.5).abs() < f64::EPSILON);
        assert!(deserialized.auto_disabled);
    }

    // =====================
    // Auto-Disable Threshold Tests (VAL-PROXY-011, VAL-PROXY-012)
    // =====================

    #[test]
    fn test_auto_disable_threshold_default() {
        let threshold = AutoDisableThreshold::default();
        assert_eq!(threshold.success_rate_percent, 20);
        assert_eq!(threshold.min_attempts, 10);
    }

    #[test]
    fn test_auto_disable_threshold_serialization() {
        let threshold = AutoDisableThreshold {
            success_rate_percent: 30,
            min_attempts: 5,
        };
        let json = serde_json::to_string(&threshold).unwrap();
        assert!(json.contains("successRatePercent"));
        assert!(json.contains("minAttempts"));

        let deserialized: AutoDisableThreshold = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.success_rate_percent, 30);
        assert_eq!(deserialized.min_attempts, 5);
    }

    #[test]
    fn test_auto_disable_triggers_when_below_threshold() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.auto_disable_threshold = AutoDisableThreshold {
            success_rate_percent: 30,
            min_attempts: 5,
        };

        // Record 1 success then 4 failures = 20% success rate (below 30%), total 5 attempts
        pool.record_success("192.168.1.1:8080");
        for _ in 0..4 {
            pool.record_failure("192.168.1.1:8080");
        }

        // 5 attempts, 20% success rate, threshold is 30% → should be auto-disabled
        let stats = pool.get_stats("192.168.1.1:8080");
        assert!(stats.auto_disabled, "Proxy should be auto-disabled when success rate is below threshold");
    }

    #[test]
    fn test_auto_disable_does_not_trigger_above_threshold() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.auto_disable_threshold = AutoDisableThreshold {
            success_rate_percent: 20,
            min_attempts: 10,
        };

        // Record 8 successes and 2 failures = 80% success rate (above 20%)
        for _ in 0..8 {
            pool.record_success("192.168.1.1:8080");
        }
        for _ in 0..2 {
            pool.record_failure("192.168.1.1:8080");
        }

        let stats = pool.get_stats("192.168.1.1:8080");
        assert!(!stats.auto_disabled, "Proxy should not be auto-disabled when success rate is above threshold");
    }

    #[test]
    fn test_auto_disable_does_not_trigger_below_min_attempts() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.auto_disable_threshold = AutoDisableThreshold {
            success_rate_percent: 80,
            min_attempts: 10,
        };

        // Record 2 failures = 0% success rate, but only 2 attempts (below min 10)
        pool.record_failure("192.168.1.1:8080");
        pool.record_failure("192.168.1.1:8080");

        let stats = pool.get_stats("192.168.1.1:8080");
        assert!(!stats.auto_disabled, "Proxy should not be auto-disabled below min_attempts threshold");
    }

    #[test]
    fn test_auto_disabled_proxy_excluded_from_rotation() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.add_proxy(ProxyConfig::new("192.168.1.2".to_string(), 8080)).unwrap();
        pool.auto_disable_threshold = AutoDisableThreshold {
            success_rate_percent: 50,
            min_attempts: 3,
        };

        // Make first proxy fail enough to be auto-disabled
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }

        let stats = pool.get_stats("192.168.1.1:8080");
        assert!(stats.auto_disabled);

        // Auto-disabled proxy should not be available
        assert!(!pool.is_proxy_available("192.168.1.1:8080"));
        // Second proxy should still be available
        assert!(pool.is_proxy_available("192.168.1.2:8080"));
    }

    #[test]
    fn test_re_enable_proxy() {
        let mut pool = ProxyPool::new();
        pool.enabled = true;
        pool.add_proxy(ProxyConfig::new("192.168.1.1".to_string(), 8080)).unwrap();
        pool.auto_disable_threshold = AutoDisableThreshold {
            success_rate_percent: 50,
            min_attempts: 3,
        };

        // Auto-disable the proxy
        for _ in 0..3 {
            pool.record_failure("192.168.1.1:8080");
        }
        assert!(pool.get_stats("192.168.1.1:8080").auto_disabled);
        assert!(!pool.is_proxy_available("192.168.1.1:8080"));

        // Re-enable
        pool.re_enable_proxy("192.168.1.1:8080");
        let stats = pool.get_stats("192.168.1.1:8080");
        assert!(!stats.auto_disabled);
        assert_eq!(stats.consecutive_failures, 0);
        assert!(pool.is_proxy_available("192.168.1.1:8080"));
    }

    #[test]
    fn test_set_auto_disable_threshold() {
        let mut pool = ProxyPool::new();
        let new_threshold = AutoDisableThreshold {
            success_rate_percent: 40,
            min_attempts: 15,
        };
        pool.set_auto_disable_threshold(new_threshold.clone());
        assert_eq!(pool.auto_disable_threshold, new_threshold);
    }

    #[test]
    fn test_proxy_pool_default_includes_auto_disable_threshold() {
        let pool = ProxyPool::default();
        assert_eq!(pool.auto_disable_threshold.success_rate_percent, 20);
        assert_eq!(pool.auto_disable_threshold.min_attempts, 10);
    }

    #[test]
    fn test_proxy_pool_serialization_includes_auto_disable_threshold() {
        let pool = ProxyPool::default();
        let json = serde_json::to_string(&pool).unwrap();
        assert!(json.contains("autoDisableThreshold"));
        assert!(json.contains("successRatePercent"));
        assert!(json.contains("minAttempts"));
    }
