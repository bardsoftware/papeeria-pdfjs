// Copyright (C) 2017 BarD Software s.r.o
// Author: Dmitry Barashev (dbarashev@bardsoftware.com)
/// <amd-dependency path="pdf.combined" name="PdfJsModule"/>
/// <amd-dependency path="pdfjs-web/ui_utils" name="PdfJsUtils"/>
/// <reference path="../../papeeria-global.d.ts"/>
import {PdfJsApi, PdfJsDocument, PdfJsPage, PDFPageView, RenderingState} from "./PdfJsApi";
import {
  ASYNC_PULL_STRATEGY, DocumentTask, Loader, PageViewAppender, Queue,
  QueuePullStrategy
} from "./PdfJsDocumentLoader";

declare const PdfJsModule: any;
declare const PdfJsUtils: any;
const pdfjs: PdfJsApi = PdfJsModule;

// Properties of a visible page.
// This is a formal type definition of the structure returned from
// ui_utils.js::getVisibleElements
interface PagePosition {
  id: number;
  // Percentage of visibility.
  percent: number;
  view: PDFPageView;
  // Position relatively to other pages.
  x: number;
  y: number;
}

// A range of pages currently visible in the viewport.
interface VisiblePagesRange {
  // Array of visible pages. By default, it's sorted by page number.
  views: List<PagePosition>;
  // The first and the last pages in the range.
  first: PagePosition;
  last: PagePosition;
}

// Scroll position and direction.
// This is a formal type definition of the structure returned from
// ui_utils.js::watchScroll
interface Scroll {
  // This flag shows scroll's direction. Indicates true if last movement was down.
  down?: boolean;
  // Scroll offset in the scrollable viewport.
  lastY: number;
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

// This class is responsible for storing current value of zoom factor and recalculating it
// in response to user actions.
class Zoom {
  // Preset zoom scales from 25% to 400%
  static readonly ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 4.0];
  // scaling mode, one of the constants listed above
  private mode: ZoomingMode = ZoomingMode.FIT_PAGE;
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
  factor(page: PdfJsPage, container: JQuery): number {
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

  getMode(): ZoomingMode {
    return this.mode;
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

export interface PageMapValue {
  id: number;
}

// Provides map interface with values going in the key sort order, similar to SortedMap in Java.
export class PageMap<T extends PageMapValue> {
  private id2page: {
    [key: number]: T;
  } = {};
  private length: number = 0;

  put(page: T) {
    if (!this.id2page[page.id]) {
      this.length++;
    }
    this.id2page[page.id] = page;
  }

  get(id: number): T | undefined {
    return this.id2page[id];
  }

  values(): List<T> {
    if (Object.values) {
      // As claimed in the docs [1] if keys are numeric then values are returned in keys sort order
      // [1] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_objects/Object/values
      return Object.values(this.id2page);
    }
    // This should be the case for IE.
    const keys = Object.keys(this.id2page).sort();
    const values: MutableList<T> = [];
    keys.map(key => values.push(this.id2page[key]));
    return values;
  }

  clear() {
    this.id2page = {};
    this.length = 0;
  }

  size() {
    return this.length;
  }
}

export type ScrollType = "PAGE" | "OFFSET";

export class PageDimensions {
  constructor(readonly width: number, readonly height: number, readonly zoomFactor: number) {}
  equals(that: PageDimensions): boolean {
    if (this.zoomFactor === that.zoomFactor && this.zoomFactor > 0) {
      return true;
    }
    if (this.zoomFactor === that.zoomFactor) {
      return this.height === that.height && this.width === that.width;
    }
    return false;
  }
}

export class PdfJsViewer {
  loadedPages: PageMap<PDFPageView> = new PageMap();
  currentPage: number = 1;
  currentScroll: Scroll;

  // Some magic to handle weird touchpad events which send delta exceeding the threshold a few times in a row.
  // Dynamic threshold basically cuts some scrolling events depending on the scroll delta value.
  // Effective threshold will grow and shrink by THRESHOLD_FACTOR as it is hit,
  // so that once we get delta=0.25 and decide to scroll, the next threshold will be twice bigger.
  private effectiveThreshold: number = THRESHOLD_INITIAL;
  private readonly zoom = new Zoom();
  private readonly queue;
  private readonly pageReady = new CallbacksList();
  // Flag indicating if we're in the process of page rendering.
  // We ignore some events when flag is on.
  private isRendering = false;
  private readonly pageViewAppender: PageViewAppender;

  constructor(private readonly jqRoot: JQuery,
              private readonly alert: Alert,
              private readonly logger: Logger,
              private readonly utils: Utils,
              private readonly i18n: I18N,
              private readonly dataSource: DataSource = DEFAULT_DATA_SOURCE,
              readonly queuePullStrategy: QueuePullStrategy = ASYNC_PULL_STRATEGY) {
    this.currentScroll = PdfJsUtils.watchScroll(this.getRootElement()[0], this.scrollUpdate);
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
    this.pageViewAppender = new PageViewAppender(jqRoot);
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

  private getDimensions(): PageDimensions {
    const root = this.getRootElement();
    const zoomFactor = () => {
      switch (this.zoom.getMode()) {
        case ZoomingMode.FIT_PAGE:
          return -1;
        case ZoomingMode.FIT_WIDTH:
          return -2;
        case ZoomingMode.PRESET:
          return this.zoom.current();
      }
    };
    return new PageDimensions(root.width(), root.height(), zoomFactor());
  }

  // Schedules a new page open task. If queue is empty, the task is executed immediately, otherwise it is
  // added to the queue and waits until the current task completes.
  public showAll(documentTask: DocumentTask) {
    documentTask.pageDimensions = this.getDimensions();
    this.queue.push(documentTask);
  }

  // This method completes current task. It pulls the queue if queue is not empty, otherwise it
  // shows error message if defined. Thus, should any step of task processing fail, we'll show error unless
  // we have more tasks.
  private processTask(task: DocumentTask) {
    const onDocumentSuccess = (pdf: PdfJsDocument) => {
      if (this.currentPage > pdf.numPages) {
        this.currentPage = pdf.numPages;
      }

      if (task.pageDimensionsChanged) {
        this.resetCanvas();
      }
    };
    const onDocumentFailure = (error: string) => {
      if (error) {
        this.logger.error(`Failed to render document, got error:${error}`);
        this.alert.show(this.i18n.text("js.pdfjs.failure.document", error));
      }
    };
    const self = this;
    const viewerApi = {
      alertError: self.alert.show,
      logError: self.logger.error,
      stopRendering: () => self.stopRendering(),
      startRendering: () => self.startRendering(),
      getZoomFactor: (page: PdfJsPage) => {
        return self.zoom.factor(page, self.jqRoot);
      },
      getPageView: (pageNum: number) => self.findPageView(pageNum),
      putPageView: (pageView: PDFPageView) => self.loadedPages.put(pageView)
    };

    const loader = new Loader(pdfjs, viewerApi, this.pageViewAppender, task);
    this.dataSource(task.url)
        .then(document => {
          if (document) {
            this.logger.error(`Loading ${task.url}`);
            loader.loadDocument(document).then(onDocumentSuccess, onDocumentFailure);
          }
        })
        .fail(() => {
          task.complete();
        });
  }

  private renderPage(pageView: PDFPageView): void {
    const state = pageView.renderingState;
    switch (state) {
      case RenderingState.FINISHED:
        break;
      case RenderingState.PAUSED:
        pageView.resume();
        break;
      case RenderingState.RUNNING:
        break;
      case RenderingState.INITIAL:
        const onDrawSuccess = () => {
          this.positionCanvas(pageView.id);
          this.pageReady.invoke();
          this.stopRendering();
        };
        const onDrawFailure = (error: string) => {
          this.stopRendering();
          if (error !== "cancelled") {
            this.logger.error(`Failed to render page ${pageView.id}, got error:${error}`);
          }
        };
        pageView.draw().then(onDrawSuccess, onDrawFailure);
        break;
    }
  }

  private positionCanvas(pageNumber: number) {
    const parent = $(`#pageContainer${pageNumber}`, this.jqRoot);
    const parentWidth = parent.innerWidth();
    if (parentWidth < this.jqRoot.width()) {
      // If page container fits into the scrollable viewport horizontally then we
      // set its width to 100% so that canvasWrapper was centered.
      // However, if page container (that is, canvasWrapper and canvas) is wider than
      // scrollable area then we have a horizontal scroll and we should leave its width as is, because
      // otherwise 100% == visible viewport width and something is skewed, \
      // either canvas or text layer.
      parent.css("width", "100%");
    }
    const canvas = parent.find(".canvasWrapper");
    if (canvas.length === 0) {
      this.logger.error(`Page ${pageNumber} can't be positioned because it doesn't exist. 
          We have only ${$(".page").length} pages`);
      return;
    }

    if (parentWidth < this.jqRoot.width()) {
      canvas.css("width", `${parentWidth}px`);
    } else {
      canvas.css("width", "100%");
    }
    canvas.removeClass("hide");
    if (parentWidth < this.jqRoot.width() && canvas.height() < this.jqRoot.height()) {
      canvas.addClass("shadow");
    } else {
      canvas.removeClass("shadow");
    }
    // Here we move text layer so that it was a child of canvasWrapper rather than its sibling.
    // This way it will be aligned with canvas.
    const textLayer = parent.find(".textLayer");
    textLayer.remove().appendTo(canvas);
  }

  public restoreScroll(type: ScrollType) {
    if (type === "PAGE") {
      this.showPage(this.currentPage);
    } else {
      this.getRootElement().scrollTop(this.currentScroll.lastY);
    }
    this.scrollUpdate(this.currentScroll);
  }

  public resetCanvas() {
    for (const page of this.loadedPages.values()) {
      page.destroy();
    }
    this.loadedPages.clear();
    this.jqRoot.empty();
    this.queue.clear();
  }

  private showPage(pageNumber: number) {
    const pageView = this.findPageView(pageNumber);
    if (pageView) {
      pageView.div.scrollIntoView();
      this.currentScroll = {lastY: this.getRootElement().scrollTop()};
    }
  }

  private findPageView(pageNumber: number): PDFPageView | undefined {
    const lastTask = this.queue.getLastCompleted();
    if (!lastTask) {
      return undefined;
    }
    const boundPnum = Math.min(pageNumber, lastTask.totalPages || 1);
    return this.loadedPages.get(boundPnum);
  }

  private getCurrentVisiblePages(): VisiblePagesRange | undefined {
    if (this.loadedPages.size() > 0) {
      return PdfJsUtils.getVisibleElements(this.getRootElement()[0], this.loadedPages.values(), false);
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
    this.zoom.onResize();
    const lastTask = this.queue.getLastCompleted();
    if (lastTask) {
      const viewer = this;
      this.showAll({
        targetId: lastTask.targetId,
        modificationTs: lastTask.modificationTs,
        url: lastTask.url,
        complete: function () {
          viewer.restoreScroll("PAGE");
        }
      });
    }
  }

  private onZoomChange() {
    const lastTask = this.queue.getLastCompleted();
    if (lastTask) {
      this.queue.clear();
      const viewer = this;
      this.showAll({
        targetId: lastTask.targetId,
        modificationTs: lastTask.modificationTs,
        url: lastTask.url,
        complete: function () {
          viewer.restoreScroll("PAGE");
        }
      });
    }
  }

  // Scroll triggers this function, when is moved.
  scrollUpdate = (state: Scroll) => {
    const visible = this.getCurrentVisiblePages();
    if (visible) {
      let firstNearlyVisible = -1;
      for (const page of visible.views) {
        if (page.percent > 75 && firstNearlyVisible === -1) {
          firstNearlyVisible = page.id;
        }
        this.renderPage(page.view);
      }
      this.currentPage = firstNearlyVisible === -1 ? this.currentPage : firstNearlyVisible;
      this.currentScroll = state;
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
