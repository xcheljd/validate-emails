import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export async function notifyValidationComplete(total: number, safeCount: number, riskyCount: number) {
  try {
    const hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      await requestPermission();
    }
    await sendNotification({
      title: 'Validation Complete',
      body: `Finished ${total} emails. Safe: ${safeCount}, Risky: ${riskyCount}`,
      icon: '/vite.svg'
    });
  } catch (error) {
    console.error("Failed to send notification:", error);
    try {
      if ("Notification" in window) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission === "granted") {
          new Notification("Validation Complete", {
            body: `Finished ${total} emails. Safe: ${safeCount}, Risky: ${riskyCount}`,
            icon: '/vite.svg'
          });
        }
      }
    } catch (fallbackError) {
      console.error("Fallback notification also failed:", fallbackError);
    }
  }
}

export async function notifyError(message: string) {
  try {
    const hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      await requestPermission();
    }
    await sendNotification({
      title: 'Error',
      body: message,
      icon: '/vite.svg'
    });
  } catch (error) {
    console.error("Failed to send notification:", error);
    try {
      if ("Notification" in window) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission === "granted") {
          new Notification("Error", {
            body: message,
            icon: '/vite.svg'
          });
        }
      }
    } catch (fallbackError) {
      console.error("Fallback notification also failed:", fallbackError);
    }
  }
}

export async function notifySessionSaved(sessionName: string) {
  try {
    const hasPermission = await isPermissionGranted();
    if (!hasPermission) {
      await requestPermission();
    }
    await sendNotification({
      title: 'Session Saved',
      body: `Validation session "${sessionName}" has been saved.`,
      icon: '/vite.svg'
    });
  } catch (error) {
    console.error("Failed to send notification:", error);
    try {
      if ("Notification" in window) {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (Notification.permission === "granted") {
          new Notification("Session Saved", {
            body: `Validation session "${sessionName}" has been saved.`,
            icon: '/vite.svg'
          });
        }
      }
    } catch (fallbackError) {
      console.error("Fallback notification also failed:", fallbackError);
    }
  }
}
