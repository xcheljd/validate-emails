use crate::proxy::ProxyPool;
use std::sync::Arc;
use tokio::task;

#[tokio::test]
async fn test_proxy_pool_concurrent_add() {
    let pool = Arc::new(ProxyPool::new());
    let mut handles = vec![];

    // Spawn 10 tasks, each adding 10 unique proxies
    for i in 0..10 {
        let pool = Arc::clone(&pool);
        let handle = task::spawn(async move {
            let mut proxies = vec![];
            for j in 0..10 {
                proxies.push(format!("{}.{}.{}.{}:80", i, j, 0, 0));
            }
            pool.add_proxies(proxies).await;
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.await.unwrap();
    }

    let stats = pool.get_stats().await;
    assert_eq!(stats.total_proxies, 100);
}

#[tokio::test]
async fn test_proxy_pool_concurrent_rotation() {
    let pool = Arc::new(ProxyPool::new());
    pool.add_proxies(vec![
        "1.1.1.1:80".to_string(),
        "2.2.2.2:80".to_string(),
    ]).await;

    let mut handles = vec![];

    // Spawn 100 tasks, each getting the next proxy
    for _ in 0..100 {
        let pool = Arc::clone(&pool);
        let handle = task::spawn(async move {
            pool.get_next_proxy().await
        });
        handles.push(handle);
    }

    let mut results = vec![];
    for handle in handles {
        results.push(handle.await.unwrap().unwrap());
    }

    // Verify we got both proxies roughly equally (it's round robin, so exactly equally)
    let ones = results.iter().filter(|p| p.ip == "1.1.1.1").count();
    let twos = results.iter().filter(|p| p.ip == "2.2.2.2").count();

    assert_eq!(ones, 50);
    assert_eq!(twos, 50);
}

#[tokio::test]
async fn test_proxy_pool_concurrent_stats_update() {
    let pool = Arc::new(ProxyPool::new());
    pool.add_proxies(vec!["1.1.1.1:80".to_string()]).await;
    let proxy = pool.get_next_proxy().await.unwrap();
    
    let pool = Arc::new(pool);
    let mut handles = vec![];

    // 50 successes, 50 failures concurrently
    for i in 0..100 {
        let pool = Arc::clone(&pool);
        let proxy = proxy.clone();
        let handle = task::spawn(async move {
            if i % 2 == 0 {
                pool.report_success(&proxy).await;
            } else {
                pool.report_failure(&proxy).await;
            }
        });
        handles.push(handle);
    }

    for handle in handles {
        handle.await.unwrap();
    }

    let stats = pool.get_stats().await;
    assert_eq!(stats.total_proxies, 1);
    assert_eq!(stats.success_rate, 50.0);
}
