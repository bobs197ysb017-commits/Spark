let sharedAudioCtx: AudioContext | null = null;

/**
 * Plays a discreet, crystalline two-tone completion chime synthesized via Web Audio API.
 * Respects user preference and browser autoplay constraints.
 */
export function playTaskCompletionSound(enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return;

  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioContextClass();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }

    const now = sharedAudioCtx.currentTime;

    // Gentle ascending fifth + octave harmonic (F5 -> C6)
    const freqs = [698.46, 1046.5];
    freqs.forEach((freq, idx) => {
      if (!sharedAudioCtx) return;
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.085);

      gain.gain.setValueAtTime(0.0001, now + idx * 0.085);
      gain.gain.exponentialRampToValueAtTime(0.055, now + idx * 0.085 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.085 + 0.36);

      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);

      osc.start(now + idx * 0.085);
      osc.stop(now + idx * 0.085 + 0.38);
    });
  } catch {
    // Gracefully ignore if browser audio context is blocked
  }
}
