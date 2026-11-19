import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { appState } from '../state.js';
import { closeSessionIfFileMissing } from '../session-close.js';
import { destroySearchBar } from './search-bar.js';
import { createFileEditor, type FileEditorHandle } from './code-editor.js';
import { isAbsolutePath, dirname, samePath } from '../../shared/platform.js';
import { estimateTokens, TOKEN_COUNT_MAX_CHARS } from '../../shared/token-estimate.js';
import { pathToFileURL } from '../file-url.js';

interface FileReaderInstance {
  element: HTMLElement;
  filePath: string;
  resolvedPath: string | null;
  loaded: boolean;
  targetLine?: number;
  viewMode: 'raw' | 'rendered';
  kind: 'text' | 'image';
  unsupported: boolean;
  rawContent?: string;
  imageDataUrl?: string;
  editor?: FileEditorHandle | null;
  dirty: boolean;
  saveBtn?: HTMLButtonElement | null;
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkd|mdx)$/i.test(filePath);
}

function isImageFile(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(filePath);
}

function isHtmlFile(filePath: string): boolean {
  return /\.(html?|xhtml)$/i.test(filePath);
}

const instances = new Map<string, FileReaderInstance>();
let unwatchFileChanged: (() => void) | null = null;

export function renderMarkdownContent(content: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-reader-markdown';
  const rawHtml = marked.parse(content, { async: false }) as string;
  wrapper.innerHTML = DOMPurify.sanitize(rawHtml);
  return wrapper;
}

function renderImageContent(dataUrl: string, filePath: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-reader-image-container';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = filePath;
  wrapper.appendChild(img);
  return wrapper;
}

function renderBody(instance: FileReaderInstance): void {
  const body = instance.element.querySelector('.file-reader-body')!;
  // Preserve text selection if user is selecting
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && body.contains(sel.anchorNode)) {
    return;
  }
  if (instance.kind === 'image') {
    instance.editor?.destroy();
    instance.editor = null;
    body.innerHTML = '';
    if (instance.imageDataUrl) {
      body.appendChild(renderImageContent(instance.imageDataUrl, instance.filePath));
    }
    return;
  }
  if (instance.viewMode === 'rendered') {
    instance.editor?.destroy();
    instance.editor = null;
    body.innerHTML = '';
    body.appendChild(renderMarkdownContent(instance.rawContent!));
    return;
  }
  if (instance.rawContent === undefined) {
    instance.editor?.destroy();
    instance.editor = null;
    body.innerHTML = '';
    showFileReaderMessage(body, 'Unable to preview this file');
    return;
  }
  body.innerHTML = '';
  const existing = instance.editor;
  if (existing && body.contains(existing.getView().dom)) {
    // Editor still attached — sync from disk only when clean (dirty edits win).
    if (!instance.dirty) existing.setContent(instance.rawContent);
    return;
  }
  // Editor exists but its DOM was detached (re-render/reload raced with a live
  // view) or none yet — recreate so the body always ends up with a visible editor.
  existing?.destroy();
  instance.editor = null;
  instance.editor = createFileEditor(body as HTMLElement, instance.rawContent, instance.filePath, () =>
    markDirty(instance),
  );
}

function markDirty(instance: FileReaderInstance): void {
  instance.dirty = true;
  const btn = instance.saveBtn;
  if (btn) {
    btn.disabled = false;
    btn.classList.add('dirty');
    btn.textContent = 'Save';
    btn.title = 'Unsaved changes — Ctrl+S to save';
  }
}

function resolveFilePath(instance: FileReaderInstance): string {
  const project = appState.activeProject;
  if (isAbsolutePath(instance.filePath)) return instance.filePath;
  return project ? `${project.path}/${instance.filePath}` : instance.filePath;
}

function showFileReaderMessage(body: Element, message: string): void {
  body.innerHTML = `<div class="file-reader-content"><div class="file-reader-line"><span class="file-reader-line-text">${message}</span></div></div>`;
}

async function loadFile(instance: FileReaderInstance, sessionId: string): Promise<void> {
  if (instance.loaded) return;

  const project = appState.activeProject;
  if (!project) return;

  instance.unsupported = false;
  hideTokenBadge(instance);
  instance.editor?.destroy();
  instance.editor = null;
  const body = instance.element.querySelector('.file-reader-body')!;
  showFileReaderMessage(body, 'Loading...');

  try {
    const fullPath = resolveFilePath(instance);
    if (await closeSessionIfFileMissing(sessionId, fullPath)) return;
    if (instance.kind === 'image') {
      const result = await window.rcode.fs.readImage(fullPath);
      if (!result) {
        showFileReaderMessage(body, 'Failed to load file');
        return;
      }
      instance.imageDataUrl = result.dataUrl;
      renderBody(instance);
      instance.loaded = true;
      return;
    }
    const result = await window.rcode.fs.readFile(fullPath);
    if (!result.ok) {
      showFileReaderMessage(
        body,
        result.reason === 'binary' ? 'Unable to preview this file' : 'Failed to load file',
      );
      instance.unsupported = true;
      instance.loaded = true;
      return;
    }
    instance.rawContent = result.content;
    updateTokenBadge(instance, result.content);
    renderBody(instance);
    instance.loaded = true;
    if (instance.targetLine && instance.viewMode === 'raw') {
      scrollToLine(instance);
    }
  } catch {
    showFileReaderMessage(body, 'Failed to load file');
    instance.unsupported = true;
  }
}

function getTokenBadge(instance: FileReaderInstance): HTMLElement | null {
  return instance.element.querySelector('.file-reader-token-badge');
}

function updateTokenBadge(instance: FileReaderInstance, content: string): void {
  const badge = getTokenBadge(instance);
  if (!badge) return;
  if (content.length > TOKEN_COUNT_MAX_CHARS) {
    badge.textContent = 'too large to count';
  } else {
    const count = estimateTokens(content);
    badge.textContent = `~ ${count.toLocaleString()} tokens`;
  }
  badge.style.display = '';
}

function hideTokenBadge(instance: FileReaderInstance): void {
  const badge = getTokenBadge(instance);
  if (!badge) return;
  badge.style.display = 'none';
}

function ensureFileChangedListener(): void {
  if (unwatchFileChanged) return;
  unwatchFileChanged = window.rcode.fs.onFsChange((changes) => {
    for (const change of changes) {
      for (const [sessionId, instance] of instances) {
        if (instance.resolvedPath && samePath(instance.resolvedPath, change.path) && instance.loaded && !instance.dirty) {
          // reloadFileReader -> loadFile -> closeSessionIfFileMissing handles deletes.
          reloadFileReader(sessionId);
        }
      }
    }
  });
}

export function reloadFileReader(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.loaded = false;
  loadFile(instance, sessionId);
}

export async function saveFileReader(sessionId: string): Promise<void> {
  const instance = instances.get(sessionId);
  if (!instance?.editor || !instance.dirty) return;
  if (!instance.resolvedPath) return;

  const content = instance.editor.getView().state.doc.toString();
  const btn = instance.saveBtn;
  if (btn) btn.disabled = true;
  const result = await window.rcode.fs.writeFile(instance.resolvedPath, content);
  if (result.ok) {
    instance.dirty = false;
    if (btn) {
      btn.classList.remove('dirty');
      btn.textContent = 'Save';
      btn.title = 'Save (Ctrl+S)';
    }
  } else {
    if (btn) {
      btn.disabled = false;
      btn.title = `Save failed: ${result.error ?? 'unknown error'}`;
    }
  }
}

export function createFileReaderPane(sessionId: string, filePath: string, targetLine?: number): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'file-reader-pane';
  el.dataset.sessionId = sessionId;
  el.dataset.paneKind = 'file-reader';
  el.style.display = 'none';

  // Header
  const header = document.createElement('div');
  header.className = 'file-viewer-header';

  const pathSpan = document.createElement('span');
  pathSpan.className = 'file-viewer-path';
  pathSpan.textContent = filePath;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'search-toggle-btn file-reader-save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.disabled = true;
  saveBtn.title = 'Save (Ctrl+S)';

  const tokenBadge = document.createElement('span');
  tokenBadge.className = 'file-reader-token-badge';
  tokenBadge.style.display = 'none';
  tokenBadge.title = 'Rough token estimate (provider-agnostic)';

  header.appendChild(pathSpan);
  header.appendChild(saveBtn);
  header.appendChild(tokenBadge);

  const isMd = isMarkdownFile(filePath);
  const isImage = isImageFile(filePath);
  const instance: FileReaderInstance = {
    element: el, filePath, resolvedPath: null, loaded: false, targetLine,
    viewMode: isMd ? 'rendered' : 'raw',
    kind: isImage ? 'image' : 'text',
    unsupported: false,
    dirty: false,
    saveBtn,
  };

  if (isImage) {
    saveBtn.style.display = 'none';
  }
  saveBtn.addEventListener('click', () => {
    void saveFileReader(sessionId);
  });

  if (isMd) {
    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'file-reader-view-toggle';

    const renderedBtn = document.createElement('button');
    renderedBtn.className = 'search-toggle-btn active';
    renderedBtn.textContent = 'Rendered';
    renderedBtn.title = 'Rendered Markdown';

    const rawBtn = document.createElement('button');
    rawBtn.className = 'search-toggle-btn';
    rawBtn.textContent = 'Raw';
    rawBtn.title = 'Raw Text';

    const setMode = (mode: 'raw' | 'rendered') => {
      instance.viewMode = mode;
      renderedBtn.classList.toggle('active', mode === 'rendered');
      rawBtn.classList.toggle('active', mode === 'raw');
      if (instance.rawContent !== undefined) {
        renderBody(instance);
      }
    };

    renderedBtn.addEventListener('click', () => setMode('rendered'));
    rawBtn.addEventListener('click', () => setMode('raw'));

    toggleGroup.appendChild(renderedBtn);
    toggleGroup.appendChild(rawBtn);
    header.appendChild(toggleGroup);
  }

  el.appendChild(header);

  // Scrollable body
  const body = document.createElement('div');
  body.className = 'file-reader-body';
  el.appendChild(body);

  instances.set(sessionId, instance);
}

export function destroyFileReaderPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.resolvedPath) {
    window.rcode.fs.unwatchDir(dirname(instance.resolvedPath));
  }
  destroySearchBar(sessionId);
  destroyGoToLineBar(sessionId);
  instance.editor?.destroy();
  instance.editor = null;
  instance.element.remove();
  instances.delete(sessionId);
}

export function showFileReaderPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.style.display = 'flex';
  if (isSplit) instance.element.classList.add('split');
  else instance.element.classList.remove('split');

  // Watch the parent directory (not the file inode) so atomic save/replace —
  // which swaps the inode and would kill a direct file watch — is still caught.
  if (!instance.resolvedPath) {
    const fullPath = resolveFilePath(instance);
    instance.resolvedPath = fullPath;
    ensureFileChangedListener();
    window.rcode.fs.watchDir(dirname(fullPath));
  }

  loadFile(instance, sessionId);
  if (instance.loaded && instance.targetLine) {
    scrollToLine(instance);
  }
}

export function setFileReaderLine(sessionId: string, line: number): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.targetLine = line;
  if (instance.loaded) {
    scrollToLine(instance);
  }
}

function scrollToLine(instance: FileReaderInstance): void {
  const line = instance.targetLine;
  if (!line) return;

  if (instance.viewMode === 'raw') {
    if (instance.editor) {
      instance.editor.scrollToLine(line);
      return;
    }
  }

  const body = instance.element.querySelector('.file-reader-body');
  if (!body) return;

  // Clear previous highlights
  body.querySelectorAll('.file-reader-line-highlight').forEach((el) => {
    el.classList.remove('file-reader-line-highlight');
  });

  const lines = body.querySelectorAll('.file-reader-line');
  const targetEl = lines[line - 1] as HTMLElement | undefined;
  if (!targetEl) return;

  targetEl.classList.add('file-reader-line-highlight');
  requestAnimationFrame(() => {
    targetEl.scrollIntoView({ block: 'center' });
  });
}

export function hideAllFileReaderPanes(): void {
  for (const instance of instances.values()) {
    instance.element.style.display = 'none';
  }
}

export function attachFileReaderToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function getFileReaderInstance(sessionId: string): FileReaderInstance | undefined {
  return instances.get(sessionId);
}

const MARKDOWN_TEXT_SELECTOR = [
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'pre', 'blockquote',
].map((tag) => `.file-reader-markdown ${tag}`).join(', ');

const RAW_TEXT_SELECTOR = '.file-reader-line-text';

export function getFileReaderTextSelector(sessionId: string): string {
  const instance = instances.get(sessionId);
  if (!instance) return RAW_TEXT_SELECTOR;
  if (instance.kind === 'image' || instance.unsupported) return '.file-reader-no-search';
  return instance.viewMode === 'rendered' ? MARKDOWN_TEXT_SELECTOR : RAW_TEXT_SELECTOR;
}

const goToLineBars = new Map<string, { bar: HTMLDivElement; input: HTMLInputElement }>();

export function showGoToLineBar(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.kind === 'image' || instance.unsupported) return;
  if (instance.viewMode === 'rendered') return;

  const existing = goToLineBars.get(sessionId);
  if (existing) {
    existing.bar.classList.remove('hidden');
    existing.input.focus();
    existing.input.select();
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'goto-line-bar';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.placeholder = 'Go to line...';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-nav-btn search-close-btn';
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close (Escape)';

  bar.appendChild(input);
  bar.appendChild(closeBtn);

  instance.element.appendChild(bar);
  goToLineBars.set(sessionId, { bar, input });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = parseInt(input.value, 10);
      if (line > 0) {
        setFileReaderLine(sessionId, line);
      }
      hideGoToLineBar(sessionId);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideGoToLineBar(sessionId);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      input.select();
    }
  });

  closeBtn.addEventListener('click', () => hideGoToLineBar(sessionId));

  input.focus();
}

export function hideGoToLineBar(sessionId: string): void {
  const entry = goToLineBars.get(sessionId);
  if (!entry) return;
  entry.bar.classList.add('hidden');
  const instance = instances.get(sessionId);
  if (instance) {
    if (instance.editor) {
      instance.editor.getView().focus();
    } else {
      (instance.element.querySelector('.file-reader-body') as HTMLElement | null)?.focus();
    }
  }
}

function destroyGoToLineBar(sessionId: string): void {
  const entry = goToLineBars.get(sessionId);
  if (!entry) return;
  entry.bar.remove();
  goToLineBars.delete(sessionId);
}
