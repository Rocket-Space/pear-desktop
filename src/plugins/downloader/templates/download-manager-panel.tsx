import { For, Show } from 'solid-js';

export interface DownloadItem {
  id: string;
  title: string;
  artist: string;
  status: 'waiting' | 'downloading' | 'done' | 'failed' | 'cancelled';
  progress: number; // 0-100
}

interface DownloadManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  downloads: DownloadItem[];
  completedCount: number;
  totalCount: number;
  maxParallel: number;
  onSetMaxParallel: (n: number) => void;
  onCancelAll: () => void;
  onRetry: (id: string, title: string, artist: string) => void;
  visibleCount: number;
  onLoadMore: () => void;
}

export const DownloadManagerPanel = (props: DownloadManagerPanelProps) => {
  let listRef: HTMLDivElement | undefined;

  const handleScroll = () => {
    if (!listRef) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef;
    if (scrollHeight - scrollTop - clientHeight < 40) {
      props.onLoadMore();
    }
  };

  const getStatusText = (status: string, progress: number) => {
    switch (status) {
      case 'waiting': return 'En espera...';
      case 'downloading': return `Descargando (${progress}%)`;
      case 'done': return 'Completado';
      case 'failed': return 'Fallido';
      case 'cancelled': return 'Cancelado';
      default: return '';
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="download-manager-panel">
        <div class="download-manager-header">
          <h3>Gestor de Descargas</h3>
          <button class="download-manager-close-btn" onClick={props.onClose}>
            &times;
          </button>
        </div>

        <div class="download-manager-concurrency">
          <span>Descargas simultáneas:</span>
          <div class="concurrency-buttons">
            <For each={[1, 2, 3, 4, 5]}>
              {(num) => (
                <button
                  class={props.maxParallel === num ? 'active' : ''}
                  onClick={() => props.onSetMaxParallel(num)}
                >
                  {num}
                </button>
              )}
            </For>
          </div>
        </div>

        <div
          class="download-manager-list"
          ref={listRef}
          onScroll={handleScroll}
        >
          <Show when={props.downloads.length === 0}>
            <div class="empty-queue-message">No hay descargas en la lista.</div>
          </Show>
          <For each={props.downloads.slice(0, props.visibleCount)}>
            {(item) => (
              <div class={`download-item ${item.status}`}>
                <div class="download-item-info">
                  <span class="download-item-title">{item.title}</span>
                  <span class="download-item-artist">{item.artist}</span>
                </div>
                <div class="download-item-status-row">
                  <span class="download-item-status-text">
                    {getStatusText(item.status, Math.round(item.progress))}
                  </span>
                  <Show when={item.status === 'failed'}>
                    <button
                      class="retry-item-btn"
                      onClick={() => props.onRetry(item.id, item.title, item.artist)}
                    >
                      Reintentar
                    </button>
                  </Show>
                </div>
                <div class="download-item-progress-container">
                  <div
                    class="download-item-progress-bar"
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
              </div>
            )}
          </For>
          <Show when={props.downloads.length > props.visibleCount}>
            <div class="load-more-indicator" onClick={props.onLoadMore}>
              Cargar más...
            </div>
          </Show>
        </div>

        <div class="download-manager-footer">
          <div class="download-summary-text">
            {props.completedCount} / {props.totalCount} completadas
          </div>
          <Show when={props.downloads.some(d => d.status === 'waiting' || d.status === 'downloading')}>
            <button class="cancel-all-btn" onClick={props.onCancelAll}>
              Cancelar Todo
            </button>
          </Show>
        </div>
      </div>
    </Show>
  );
};
