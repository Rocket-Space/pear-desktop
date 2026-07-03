import { createSignal, createEffect } from 'solid-js';
import { render } from 'solid-js/web';

import { defaultConfig } from '@/config/defaults';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';

import { DownloadButton } from './templates/download';
import { DownloadManagerPanel, type DownloadItem } from './templates/download-manager-panel';

import type { DownloaderPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

let download: () => void;

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

let buttonContainer: HTMLDivElement | null = null;
let managerContainer: HTMLDivElement | null = null;

// Manager State Signals
const [isOpen, setIsOpen] = createSignal(false);
const [downloads, setDownloads] = createSignal<DownloadItem[]>([]);
const [maxParallel, setMaxParallel] = createSignal(1);
const [visibleCount, setVisibleCount] = createSignal(50);

const menuObserver = new MutationObserver(() => {
  const menu = getSongMenu();

  if (
    !menu ||
    menu.contains(buttonContainer) ||
    !(isMusicOrVideoTrack() || isAlbumOrPlaylist()) ||
    !buttonContainer
  ) {
    return;
  }

  menu.prepend(buttonContainer);
});

export const onRendererLoad = ({
  ipc,
}: RendererContext<DownloaderPluginConfig>) => {
  download = () => {
    const songMenu = getSongMenu();

    let videoUrl = songMenu
      ?.querySelector(
        'ytmusic-menu-navigation-item-renderer[tabindex="0"] #navigation-endpoint',
      )
      ?.getAttribute('href');

    if (!videoUrl && songMenu) {
      for (const it of songMenu.querySelectorAll(
        'ytmusic-menu-navigation-item-renderer[tabindex="-1"] #navigation-endpoint',
      )) {
        if (it.getAttribute('href')?.includes('podcast/')) {
          videoUrl = it.getAttribute('href');
          break;
        }
      }
    }

    if (videoUrl) {
      if (videoUrl.startsWith('watch?')) {
        videoUrl = defaultConfig.url + '/' + videoUrl;
      }

      if (videoUrl.startsWith('podcast/')) {
        videoUrl =
          defaultConfig.url + '/watch?' + videoUrl.replace('podcast/', 'v=');
      }

      if (videoUrl.includes('?playlist=')) {
        ipc.invoke('download-playlist-request', videoUrl);
        return;
      }
    } else {
      videoUrl = getSongInfo().url || window.location.href;
    }

    ipc.invoke('download-song', videoUrl);
  };

  ipc.on('downloader-feedback', (feedback: string) => {
    const targetHtml = feedback || t('plugins.downloader.templates.button');
    setDownloadButtonText(targetHtml);
  });

  // Handle updates from backend download queue
  ipc.on('downloader-queue-update', (queue: DownloadItem[], completed: number, parallel: number) => {
    setDownloads(queue);
    setMaxParallel(parallel);
  });

  ipc.on('downloader-progress-update', (updatedItem: Partial<DownloadItem> & { id: string }) => {
    setDownloads((prev) =>
      prev.map((item) =>
        item.id === updatedItem.id ? { ...item, ...updatedItem } : item
      )
    );
  });

  // Setup manager component mount and integration
  const setupManagerUI = () => {
    const rightContent = document.querySelector('#right-content');
    if (!rightContent || document.getElementById('downloader-manager-root')) return;

    managerContainer = document.createElement('div');
    managerContainer.id = 'downloader-manager-root';
    managerContainer.className = 'download-manager-btn-container';

    const activeDownloadsCount = () => downloads().filter(d => d.status === 'downloading' || d.status === 'waiting').length;
    const completedCount = () => downloads().filter(d => d.status === 'done').length;
    const totalCount = () => downloads().length;

    render(
      () => (
        <>
          <button
            class="download-manager-nav-btn"
            onClick={() => setIsOpen(!isOpen())}
            title="Gestor de Descargas"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
            </svg>
            {activeDownloadsCount() > 0 && (
              <span class="download-manager-badge">{activeDownloadsCount()}</span>
            )}
          </button>
          <DownloadManagerPanel
            isOpen={isOpen()}
            onClose={() => setIsOpen(false)}
            downloads={downloads()}
            completedCount={completedCount()}
            totalCount={totalCount()}
            maxParallel={maxParallel()}
            onSetMaxParallel={(n) => {
              setMaxParallel(n);
              ipc.invoke('downloader-set-max-parallel', n);
            }}
            onCancelAll={() => {
              ipc.invoke('downloader-cancel-all');
            }}
            onRetry={(id, title, artist) => {
              ipc.invoke('downloader-retry', { id, title, artist });
            }}
            visibleCount={visibleCount()}
            onLoadMore={() => setVisibleCount((prev) => prev + 50)}
          />
        </>
      ),
      managerContainer,
    );

    rightContent.prepend(managerContainer);
  };

  // Keep observing and ensuring navbar button is prepended
  const navBarObserver = new MutationObserver(() => {
    setupManagerUI();
  });

  navBarObserver.observe(document.body, { childList: true, subtree: true });
  setTimeout(setupManagerUI, 1000);
};

export const onPlayerApiReady = () => {
  setDownloadButtonText(t('plugins.downloader.templates.button'));

  buttonContainer = document.createElement('div');
  buttonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  buttonContainer.setAttribute('aria-disabled', 'false');
  buttonContainer.setAttribute('aria-selected', 'false');
  buttonContainer.setAttribute('role', 'option');
  buttonContainer.setAttribute('tabindex', '-1');

  render(
    () => <DownloadButton onClick={download} text={downloadButtonText()} />,
    buttonContainer,
  );

  menuObserver.observe(document.querySelector('ytmusic-popup-container')!, {
    childList: true,
    subtree: true,
  });
};
