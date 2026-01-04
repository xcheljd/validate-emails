export async function notifyValidationComplete(total: number, safeCount: number, riskyCount: number) {
  if (!("Notification" in window)) return;

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

export async function notifyError(message: string) {
  if (!("Notification" in window)) return;

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

export async function notifySessionSaved(sessionName: string) {
  if (!("Notification" in window)) return;

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
