import { createAudioPlayer, type AudioPlayer } from "expo-audio";

let sendPlayer: AudioPlayer | null = null;
let receivePlayer: AudioPlayer | null = null;

function play(player: AudioPlayer): void {
  try {
    player.seekTo(0);
    player.play();
  } catch {
    // audio unavailable (autoplay policy etc.) — never break the app for a blip
  }
}

export function playSend(): void {
  sendPlayer ??= createAudioPlayer(require("../../assets/sounds/send.wav"));
  play(sendPlayer);
}

let lastReceive = 0;
export function playReceive(): void {
  // Debounce bursts (backfills, multi-part messages).
  if (Date.now() - lastReceive < 1500) return;
  lastReceive = Date.now();
  receivePlayer ??= createAudioPlayer(require("../../assets/sounds/receive.wav"));
  play(receivePlayer);
}
