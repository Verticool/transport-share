/**
 * Звук оповещения.
 *
 * Синтезируется на месте (WebAudio), а не берётся файлом: короткий «чпок» из двух тонов не стоит
 * мегабайта в сборке и не требует загрузки ассета. Тихо игнорируется там, где звук недоступен
 * (нет WebAudio, вкладка без пользовательского действия, звук выключен в настройках).
 */
const SOUND_PREFERENCE_KEY = 'dvizh:notify-sound';
const PREFERENCE_VERSION = '1';

export function notifySoundEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(SOUND_PREFERENCE_KEY);
    return raw === null ? PREFERENCE_VERSION === '1' : raw === PREFERENCE_VERSION;
  } catch {
    return true;
  }
}

export function setNotifySoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? PREFERENCE_VERSION : '0');
  } catch {
    // Недоступное хранилище не должно мешать работе: настройка просто не сохранится.
  }
}

/** Короткий звук «чпок»: два тона с быстрым затуханием. */
export function playNotifySound(): void {
  if (!notifySoundEnabled()) {
    return;
  }
  // Звук — украшение: там, где WebAudio нет (jsdom, старый браузер, запрет автозапуска),
  // оповещение всё равно должно показаться, поэтому любые сбои здесь глушим.
  if (typeof window.AudioContext === 'undefined') {
    return;
  }

  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return;
  }
  const now = context.currentTime;

  const play = (frequency: number, startAt: number, duration: number): void => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    // Быстрая атака и затухание: иначе звук получается резким и длинным.
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  };

  play(880, now, 0.08);
  play(1320, now + 0.07, 0.1);

  window.setTimeout(() => {
    void context.close();
  }, 400);
}
