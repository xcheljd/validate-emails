use crate::proxy::{add_proxies_inner, clear_proxies_inner, get_proxy_status_inner, ProxyPool};

#[tokio::test]
async fn test_tauri_command_logic_inner() {
    let pool = ProxyPool::new();

    // 1. Add proxies
    let add_res = add_proxies_inner(
        &pool,
        vec!["1.1.1.1:80".to_string(), "2.2.2.2:80".to_string()]
    ).await.unwrap();
    assert_eq!(add_res, "Added 2 proxies");

    // 2. Check status
    let status = get_proxy_status_inner(&pool).await.unwrap();
    assert_eq!(status.total_proxies, 2);

    // 3. Clear proxies
    let clear_res = clear_proxies_inner(&pool).await.unwrap();
    assert_eq!(clear_res, "Proxies cleared");

    let status_after = get_proxy_status_inner(&pool).await.unwrap();
    assert_eq!(status_after.total_proxies, 0);
}

#[tokio::test]
async fn test_proxy_pool_integration_with_mock_reporting() {
    let pool = ProxyPool::new();
    pool.add_proxies(vec!["127.0.0.1:8080".to_string()]).await;
    let proxy = pool.get_next_proxy().await.unwrap();

    // Simulate reporting from an "external" process
    pool.report_success(&proxy).await;
    
    let stats = pool.get_stats().await;
    assert_eq!(stats.success_rate, 100.0);
    assert_eq!(stats.total_proxies, 1);
}

#[tokio::test]
#[ignore] // Ignored by default as it requires actual network/proxy access
async fn test_live_proxy_connectivity_check() {
    let pool = ProxyPool::new();
    // In a real scenario, the user would provide a live proxy here.
    pool.add_proxies(vec!["some-live-proxy:port".to_string()]).await;
    let proxy = pool.get_next_proxy().await.unwrap();
    
    // Example logic for checking connectivity
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(proxy.to_string()).unwrap())
        .build()
        .unwrap();
        
    let res = client.get("https://google.com").send().await;
    assert!(res.is_ok());
}
