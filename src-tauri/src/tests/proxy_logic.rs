use crate::proxy::{Proxy, ProxyPool};

#[test]
fn test_proxy_from_str_empty() {
    assert!(Proxy::from_str("").is_none());
}

#[test]
fn test_proxy_from_str_whitespace() {
    // Current implementation might fail or return junk if not trimmed.
    // Expectation: Should probably return None or handle it gracefully.
    // Let's assume we want it to be None for pure whitespace.
    assert!(Proxy::from_str("   ").is_none());
}

#[test]
fn test_proxy_from_str_user_only_auth() {
    // "user@ip:port" -> username="user", password=None
    let p = Proxy::from_str("user@127.0.0.1:8080").unwrap();
    assert_eq!(p.username, Some("user".to_string()));
    assert_eq!(p.password, None);
}

#[test]
fn test_proxy_from_str_just_protocol() {
    assert!(Proxy::from_str("http://").is_none());
}

#[test]
fn test_proxy_from_str_missing_port() {
    assert!(Proxy::from_str("127.0.0.1").is_none());
}

#[test]
fn test_proxy_from_str_invalid_port() {
    assert!(Proxy::from_str("127.0.0.1:99999").is_none()); // u16 overflow
    assert!(Proxy::from_str("127.0.0.1:abc").is_none());
}

#[tokio::test]
async fn test_proxy_pool_add_deduplication() {
    let pool = ProxyPool::new();
    let proxies = vec![
        "127.0.0.1:8080".to_string(),
        "127.0.0.1:8080".to_string(), // Duplicate
        "127.0.0.1:8081".to_string(),
    ];
    
    let added = pool.add_proxies(proxies).await;
    assert_eq!(added, 2);
    
    let stats = pool.get_stats().await;
    assert_eq!(stats.total_proxies, 2);
}

#[tokio::test]
async fn test_proxy_pool_add_invalid() {
    let pool = ProxyPool::new();
    let proxies = vec![
        "invalid".to_string(),
        "127.0.0.1:8080".to_string(),
    ];
    let added = pool.add_proxies(proxies).await;
    assert_eq!(added, 1);
    
    let stats = pool.get_stats().await;
    assert_eq!(stats.total_proxies, 1);
}
