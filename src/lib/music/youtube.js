/**
 * YouTube (and YouTube Music: the same videos) through YouTube's own embedded
 * player, which is the only official way to play it inside another app. The
 * player stays on screen in the now-playing card, as YouTube asks.
 */
let apiReady = null;

export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window.'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiReady ||= new Promise((resolve, reject) => {
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { before?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiReady = null; reject(new Error('Couldn’t reach YouTube. Check your connection.')); };
    document.head.appendChild(s);
  });
  return apiReady;
}

/** YT.PlayerState numbers */
export const STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

/** A player in `el`. handlers: { onState(state), onError(code), onReady() } */
export async function createPlayer(el, handlers, first) {
  const YT = await loadYouTubeApi();
  return new Promise((resolve) => {
    const p = new YT.Player(el, {
      width: '100%', height: '100%',
      ...(first?.id ? { videoId: first.id } : {}),
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, ...(first?.list ? { list: first.list, listType: 'playlist' } : {}) },
      events: {
        onReady: () => { handlers.onReady?.(); resolve(p); },
        onStateChange: (e) => handlers.onState?.(e.data),
        onError: (e) => handlers.onError?.(e.data),
      },
    });
  });
}

export const errorText = (code) => ({
  2: 'That link doesn’t look right.',
  5: 'YouTube couldn’t play that in here.',
  100: 'That video isn’t available any more.',
  101: 'The owner doesn’t allow that one to play outside YouTube. Try another.',
  150: 'The owner doesn’t allow that one to play outside YouTube. Try another.',
}[code] || 'YouTube couldn’t play that. Try another.');
