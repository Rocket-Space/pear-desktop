import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type BrowserWindow } from 'electron';
import filenamify from 'filenamify';
import is from 'electron-is';

import { t } from '@/i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadItemStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  status: DownloadItemStatus;
  progress: number;
  currentProvider: string;
  currentAttempt: number;
  totalProviderAttempts: number;
  error?: string;
  playlistFolder?: string;
  trackId?: string;
  isPlaylist: boolean;
  fileName?: string;
}

export interface PendingDownload {
  url: string;
  title: string;
  artist: string;
  playlistFolder?: string;
  trackId?: string;
  isPlaylist: boolean;
  downloadFolder: string;
  fileExtension: string;
}

export interface DownloadManagerState {
  queue: DownloadItem[];
  activeCount: number;
  maxConcurrent: number;
  isPaused: boolean;
  totalCompleted: number;
  totalFailed: number;
  totalSkipped: number;
  pendingCount: number;
}

export type DownloadFunction = (
  item: DownloadItem,
  onProgress: (progress: number, provider: string, attempt: number) => void,
) => Promise<void>;

// ─── Providers ───────────────────────────────────────────────────────────────

const PROVIDERS = ['YTMUSIC', 'ANDROID', 'TV_EMBEDDED'] as const;
const MAX_RETRIES_PER_PROVIDER = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('v');
  } catch {
    return null;
  }
}

function generateFilename(
  artist: string,
  title: string,
  ext: string,
): string {
  const name = `${artist ? `${artist} - ` : ''}${title}`;
  let filename = filenamify(`${name}.${ext}`, {
    replacement: '_',
    maxLength: 255,
  });
  if (!is.macOS()) {
    filename = filename.normalize('NFC');
  }
  return filename;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class DownloadManagerEngine {
  // Wave system: pending pool holds ALL playlist songs, queue holds current wave
  private pendingPool: PendingDownload[] = [];
  private queue: DownloadItem[] = [];
  private completedItems: DownloadItem[] = [];
  private failedItems: DownloadItem[] = [];
  private activeDownloads = 0;
  private maxConcurrent = 1;
  private isPaused = false;
  private downloadFn: DownloadFunction | null = null;
  private win: BrowserWindow | null = null;
  private idCounter = 0;
  private _isProcessingQueue = false;

  // Duplicate tracking by video ID
  private knownVideoIds: Set<string> = new Set();

  // Wave config
  private readonly WAVE_SIZE = 100;
  private readonly WAVE_THRESHOLD = 10;

  // Stats
  private totalCompleted = 0;
  private totalFailed = 0;
  private totalSkipped = 0;

  setWindow(win: BrowserWindow): void {
    this.win = win;
  }

  setDownloadFunction(fn: DownloadFunction): void {
    this.downloadFn = fn;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, Math.min(5, max));
    this.broadcastState();
    this.processQueue();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * Add a single song to the download queue (immediate, not wave-based)
   */
  addToQueue(params: PendingDownload): string {
    const videoId = extractVideoId(params.url);

    // Duplicate check
    if (videoId && this.knownVideoIds.has(videoId)) {
      return ''; // Already known
    }

    const filename = generateFilename(
      params.artist,
      params.title,
      params.fileExtension,
    );
    const dir = params.playlistFolder || params.downloadFolder;
    const filePath = join(dir, filename);

    // File exists check
    if (existsSync(filePath)) {
      if (videoId) this.knownVideoIds.add(videoId);
      const id = this.nextId();
      const item: DownloadItem = {
        id,
        url: params.url,
        title: params.title,
        artist: params.artist,
        status: 'skipped',
        progress: 100,
        currentProvider: '',
        currentAttempt: 0,
        totalProviderAttempts: 0,
        playlistFolder: params.playlistFolder,
        trackId: params.trackId,
        isPlaylist: params.isPlaylist,
        fileName: filename,
      };
      this.totalSkipped++;
      this.completedItems.unshift(item);
      if (this.completedItems.length > 100) {
        this.completedItems = this.completedItems.slice(0, 100);
      }
      this.broadcastState();
      return id;
    }

    if (videoId) this.knownVideoIds.add(videoId);
    const id = this.nextId();
    const item: DownloadItem = {
      id,
      url: params.url,
      title: params.title,
      artist: params.artist,
      status: 'queued',
      progress: 0,
      currentProvider: '',
      currentAttempt: 0,
      totalProviderAttempts: 0,
      playlistFolder: params.playlistFolder,
      trackId: params.trackId,
      isPlaylist: params.isPlaylist,
      fileName: filename,
    };

    this.queue.push(item);
    this.broadcastState();
    this.processQueue();
    return id;
  }

  /**
   * Add a batch of songs to the pending pool (wave-based loading for playlists).
   * Only loads the first wave immediately; subsequent waves load as previous ones finish.
   */
  addBatchToPendingPool(items: PendingDownload[]): void {
    for (const item of items) {
      const videoId = extractVideoId(item.url);

      // Skip duplicates
      if (videoId && this.knownVideoIds.has(videoId)) {
        this.totalSkipped++;
        continue;
      }

      // Skip already downloaded files
      const filename = generateFilename(
        item.artist,
        item.title,
        item.fileExtension,
      );
      const dir = item.playlistFolder || item.downloadFolder;
      const filePath = join(dir, filename);

      if (existsSync(filePath)) {
        if (videoId) this.knownVideoIds.add(videoId);
        this.totalSkipped++;
        continue;
      }

      if (videoId) this.knownVideoIds.add(videoId);
      this.pendingPool.push(item);
    }

    this.broadcastState();
    this.loadNextWave();
  }

  /**
   * Retry all failed downloads
   */
  retryFailed(): void {
    const failed = [...this.failedItems];
    this.failedItems = [];
    this.totalFailed -= failed.length;

    for (const item of failed) {
      item.status = 'queued';
      item.progress = 0;
      item.currentProvider = '';
      item.currentAttempt = 0;
      item.totalProviderAttempts = 0;
      item.error = undefined;
      this.queue.push(item);
    }

    this.broadcastState();
    this.processQueue();
  }

  retrySingle(itemId: string): void {
    const idx = this.failedItems.findIndex((i) => i.id === itemId);
    if (idx === -1) return;

    const [item] = this.failedItems.splice(idx, 1);
    this.totalFailed--;

    item.status = 'queued';
    item.progress = 0;
    item.currentProvider = '';
    item.currentAttempt = 0;
    item.totalProviderAttempts = 0;
    item.error = undefined;

    this.queue.push(item);
    this.broadcastState();
    this.processQueue();
  }

  removeFailed(itemId: string): void {
    const idx = this.failedItems.findIndex((i) => i.id === itemId);
    if (idx !== -1) {
      this.failedItems.splice(idx, 1);
      this.totalFailed--;
      this.broadcastState();
    }
  }

  clearCompleted(): void {
    this.completedItems = [];
    this.broadcastState();
  }

  pauseAll(): void {
    this.isPaused = true;
    this.broadcastState();
  }

  resumeAll(): void {
    this.isPaused = false;
    this.broadcastState();
    // Force re-trigger queue processing
    setTimeout(() => this.processQueue(), 50);
  }

  getState(): DownloadManagerState {
    return {
      queue: [
        ...this.queue,
        ...this.failedItems,
        ...this.completedItems,
      ],
      activeCount: this.activeDownloads,
      maxConcurrent: this.maxConcurrent,
      isPaused: this.isPaused,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalSkipped: this.totalSkipped,
      pendingCount: this.pendingPool.length,
    };
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeDownloads;
  }

  getFailedCount(): number {
    return this.failedItems.length;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private nextId(): string {
    return `dl-${++this.idCounter}-${Date.now()}`;
  }

  /**
   * Load the next wave of songs from pending pool into the active queue.
   */
  private loadNextWave(): void {
    if (this.pendingPool.length === 0) return;

    const queuedCount = this.queue.filter((i) => i.status === 'queued').length;
    // Only load if queue is running low
    if (queuedCount > this.WAVE_THRESHOLD && this.queue.length > 0) return;

    const batch = this.pendingPool.splice(0, this.WAVE_SIZE);
    console.log(
      `[DownloadManager] Loading wave: ${batch.length} songs (${this.pendingPool.length} remaining in pool)`,
    );

    for (const pending of batch) {
      const id = this.nextId();
      const filename = generateFilename(
        pending.artist,
        pending.title,
        pending.fileExtension,
      );
      const item: DownloadItem = {
        id,
        url: pending.url,
        title: pending.title,
        artist: pending.artist,
        status: 'queued',
        progress: 0,
        currentProvider: '',
        currentAttempt: 0,
        totalProviderAttempts: 0,
        playlistFolder: pending.playlistFolder,
        trackId: pending.trackId,
        isPlaylist: pending.isPlaylist,
        fileName: filename,
      };
      this.queue.push(item);
    }

    this.broadcastState();
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isPaused) return;
    if (!this.downloadFn) return;
    // Prevent re-entry if we're currently processing (staggering)
    if (this._isProcessingQueue) return;
    this._isProcessingQueue = true;

    try {
      // Check if we need to load the next wave
      const queuedCount = this.queue.filter((i) => i.status === 'queued').length;
      if (
        queuedCount <= this.WAVE_THRESHOLD &&
        this.pendingPool.length > 0
      ) {
        this.loadNextWave();
      }

      while (
        this.activeDownloads < this.maxConcurrent &&
        !this.isPaused
      ) {
        const item = this.queue.find((i) => i.status === 'queued');
        if (!item) break;

        item.status = 'downloading';
        this.activeDownloads++;
        this.broadcastState();
        this.broadcastItemUpdate(item);

        // Start download in background
        this.executeDownload(item).catch((err) => {
          console.error(
            '[DownloadManager] Fatal error in download execution:',
            err,
          );
        });

        // Stagger: wait a bit before starting the next one to avoid
        // hammering the API/network concurrently which causes stalls
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      this.updateProgressBar();
    } finally {
      this._isProcessingQueue = false;
    }
  }

  private async executeDownload(item: DownloadItem): Promise<void> {
    let lastError: string | undefined;

    for (const provider of PROVIDERS) {
      for (
        let attempt = 1;
        attempt <= MAX_RETRIES_PER_PROVIDER;
        attempt++
      ) {
        item.currentProvider = provider;
        item.currentAttempt = attempt;
        item.totalProviderAttempts++;
        this.broadcastItemUpdate(item);

        try {
          const downloadItem = { ...item, currentProvider: provider };
          await this.downloadFn!(downloadItem, (progress, prov, att) => {
            item.progress = progress;
            item.currentProvider = prov;
            item.currentAttempt = att;
            this.broadcastItemUpdate(item);
            this.updateProgressBar();
          });

          // Success
          item.status = 'completed';
          item.progress = 100;
          this.totalCompleted++;
          this.activeDownloads--;

          this.removeFromQueue(item.id);
          this.completedItems.unshift(item);
          if (this.completedItems.length > 100) {
            this.completedItems = this.completedItems.slice(0, 100);
          }

          this.broadcastState();
          this.broadcastItemUpdate(item);
          this.processQueue();
          return;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : String(error);
          console.warn(
            `[DownloadManager] Attempt ${attempt}/${MAX_RETRIES_PER_PROVIDER} for provider ${provider} failed:`,
            lastError,
          );
        }
      }
    }

    // All retries exhausted
    item.status = 'failed';
    item.error =
      lastError ??
      t('plugins.downloader.backend.dialog.error.message');
    this.totalFailed++;
    this.activeDownloads--;

    this.removeFromQueue(item.id);
    this.failedItems.push(item);

    this.broadcastState();
    this.broadcastItemUpdate(item);
    this.processQueue();
  }

  private removeFromQueue(id: string): void {
    const idx = this.queue.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }

  private broadcastState(): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('download-manager-state', this.getState());
    } catch {
      // Window might be closed
    }
  }

  private broadcastItemUpdate(item: DownloadItem): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('download-manager-item-update', item);
    } catch {
      // Window might be closed
    }
  }

  private updateProgressBar(): void {
    if (!this.win || this.win.isDestroyed()) return;

    const downloadingItems = this.queue.filter(
      (i) => i.status === 'downloading',
    );
    if (downloadingItems.length === 0) {
      this.win.setProgressBar(-1);
      return;
    }

    const totalProgress =
      downloadingItems.reduce((sum, i) => sum + i.progress, 0) /
      downloadingItems.length /
      100;

    this.win.setProgressBar(Math.max(0, Math.min(1, totalProgress)));
  }
}

// Singleton instance
export const downloadManager = new DownloadManagerEngine();
