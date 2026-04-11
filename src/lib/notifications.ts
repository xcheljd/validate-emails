import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
} from '@tauri-apps/plugin-notification';

/**
 * Shared helper that sends a notification via Tauri's notification plugin,
 * falling back to the browser's Web Notification API if Tauri is unavailable.
 */
async function showNotification(title: string, body: string): Promise<void> {
  try {
    const hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      await requestPermission();
    }
    await tauriSendNotification({
      title,
      body,
      icon: '/vite.svg',
    });
  } catch (error) {
    console.error('Failed to send notification:', error);
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: '/vite.svg',
          });
        }
      }
    } catch (fallbackError) {
      console.error('Fallback notification also failed:', fallbackError);
    }
  }
}

export async function notifyValidationComplete(
  total: number,
  safeCount: number,
  riskyCount: number
) {
  await showNotification(
    'Validation Complete',
    `Finished ${total} emails. Safe: ${safeCount}, Risky: ${riskyCount}`
  );
}

export async function notifyError(message: string) {
  await showNotification('Error', message);
}

export async function notifySessionSaved(sessionName: string) {
  await showNotification(
    'Session Saved',
    `Validation session "${sessionName}" has been saved.`
  );
}
