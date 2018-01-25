// Copyright (C) 2017 BarD Software s.r.o
// Author: Dmitry Barashev (dbarashev@bardsoftware.com)
/// <amd-dependency path="pdf.combined" name="PdfJsModule"/>
/// <amd-dependency path="pdfjs-web/pdf_page_view" name="PDFPageView"/>
/// <amd-dependency path="pdfjs-web/text_layer_builder" name="TextLayerBuilder"/>
/// <amd-dependency path="pdfjs-web/ui_utils" name="PdfJsUtils"/>
/// <reference path="../../papeeria-global.d.ts"/>

declare const PdfJsModule: any;
declare const PDFPageView, TextLayerBuilder, PdfJsUtils: any;
const pdfjs: PDF.PDFJSStatic = PdfJsModule;

// View, representing PDF page of the document.
interface PDFPageViewStatic {
  id: number;
  // Page's div wrapper.
  div: HTMLElement;
  // Actual view's PDF page.
  pdfPage: PDF.PDFPageProxy;
  // Indicates status of rendering.
  renderingState: RenderingStates;

  new(options: any): PDFPageViewStatic;

  destroy(): void;

  // Sets needed PDF page to the view.
  setPdfPage(pdfPage: PDF.PDFPageProxy): void;

  // Draws page's canvas and text layers.
  draw(): any;

  // Transforms page view into needed scale and rotation.
  update(scale: number, rotation?: number): void;

  // Updates text layers' position.
  updatePosition(): void;

  // Continues rendering, e.g., after it was paused.
  resume(): void;
}

// View of visible page.
interface VisiblePageStatic {
  id: number;
  // Percentage of visibility.
  percent: number;
  view: PDFPageViewStatic;
  // Position relatively to other pages.
  x: number;
  y: number;
}

// Return type of getCurrentVisiblePages() function, which represents
// user's current visible pages.
interface VisiblePagesStatic {
  // Array of visible pages. By default, it's sorted by visibility.
  views: List<VisiblePageStatic>;
  // The most and least visible pages.
  first: VisiblePageStatic;
  last: VisiblePageStatic;
}

// It's created for monitoring the scroll event.
interface Scroll {
  // This flag shows scroll's direction. Indicates true if last movement was down.
  down: boolean;
  // Displays position, where scrolling has been stopped.
  lastY: number;

  // Triggers this function, when scroll event is happened.
  _eventHandler(): void;
}

// Interfaces for communication with other components


// Logger logs message without attracting user attention
interface Logger {
  error(msg: string);
}

// Alert shows message to the user
interface Alert {
  show(msg: string);
}

// Utility to stop events
interface Utils {
  stopEvent(e: Event | undefined);
}

// Internationalization utility
interface I18N {
  text(key: string, ...args): string;
}

function fallbackRequestAnimationFrame(callback: any, element: any) {
  window.setTimeout(callback, 1000 / 60);
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.oRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    fallbackRequestAnimationFrame;
  pdfjs.disableStream = true;
}

enum ZoomingMode {
  PRESET,
  FIT_WIDTH,
  FIT_PAGE
}

enum RenderingStates {
  INITIAL = 0,
  RUNNING = 1,
  PAUSED = 2,
  FINISHED = 3
}

// This class is responsible for storing current value of zoom factor and recalculating it
// in response to user actions.
class Zoom {
  // Preset zoom scales from 25% to 400%
  static readonly ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 4.0];
  // scaling mode, one of the constants listed above
  private mode?: ZoomingMode = undefined;
  // Index of one of the preset scales. Used when mode is PRESET
  private idxPresetScale = 0;
  // Dynamically calculated scale which is used when mode is FIT*
  private fittingScale?: number = undefined;

  // Returns currently used scale in percents for display purposes
  current(): number {
    return Math.round(100 * (
      this.mode === ZoomingMode.PRESET ? Zoom.ZOOM_FACTORS[this.idxPresetScale] : this.fittingScale || 1
    ));
  }

  // Returns currently set zoom factor if preset mode is used or recalculates
  // zoom factor depending on the fitting mode and page/container size.
  factor(page: any, container: JQuery): number {
    let value: number;
    if (this.mode === ZoomingMode.PRESET) {
      value = Zoom.ZOOM_FACTORS[this.idxPresetScale];
    } else {
      if (!this.fittingScale) {
        // recalculating fitting scale
        const viewport = page.getViewport(1);
        if (this.mode === ZoomingMode.FIT_WIDTH) {
          // leave some space for the scrollbar
          this.fittingScale = (container.width() - 45) / viewport.width;
        } else {
          // leave some padding
          const scaleHeight = (container.height() - 30) / viewport.height;
          const scaleWidth = (container.width() - 45) / viewport.width;
          this.fittingScale = Math.min(scaleHeight, scaleWidth);
        }
      }
      value = this.fittingScale;
    }
    return value / PdfJsUtils.CSS_UNITS;
  }

  // Zooms in. If we already use preset then we only need to increase index. If we use fitting scale
  // then we search for the closest greater preset scale.
  zoomIn(): boolean {
    if (this.mode !== ZoomingMode.PRESET) {
      // searching for the first scale which is greater than abs(current scale)
      let newPresetScale = 0;
      if (this.fittingScale) {
        for (let i = 0; i < Zoom.ZOOM_FACTORS.length; i++) {
          if (Zoom.ZOOM_FACTORS[i] > this.fittingScale) {
            newPresetScale = i;
            break;
          }
        }
      }
      this.idxPresetScale = newPresetScale;
      this.mode = ZoomingMode.PRESET;
      return true;
    }
    if (this.idxPresetScale < Zoom.ZOOM_FACTORS.length - 1) {
      this.idxPresetScale++;
      return true;
    }
    return false;
  }

  // Zooms out. If we already use preset then we only need to decrease index. If we use fitting scale
  // then we search for the closest lesser preset scale.
  zoomOut(): boolean {
    if (this.mode !== ZoomingMode.PRESET) {
      // searching for the first scale which is greater than abs(current scale).
      // Previous scale is the one which we need.
      let newPresetScale = -1;
      if (this.fittingScale) {
        for (let i = 0; i < Zoom.ZOOM_FACTORS.length; i++) {
          if (Zoom.ZOOM_FACTORS[i] > this.fittingScale) {
            newPresetScale = i;
            break;
          }
        }
      }
      this.idxPresetScale = newPresetScale === -1 ? Zoom.ZOOM_FACTORS.length - 1 : newPresetScale - 1;
      this.mode = ZoomingMode.PRESET;
      return true;
    }
    if (this.idxPresetScale > 0) {
      this.idxPresetScale--;
      return true;
    }
    return false;
  }

  // When we resize the container div we need to recalculate fitting scale.
  onResize = () => {
    if (this.mode !== ZoomingMode.PRESET) {
      this.fittingScale = undefined;
    }
  }

  setFitting(mode: ZoomingMode.FIT_PAGE | ZoomingMode.FIT_WIDTH) {
    this.mode = mode;
    this.fittingScale = undefined;
  }

  setPreset(presetScale: number) {
    const idx = Zoom.ZOOM_FACTORS.indexOf(presetScale);
    if (idx !== -1) {
      this.idxPresetScale = idx;
      this.mode = ZoomingMode.PRESET;
    }
  }
}

export interface DocumentTask {
  readonly url: string;
  readonly modificationTs: number;
  readonly isResize: boolean;
  readonly targetId: string;
  totalPages?: number;

  complete(): void;
}

type QueuePullStrategy = Consumer<Callable>;
const ASYNC_PULL_STRATEGY = fxnPull => window.setTimeout(fxnPull, 0);
export const SYNC_PULL_STRATEGY = fxnPull => fxnPull();
// This is a queue of document rendering requests.
// Normally it consists of just a single task which is immediately executed,
// however, sometimes two or three tasks may be enqueued. Tasks come from:
// * compile events from the channel
// * resize events from the layout
// * and scrolling events from the viewer itself.
export class Queue {
  // We keep a reference to the last completed task to be able to skip tasks which need no re-rendering
  lastCompleted?: DocumentTask;

  // task queue
  private tasks: MutableList<DocumentTask> = [];

  constructor(private readonly consumer: Consumer<DocumentTask>,
              private readonly pullStrategy: QueuePullStrategy = ASYNC_PULL_STRATEGY) {}

  // Pushes a new document rendering task.
  // If the last task has the same url, page and isResize flag then new task is ignored.
  // In case when queue is empty, the last task is the last completed one.
  // Task is removed from the queue when it completes.
  // Calling complete() is a must, no matter if task was successful or not.
  push(newTask: DocumentTask) {
    if (newTask.isResize) {
      if (!this.isEmpty()) {
        const lastTask = this.tasks[this.tasks.length - 1];
        if (lastTask.isResize
            && lastTask.url === newTask.url
            && lastTask.modificationTs === newTask.modificationTs) {
          return;
        }
      }
    } else {
      const lastTask = this.isEmpty() ? this.lastCompleted : this.tasks[this.tasks.length - 1];
      if (lastTask && lastTask.url === newTask.url && lastTask.modificationTs === newTask.modificationTs) {
        return;
      }
    }
    const task: DocumentTask = {
      url: newTask.url,
      isResize: newTask.isResize,
      targetId: newTask.targetId,
      modificationTs: newTask.modificationTs,
      complete: () => {
        newTask.complete();
        this.tasks.shift();
        this.lastCompleted = task;
        this.pull();
      }
    };
    this.tasks.push(task);
    if (this.tasks.length === 1) {
      this.pull();
    }
  }

  pull() {
    this.pullStrategy(this.doPull);
  }

  doPull = () => {
    if (this.isEmpty()) {
      return;
    }
    const task = this.tasks[0];
    if (task == undefined) {
      throw new Error("Task queue is expected to be non-empty in pull()");
    }
    this.consumer(task);
  }

  isEmpty(): boolean {
    return this.tasks.length === 0;
  }

  clear() {
    this.lastCompleted = undefined;
    this.tasks = [];
  }

  getLastCompleted(): DocumentTask | undefined {
    return this.lastCompleted;
  }
}

const THRESHOLD_INITIAL = 0.25;
const THRESHOLD_FACTOR = 2;
const CALMDOWN_TIMEOUT_MS = 150;

// Borrowed from http://stackoverflow.com/questions/5527601/normalizing-mousewheel-speed-across-browsers
function normalize_mousewheel(e: JQueryMouseEventObject): number {
  const o = e.originalEvent as MouseWheelEvent;
  const w = o.wheelDelta;
  const n = 225;
  const n1 = n - 1;

  const detail = o.detail;
  // Normalize delta
  let delta = (!detail) ? w / 120 : (w && w / detail !== 0) ? detail / (w / detail) : -detail / 1.35;
  if (Math.abs(delta) > 1) {
    // Quadratic scale if |d| > 1
    delta = (delta > 0 ? 1 : -1) * (Math.pow(delta, 2) + n1) / n;
  }
  // Delta *should* not be greater than 2...
  return -Math.min(Math.max(delta / 2, -1), 1);
}

type Callback = (...args) => void;

class CallbacksList {
  private readonly callbacks: MutableList<Callback> = [];

  add(cb: Callback) {
    this.callbacks.push(cb);
  }

  invoke(...args) {
    const context = this;
    for (const cb of this.callbacks) {
      cb.apply(context, args);
    }
  }
}

// We do not use Mapping because this is public code in bardsoftware/papeeria-pdfjs repo.
export type DataSource = (url: string) => JQueryDeferred<Uint8Array | string>;

/**
 * This class caches downloaded PDF as binary array and returns the cached blob
 * if viewer requests PDF with the same URL again.
 * Currently it effectively caches only single URL (that is, the number of entries in
 * cache is unlikely to be 2), however, we may extend it in the future to allow for loading
 * PDF pages one-by-one.
 */
export class CachingDataSource {
  private readonly cache: MutableMap<Uint8Array> = {};

  public get(url: string): JQueryDeferred<Uint8Array> {
    const cached = this.cache[url];
    const deferred: JQueryDeferred<Uint8Array> = $.Deferred();
    if (cached) {
      return deferred.resolve(cached);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = this.newOnload(xhr, url, deferred);
    xhr.send();
    return deferred;
  }

  private newOnload(xhr: XMLHttpRequest, url: string, deferred: JQueryDeferred<Uint8Array>): () => any {
    return () => {
      if (xhr.status === 200) {
        const uintArray = new Uint8Array(xhr.response);
        this.cache[url] = uintArray;
        deferred.resolve(uintArray);
      } else {
        deferred.reject(xhr.status);
      }
    };
  }

  public clear(url: string) {
    delete this.cache[url];
  }
}

const DEFAULT_DATA_SOURCE = (url: string) => $.Deferred<string>().resolve(url);

export class PdfJsViewer {
  // These are from pdfjs library
  loadedPages: MutableList<PDFPageViewStatic> = [];
  // currentFile?: PDF.PDFDocumentProxy;
  // currentFileUrl?: string;
  currentPage: number = 1;
  currentTask: DocumentTask | undefined;
  scroll: Scroll = PdfJsUtils.watchScroll(this.getRootElement()[0], () => this.scrollUpdate());
  // Some magic to handle weird touchpad events which send delta exceeding the threshold a few times in a row.
  // Dynamic threshold basically cuts some scrolling events depending on the scroll delta value.
  // Effective threshold will grow and shrink by THRESHOLD_FACTOR as it is hit,
  // so that once we get delta=0.25 and decide to scroll, the next threshold will be twice bigger.
  private effectiveThreshold: number = THRESHOLD_INITIAL;
  private readonly zoom = new Zoom();
  private readonly queue;
  private readonly pageReady = new CallbacksList();
  private readonly textLayerFactory = {
    createTextLayerBuilder: function (div: any, page: any, viewport: any) {
      return new TextLayerBuilder.TextLayerBuilder({
        textLayerDiv: div,
        pageIndex: page,
        viewport: viewport
      });
    }
  };
  // Flag indicating if we're in the process of page rendering.
  // We ignore some events when flag is on.
  private isRendering = false;

  constructor(private readonly jqRoot: JQuery,
              private readonly alert: Alert,
              private readonly logger: Logger,
              private readonly utils: Utils,
              private readonly i18n: I18N,
              private readonly dataSource: DataSource = DEFAULT_DATA_SOURCE,
              readonly queuePullStrategy: QueuePullStrategy = ASYNC_PULL_STRATEGY) {
    this.queue = new Queue(task => this.processTask(task), queuePullStrategy);
    this.zoom.setFitting(ZoomingMode.FIT_PAGE);
    jqRoot.unbind("wheel.pdfjs").bind("wheel.pdfjs", e => {
      if (this.isRendering) {
        return;
      }
      const originalEvent = e.originalEvent as MouseEvent;
      if (originalEvent.ctrlKey || originalEvent.metaKey) {
        this.processEvent(e, this.zoomIn, this.zoomOut);
      }
    });
  }

  static getPresetScales(): List<number> {
    return Zoom.ZOOM_FACTORS;
  }

  private processEvent(e: JQueryMouseEventObject, negativeAction: () => void, positiveAction: () => void) {
    const delta = normalize_mousewheel(e);
    if (delta < -this.effectiveThreshold) {
      negativeAction();
      this.effectiveThreshold *= THRESHOLD_FACTOR;
    } else if (delta > this.effectiveThreshold) {
      positiveAction();
      this.effectiveThreshold *= THRESHOLD_FACTOR;
    } else {
      this.effectiveThreshold /= THRESHOLD_FACTOR;
    }
    if (this.effectiveThreshold < THRESHOLD_INITIAL) {
      this.effectiveThreshold = THRESHOLD_INITIAL;
    }
    this.utils.stopEvent(e);
  }

  private startRendering() {
    this.isRendering = true;
  }

  private stopRendering(timeoutMs: number = CALMDOWN_TIMEOUT_MS) {
    window.setTimeout(() => this.isRendering = false, timeoutMs);
  }

  isShown(): boolean {
    return this.jqRoot.find("canvas").length > 0;
  }

  // Schedules a new page open task. If queue is empty, the task is executed immediately, otherwise it is
  // added to the queue and waits until the current task completes.
  public showAll(documentTask: DocumentTask) {
    this.queue.push(documentTask);
  }

  // This method completes current task. It pulls the queue if queue is not empty, otherwise it
  // shows error message if defined. Thus, should any step of task processing fail, we'll show error unless
  // we have more tasks.
  private processTask(task: DocumentTask) {
    this.dataSource(task.url)
      .then(document => {
        if (document) {
          this.currentTask = task;
          this.loadDocument(task, document);
        }
      })
      .fail(_ => {
        task.complete();
      });
  }

  private loadDocument(task: DocumentTask, document: Uint8Array | string) {
    const onAllPagesAlways = () => {
      task.complete();
      this.stopRendering();
      this.currentTask = undefined;
    };
    const onAllPagesFailure = error => {
      onAllPagesAlways();
      if (error) {
        this.alert.show(error);
      }
      this.logger.error(`Failed to render document, got error:${error}`);
    };

    const onDocumentSuccess = pdf => {
      if (this.currentPage > pdf.numPages) {
        this.currentPage = pdf.numPages;
      }

      if (task.isResize) {
        this.zoom.onResize();
      } else {
        this.resetCanvas();
      }
      let waiting = pdf.numPages;
      for (let i = 1; i <= pdf.numPages; i++) {
        const promise = this.openPage(pdf, i);
        promise.then(() => {
          if (waiting > 0) {
            this.positionCanvas(i);
            waiting--;
            if (waiting === 0) {
              this.scrollUpdate();
              onAllPagesAlways();
            }
          }
        }, error => {
          onAllPagesFailure(error);
          waiting = -1;
        });
      }
      task.totalPages = pdf.numPages;
    };

    const onDocumentFailure = (error: string) => {
      this.logger.error(`Failed to fetch url=${task.url}, got error:${error}`);
      onAllPagesFailure(this.i18n.text("js.pdfjs.failure.document", error));
    };
    this.startRendering();
    if (typeof document === "string") {
      pdfjs.getDocument(document as string).then(onDocumentSuccess, onDocumentFailure);
    } else {
      pdfjs.getDocument(document as Uint8Array).then(onDocumentSuccess, onDocumentFailure);
    }
  }

  private openPage(pdfFile: any, pageNumber: number): PDF.PDFPromise<PDF.PDFPageProxy> {
    const onPageSuccess = (page: any) => {
      if (!this.currentTask) {
        return false;
      }
      if (this.currentTask.isResize) {
        this.resetPage();
      }
      const scale = this.zoom.factor(page, this.jqRoot);
      let pageView;
      if (this.currentTask.isResize) {
        pageView = this.findPageView(pageNumber);
      } else {
        pageView = new PDFPageView.PDFPageView({
          container: this.jqRoot.get(0),
          id: pageNumber,
          scale: scale,
          defaultViewport: page.getViewport(1),
          textLayerFactory: this.textLayerFactory
        });
        this.loadedPages.push(pageView);
        pageView.setPdfPage(page);
      }
      pageView.update(scale);
    };
    const onPageFailure = (error: string) => {
      this.logger.error(`Failed to fetch page ${pageNumber} from url=${pdfFile.url}, got error:${error}`);
    };
    const result = pdfFile.getPage(pageNumber);
    result.then(onPageSuccess, onPageFailure);
    return result;
  }

  private renderPage(pageView: PDFPageViewStatic): void {
    const state = pageView.renderingState;
    switch (state) {
      case RenderingStates.FINISHED:
        break;
      case RenderingStates.PAUSED:
        pageView.resume();
        break;
      case RenderingStates.RUNNING:
        break;
      case RenderingStates.INITIAL:
        const onDrawSuccess = () => {
          this.positionCanvas(pageView.id);
          this.pageReady.invoke();
          this.stopRendering();
        };
        const onDrawFailure = (error: string) => {
          this.stopRendering();
          this.logger.error(`Failed to render page ${pageView.id}, got error:${error}`);
          if (this.currentTask) {
            this.logger.error(`... when processing ${this.currentTask.url}`);
          }
        };
        pageView.draw().then(onDrawSuccess, onDrawFailure);
        break;
    }
  }

  private positionCanvas(pageNumber: number) {
    const parent = $(`#pageContainer${pageNumber}`, this.jqRoot);
    const canvas = parent.find(".canvasWrapper");

    canvas.removeClass("hide");
    if (canvas.width() < this.jqRoot.width()) {
      canvas.css("left", `${(this.jqRoot.width()) / 2 - (canvas.width() / 2)}px`);
    } else {
      canvas.css("left", "0px");
    }
    if (canvas.height() < parent.height()) {
      canvas.css("top", `${(parent.height()) / 2 - (canvas.height() / 2)}px`);
    } else {
      canvas.css("top", "0px");
    }
    if (canvas.width() < this.jqRoot.width() && canvas.height() < this.jqRoot.height()) {
      canvas.addClass("shadow");
    } else {
      canvas.removeClass("shadow");
    }
    const canvasOffset = canvas.position();
    const textLayer = parent.find(".textLayer");
    textLayer.css({
      top: canvasOffset.top,
      left: canvasOffset.left
    });
  }

  public resetCanvas() {
    for (const page of this.loadedPages) {
      page.destroy();
    }
    this.loadedPages = [];
    this.jqRoot.empty();
    this.queue.clear();
  }

  private showPage(pageNumber: number) {
    if (!this.queue.getLastCompleted()) {
      return;
    }
    const pageView = this.findPageView(pageNumber);
    if (pageView) {
      pageView.div.scrollIntoView();
    }
  }

  private findPageView(pageNumber: number): PDFPageViewStatic | undefined {
    const lastTask = this.queue.getLastCompleted();
    if (!lastTask) {
      return undefined;
    }
    const boundPnum = Math.min(pageNumber, lastTask.totalPages || 1);
    return this.loadedPages.filter(x => x.id === boundPnum)[0];
  }

  private resetPage() {
    if (this.currentPage !== undefined) {
      this.zoom.onResize();
    }
  }

  private getCurrentVisiblePages(): VisiblePagesStatic | undefined {
    if (this.loadedPages.length > 0) {
      return PdfJsUtils.getVisibleElements(this.getRootElement()[0], this.loadedPages, true);
    }
    return undefined;
  }

  addOnPageReady(callback: any) {
    this.pageReady.add(callback);
  }

  getRootElement(): JQuery {
    return this.jqRoot;
  }

  onResize() {
    const lastTask = this.queue.getLastCompleted();
    if (lastTask) {
      this.showAll({
        targetId: lastTask.targetId,
        modificationTs: lastTask.modificationTs,
        isResize: true,
        url: lastTask.url,
        complete: function () {
        }
      });
    }
  }

  private onZoomChange() {
    const lastTask = this.queue.getLastCompleted();
    if (lastTask) {
      this.queue.clear();
      this.showAll({
        targetId: lastTask.targetId,
        modificationTs: lastTask.modificationTs,
        isResize: false,
        url: lastTask.url,
        complete: function () {
        }
      });
    }
  }

  // Scroll triggers this function, when is moved.
  scrollUpdate() {
    const visible = this.getCurrentVisiblePages();
    if (visible) {
      this.currentPage = visible.first.id;
      for (const page of visible.views) {
        this.renderPage(page.view);
      }

      // Trying to render next or prev page
      if (this.scroll.down) {
        const nextPage = this.findPageView(visible.last.id + 1);
        if (nextPage) {
          this.renderPage(nextPage);
        }
      } else {
        const previousPage = this.findPageView(visible.first.id - 1);
        if (previousPage) {
          this.renderPage(previousPage);
        }
      }
    }
  }

  pageUp = () => {
    const lastTask = this.queue.getLastCompleted();
    if (lastTask && this.currentPage > 1) {
      this.currentPage -= 1;
      this.showPage(this.currentPage);
    }
  }

  pageDown = () => {
    const lastTask = this.queue.getLastCompleted();
    if (lastTask && this.currentPage < (lastTask.totalPages || 1)) {
      this.currentPage += 1;
      this.showPage(this.currentPage);
    }
  }

  getZoomScale(): number {
    return this.zoom.current();
  }

  // Toolbar button handlers
  zoomIn = () => {
    if (this.queue.getLastCompleted()) {
      this.zoom.zoomIn();
      this.onZoomChange();
    }
  }

  zoomOut = () => {
    if (this.queue.getLastCompleted()) {
      this.zoom.zoomOut();
      this.onZoomChange();
    }
  }

  zoomWidth = () => {
    this.zoom.setFitting(ZoomingMode.FIT_WIDTH);
    this.onZoomChange();
  }

  zoomPage = () => {
    this.zoom.setFitting(ZoomingMode.FIT_PAGE);
    this.onZoomChange();
  }

  zoomPreset(scale: number) {
    this.zoom.setPreset(scale);
    this.onZoomChange();
  }
}
