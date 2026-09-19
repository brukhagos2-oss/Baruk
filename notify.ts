"use client";

let audioCtx: AudioContext | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export function notificationState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    await registerServiceWorker();
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

export async function pushOsNotification(opts: {
  title: string;
  body: string;
  tag?: string;
  sticky?: boolean;
}) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.active) {
      reg.active.postMessage({ type: "APEX_SIGNAL", ...opts });
      return;
    }
  } catch {
    /* fall through to the classic API */
  }
  try {
    new Notification(opts.title, { body: opts.body, icon: "/icon-512.png", tag: opts.tag });
  } catch {
    /* notifications unavailable */
  }
}

/** Short synthesised alert chime — no audio asset required. */
export function playChime(kind: "signal" | "win" | "loss" = "signal") {
  if (typeof window === "undefined") return;
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const notes =
      kind === "win" ? [660, 880, 1180] : kind === "loss" ? [420, 300] : [720, 960, 1240];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.11);
      gain.gain.setValueAtTime(0.0001, now + i * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.11);
      osc.stop(now + i * 0.11 + 0.3);
    });
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.([90, 50, 90]);
    }
  } catch {
    /* audio blocked until first interaction */
  }
}
