/**
 * Notification sound cue.
 *
 * The notification bell / store slice calls `playNotificationSound()` when a new
 * notification arrives. It reads the user's preference synchronously from
 * `localStorage['hermes-commander.notify.sound']` (default `true`) so it never needs to
 * wait on the backend, and plays a short two-tone chime.
 *
 * The audio is a real MP3 file (a short two-tone chime, renamed
 * to `hermes-commander-notify.mp3`) served from `/sounds/`. We use an `Audio` element
 * rather than WebAudio oscillators because it is far more reliable under the
 * browser autoplay policy and produces a pleasant, consistent chime.
 *
 * Autoplay policy: browsers block audio that isn't triggered by a user gesture.
 * We create the Audio element lazily and wrap playback in a try/catch so a
 * blocked context fails silently instead of throwing.
 */

const STORAGE_KEY = 'hermes-commander.notify.sound';
const SOUND_URL = '/sounds/hermes-commander-notify.mp3';

let audioEl: HTMLAudioElement | null = null;

function getAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!audioEl) {
    audioEl = new Audio(SOUND_URL);
    audioEl.preload = 'auto';
  }
  return audioEl;
}

/** True when the user has sound enabled (defaults to true). */
export function isNotificationSoundEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return true;
  return raw !== 'false';
}

/**
 * Play the notification chime. No-op (silent) when sound is disabled or the
 * browser blocks audio. Never throws.
 */
export function playNotificationSound(): void {
  if (!isNotificationSoundEnabled()) return;
  try {
    const audio = getAudioElement();
    if (!audio) return;
    // Rewind so rapid successive notifications restart the chime.
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay blocked or file unavailable — fail silently.
    });
  } catch {
    // Autoplay blocked or audio unavailable — fail silently.
  }
}
