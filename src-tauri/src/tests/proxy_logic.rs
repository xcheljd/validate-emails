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

#[tokio::test]
async fn test_proxy_pool_round_robin() {
    let pool = ProxyPool::new();
    let proxies = vec![
        "1.1.1.1:80".to_string(),
        "2.2.2.2:80".to_string(),
        "3.3.3.3:80".to_string(),
    ];
    pool.add_proxies(proxies).await;

    let p1 = pool.get_next_proxy().await.unwrap();
    assert_eq!(p1.ip, "1.1.1.1");

    let p2 = pool.get_next_proxy().await.unwrap();
    assert_eq!(p2.ip, "2.2.2.2");

    let p3 = pool.get_next_proxy().await.unwrap();
    assert_eq!(p3.ip, "3.3.3.3");

    let p4 = pool.get_next_proxy().await.unwrap();
    assert_eq!(p4.ip, "1.1.1.1");
}

#[tokio::test]
async fn test_proxy_pool_exclusion_basic() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec!["1.1.1.1:80".to_string(), "2.2.2.2:80".to_string()]).await;

    // Default order is 1 -> 2.
    // If we exclude 1, we should get 2.
    let p = pool.get_proxy_excluding(Some("1.1.1.1:80")).await.unwrap();
    assert_eq!(p.ip, "2.2.2.2");
}

#[tokio::test]
async fn test_proxy_pool_exclusion_fallback() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec!["1.1.1.1:80".to_string()]).await;

    // Only 1 proxy. Exclude it. Current logic says return it anyway as fallback.
    let p = pool.get_proxy_excluding(Some("1.1.1.1:80")).await.unwrap();
    assert_eq!(p.ip, "1.1.1.1");
}

#[tokio::test]
async fn test_proxy_pool_exclusion_skips_index() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec![
        "1.1.1.1:80".to_string(), 
        "2.2.2.2:80".to_string(), 
        "3.3.3.3:80".to_string()
    ]).await;

    // Order: 1, 2, 3
    // Call 1: Get 1.
    let p1 = pool.get_next_proxy().await.unwrap();
    assert_eq!(p1.ip, "1.1.1.1");

    // Call 2: Exclude 2. Should get 3.
    // Normal next would be 2.
    let p2 = pool.get_proxy_excluding(Some("2.2.2.2:80")).await.unwrap();
    assert_eq!(p2.ip, "3.3.3.3");

    // Call 3: Should wrap to 1.
    let p3 = pool.get_next_proxy().await.unwrap();
    assert_eq!(p3.ip, "1.1.1.1");
}

#[tokio::test]
async fn test_proxy_pool_stats_reporting() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec!["1.1.1.1:80".to_string()]).await;
    let p = pool.get_next_proxy().await.unwrap();

    pool.report_success(&p).await;
    pool.report_success(&p).await;
    pool.report_failure(&p).await;

    let stats = pool.get_stats().await;
    assert_eq!(stats.success_rate, 2.0 / 3.0 * 100.0);
}

#[tokio::test]
async fn test_proxy_pool_stats_calculation_multi() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec!["1.1.1.1:80".to_string(), "2.2.2.2:80".to_string()]).await;
    
    let p1 = pool.get_next_proxy().await.unwrap();
    let p2 = pool.get_next_proxy().await.unwrap();

    // 10 attempts for p1, all success
    for _ in 0..10 {
        pool.report_success(&p1).await;
    }

    // 10 attempts for p2, all failure
    for _ in 0..10 {
        pool.report_failure(&p2).await;
    }

    let stats = pool.get_stats().await;
    assert_eq!(stats.total_proxies, 2);
    assert_eq!(stats.success_rate, 50.0);
    assert_eq!(stats.active_proxy, Some("2.2.2.2:80".to_string()));
}

#[tokio::test]
async fn test_proxy_pool_clear() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec!["1.1.1.1:80".to_string()]).await;
    
    pool.clear().await;
    let stats = pool.get_stats().await;
    assert_eq!(stats.total_proxies, 0);
    assert_eq!(stats.active_proxy, None);
}
