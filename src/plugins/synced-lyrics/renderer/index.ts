import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { createSignal } from 'solid-js';

import { selectors, tabStates } from './utils';
import { setConfig, setCurrentTime } from './renderer';
import { fetchLyrics, currentLyrics } from './store';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { SongInfo } from '@/providers/song-info';
import type { SyncedLyricsPluginConfig } from '../types';

export let _ytAPI: MusicPlayer | null = null;
export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

// Floating lyrics state
export const [isFloatingOpen, setIsFloatingOpen] = createSignal(false);

let _ipc: RendererContext<SyncedLyricsPluginConfig>['ipc'] | null = null;
export const getIpc = () => _ipc;
let lastSentLyricsJson = '';

export const renderer = createRenderer<
  {
    observerCallback: MutationCallback;
    observer?: MutationObserver;
    videoDataChange: () => Promise<void>;
    updateTimestampInterval?: NodeJS.Timeout | string | number;
  },
  SyncedLyricsPluginConfig
>({
  onConfigChange(newConfig) {
    setConfig(newConfig);
  },

  observerCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      const header = mutation.target as HTMLElement;

      switch (mutation.attributeName) {
        case 'disabled':
          header.removeAttribute('disabled');
          break;
        case 'aria-selected':
          tabStates[header.ariaSelected ?? 'false']();
          break;
      }
    }
  },

  async onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
  },
  async videoDataChange() {
    if (!this.updateTimestampInterval) {
    this.updateTimestampInterval = setInterval(() => {
        const time = (_ytAPI?.getCurrentTime() ?? 0) * 1000;
        setCurrentTime(time);
        // Forward time to floating window
        if (isFloatingOpen() && _ipc) {
          _ipc.send('synced-lyrics:floating-time', time);
        }
      }, 100);
    }

    // prettier-ignore
    this.observer ??= new MutationObserver(this.observerCallback);
    this.observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    {
      header.removeAttribute('disabled');
      tabStates[header.ariaSelected ?? 'false']();
    }

    this.observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  },

  async start(ctx: RendererContext<SyncedLyricsPluginConfig>) {
    _ipc = ctx.ipc;
    netFetch = ctx.ipc.invoke.bind(ctx.ipc, 'synced-lyrics:fetch');

    setConfig(await ctx.getConfig());

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      fetchLyrics(info);
      // Send song info to floating window
      if (isFloatingOpen()) {
        ctx.ipc.send('synced-lyrics:floating-song', {
          title: info.title,
          artist: info.artist,
        });
      }
    });

    // Listen for floating window closed
    ctx.ipc.on('synced-lyrics:floating-closed', () => {
      setIsFloatingOpen(false);
    });

    // Watch lyrics changes and forward to floating window
    setInterval(() => {
      if (!isFloatingOpen()) return;
      const lyrics = currentLyrics();
      const json = JSON.stringify(lyrics?.data ?? null);
      if (json !== lastSentLyricsJson) {
        lastSentLyricsJson = json;
        ctx.ipc.send('synced-lyrics:floating-lyrics', lyrics?.data ?? null);
      }
    }, 250);
  },
});
