/// <amd-dependency path="pdf.combined" name="PdfJsModule"/>
/// <amd-dependency path="pdfjs-web/pdf_page_view" name="PDFPageView"/>
/// <amd-dependency path="pdfjs-web/text_layer_builder" name="TextLayerBuilder"/>
/// <amd-dependency path="pdfjs-web/ui_utils" name="PdfJsUtils"/>

let PdfJsModule: any;
let pdfjs: PDF.PDFJSStatic = PdfJsModule;
let PDFPageView, TextLayerBuilder, PdfJsUtils: any;

interface PDFPageViewStatic {
  id: number;
  div: HTMLElement;
  pdfPage: PDF.PDFPageProxy;

  new(options: any): PDFPageViewStatic;

  destroy(): void;

  setPdfPage(pdfPage: PDF.PDFPageProxy): void;

  draw(): any;

  update(scale: number, rotation?: number): void;

  updatePosition(): void;
}

// Interfaces for communication with other components
// Logger logs message without attracting user attention
interface Logger {
  error(msg: string);
}

// Alert shows message to the user
interface Alert {
  show(msg: string)
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
  private mode?: ZoomingMode = undefined;
  // Index of one of the preset scales. Used when mode is PRESET
  private idxPresetScale = 0;
  // Dynamically calculated scale which is used when mode is FIT*
  private fittingScale?: number = undefined;

  // Returns currently used scale in percents for display purposes
  current(): number {
    return Math.round(100 * (
      this.mode == ZoomingMode.PRESET ? Zoom.ZOOM_FACTORS[this.idxPresetScale] : this.fittingScale || 1));
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
        let viewport = page.getViewport(1);
        if (this.mode === ZoomingMode.FIT_WIDTH) {
          // leave some space for the scrollbar
          this.fittingScale = (container.width() - 30) / viewport.width;
        } else {
          // leave some padding
          const scaleHeight = (container.height() - 30) / viewport.height;
          const scaleWidth = (container.width() - 30) / viewport.width;
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
  };

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

interface PageTask {
  // URL of the PDF document
  url: string;
  // Page which should be displayed
  page: number;
  // Calculated flag which indicates whether we're showing the contents of absolutely new file
  // TODO: we probably need to remove it
  isNewFile: boolean;
  // Flag indicating if container size has changed
  isResize: boolean;
  // Identifier of the shown PDF file
  mainFileId: string | undefined;
  // Function which is called on task completion
  complete: () => void;
}

// This is a queue of file open requests. Normally it consists of just a single task which is immediately executed,
// however, sometimes two or three tasks may be enqueued. Tasks come from: compile events from the channel;
// resize events from the layout and scrolling events from the viewer itself.
class Queue {
  // We keep a reference to the last completed task to be able to skip tasks which need no re-rendering
  lastCompleted: PageTask | undefined;

  // task queue
  private tasks: PageTask[] = [];

  // Pushes a new task which requests showing the given page of file from the given url. If the last task has the
  // same url, page and isResize flag then new task is ignored. In case when queue is empty, the last task is the
  // last completed one.
  // Task is removed from the queue when it completes. Calling complete() is a must, no matter if task was
  // successful or not
  push(url: string, page: number, isResize: boolean, mainFileId?: string) {
    let isNewFile = true;
    const lastTask = this.isEmpty() ? this.lastCompleted : this.tasks[this.tasks.length - 1];
    if (lastTask) {
      // Ignore task if it is exactly the same as the last one
      if (lastTask.url == url && lastTask.page == page && lastTask.isResize == isResize) {
        return;
      }
      // If urls are different then we're showing a new file and need more cleanup
      isNewFile = (lastTask.mainFileId != mainFileId);
    }
    const task: PageTask = {
      url: url,
      page: page,
      isNewFile: isNewFile,
      isResize: isResize,
      mainFileId: mainFileId,
      complete: () => {
        this.tasks.shift();
        // This will make the last completed task not resize; thus new resize task will be scheduled even if the
        // last completed was resize as well
        task.isResize = false;
        this.lastCompleted = task;
      }
    };
    this.tasks.push(task);
  }

  pull(): PageTask {
    if (this.isEmpty()) {
      throw new Error("Task queue is expected to be non-empty in pull()");
    }
    return this.tasks[0];
  }

  isEmpty(): boolean {
    return this.tasks.length === 0;
  }

  clear() {
    this.lastCompleted = undefined;
    this.tasks = [];
  }
}

const THRESHOLD_INITIAL = 0.25;
const THRESHOLD_FACTOR = 2;
const CALMDOWN_TIMEOUT_MS = 150;

// Borrowed from http://stackoverflow.com/questions/5527601/normalizing-mousewheel-speed-across-browsers
function normalize_mousewheel(e: JQueryMouseEventObject): number {
  let o = e.originalEvent as MouseWheelEvent;
  let w = o.wheelDelta;
  let n = 225;
  let n1 = n - 1;

  let detail = o.detail;
  // Normalize delta
  let delta = (!detail) ? w / 120 : (w && w / detail != 0) ? detail / (w / detail) : -detail / 1.35;
  if (Math.abs(delta) > 1) {
    // Quadratic scale if |d| > 1
    delta = (delta > 0 ? 1 : -1) * (Math.pow(delta, 2) + n1) / n;
  }
  // Delta *should* not be greater than 2...
  return -Math.min(Math.max(delta / 2, -1), 1);
}

type Callback = (...args) => void;

class CallbacksList {
  private readonly callbacks: Callback[] = [];

  add(cb: Callback) {
    this.callbacks.push(cb);
  }

  invoke(...args) {
    const context = this;
    for (let cb of this.callbacks) {
      cb.apply(context, args);
    }
  }
}

export class PdfJsViewer {

  static getPresetScales(): number[] {
    return Zoom.ZOOM_FACTORS;
  }

  // These are from pdfjs library
  loadedPages: PDFPageViewStatic[] = [];
  currentFile?: PDF.PDFDocumentProxy;
  currentFileUrl?: string;
  currentPage: number = 0;
  currentTask: PageTask | undefined;

  // Some magic to handle weird touchpad events which send delta exceeding the threshold a few times in a row.
  // Dynamic threshold basically cuts some scrolling events depending on the scroll delta value.
  // Effective threshold will grow and shrink by THRESHOLD_FACTOR as it is hit,
  // so that once we get delta=0.25 and decide to scroll, the next threshold will be twice bigger.
  private effectiveThreshold: number = THRESHOLD_INITIAL;

  private readonly zoom = new Zoom();
  private readonly queue = new Queue();
  private readonly pageReady = new CallbacksList();
  private readonly textLayerFactory = {
    createTextLayerBuilder: function (div: any, page: any, viewport: any) {
      return new TextLayerBuilder.TextLayerBuilder({
        textLayerDiv: div,
        pageIndex: page,
        viewport: viewport
      })
    }
  };
  // Flag indicating if we're in the process of page rendering.
  // We ignore some events when flag is on.
  private isRendering = false;

  constructor(private readonly jqRoot: JQuery,
              private readonly alert: Alert,
              private readonly logger: Logger,
              private readonly utils: Utils,
              private readonly i18n: I18N) {
    this.zoom.setFitting(ZoomingMode.FIT_PAGE);
    jqRoot.unbind("wheel.pdfjs").bind("wheel.pdfjs", (e) => {
      if (this.isRendering) {
        return;
      }
      let originalEvent = e.originalEvent as MouseEvent;
      if (originalEvent.ctrlKey || originalEvent.metaKey) {
        this.processEvent(e, this.zoomIn, this.zoomOut);
      }
    });
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
  public show(url: string, page: number, isResize: boolean = false, mainFileId?: string) {
    const isEmpty = this.queue.isEmpty();
    this.queue.push(url, page, isResize, mainFileId);
    if (isEmpty) {
      this.completeTaskAndPullQueue(undefined);
    }
  }

  public showAll(url: string, isResize: boolean = false) {
    pdfjs.getDocument(url).then((pdf) => {
      for (let i = 1; i <= pdf.numPages; i++) {
        this.show(url, i, isResize);
      }
    })
  }

  // This method completes current task. It pulls the queue if queue is not empty, otherwise it
  // shows error message if defined. Thus, should any step of task processing fail, we'll show error unless
  // we have more tasks.
  private completeTaskAndPullQueue(errorMessage?: string) {
    if (this.currentTask) {
      this.currentTask.complete();
    }
    this.currentTask = undefined;
    if (this.queue.isEmpty()) {
      if (errorMessage) {
        this.alert.show(errorMessage);
      }
    } else {
      let task = this.queue.pull();
      if (task.isNewFile) {
        this.currentFile = undefined;
        this.zoom.onResize();
      }
      this.currentTask = task;
      const onDocumentSuccess = (pdf) => {
        this.currentFile = pdf;
        this.currentFileUrl = task.url;
        if (this.currentPage > pdf.numPages) {
          this.currentPage = pdf.numPages;
        }
        this.openPage(pdf, task.page);
      };

      const onDocumentFailure = (error: string) => {
        this.logger.error(`Failed to fetch url=${task.url}, got error:${error}`);
        this.stopRendering();
        this.completeTaskAndPullQueue(this.i18n.text("js.pdfjs.failure.document", error));
      };
      this.startRendering();
      pdfjs.getDocument(task.url).then(onDocumentSuccess, onDocumentFailure);
    }
  }

  private openPage(pdfFile: any, pageNumber: number) {
    const onPageSuccess = (page: any) => {
      if (!this.currentTask) {
        return false;
      }
      if (this.currentTask.isResize) {
        this.resetPage();
      }
      let scale = this.zoom.factor(page, this.jqRoot);
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
      const onDrawSuccess = () => {
        this.positionCanvas(pageNumber);
        this.pageReady.invoke();
        this.stopRendering();
        this.completeTaskAndPullQueue(undefined)
      };
      const onDrawFailure = (error: string) => {
        this.stopRendering();
        this.logger.error(`Failed to render page ${pageNumber} from url=${pdfFile.url}, got error:${error}`);
        this.completeTaskAndPullQueue(this.i18n.text("js.pdfjs.failure.page_render", pageNumber, error))
      };
      pageView.draw().then(onDrawSuccess, onDrawFailure)
    };
    const onPageFailure = (error: string) => {
      this.stopRendering();
      this.logger.error(`Failed to fetch page ${pageNumber} from url=${pdfFile.url}, got error:${error}`);
      this.completeTaskAndPullQueue(this.i18n.text("js.pdfjs.failure.page_get", pageNumber, error))
    };
    pdfFile.getPage(pageNumber).then(onPageSuccess, onPageFailure);
    return true
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
    if (canvas.height() < this.jqRoot.height()) {
      canvas.css("top", `${(this.jqRoot.height()) / 2 - (canvas.height() / 2)}px`);
    } else {
      canvas.css("top", "0px");
    }
    if (canvas.width() < this.jqRoot.width() && canvas.height() < this.jqRoot.height()) {
      canvas.addClass("shadow");
    }
    else {
      canvas.removeClass("shadow");
    }
    const canvasOffset = canvas.position();
    const textLayer = parent.find(".textLayer");
    textLayer.css({
      top: canvasOffset.top + this.jqRoot.scrollTop(),
      left: canvasOffset.left + this.jqRoot.scrollLeft()
    });
  }

  resetCanvas() {
    for (let page of this.loadedPages) {
      page.destroy();
    }
    this.loadedPages = [];
    this.jqRoot.empty();
    this.queue.clear();
    this.currentFile = undefined;
    this.currentFileUrl = undefined;
  }

  public showPage(pageNumber: number) {
    if (this.currentFile === undefined) {
      return;
    }
    let pageView = this.findPageView(pageNumber);
    if (pageView) {
      pageView.div.scrollIntoView();
    }
  }

  private findPageView(pageNumber: number): PDFPageViewStatic | undefined {
    if (!this.currentFile) {
      return undefined;
    }
    if (pageNumber > this.currentFile.numPages) {
      pageNumber = this.currentFile.numPages;
    }
    return this.loadedPages.filter(x => x.id === pageNumber)[0];
  }

  private resetPage() {
    if (this.currentPage !== undefined) {
      this.zoom.onResize();
    }
  }

  addOnPageReady(callback: any) {
    this.pageReady.add(callback);
  }

  getRootElement(): JQuery {
    return this.jqRoot;
  }

  onResize() {
    if (this.currentFile && this.currentFileUrl) {
      this.showAll(this.currentFileUrl, true);
    }
  }

  pageUp = () => {
    if (this.currentPage > 1) {
      this.currentPage -= 1;
      this.showPage(this.currentPage);
    }
  };

  pageDown = () => {
    if (this.currentFile && this.currentPage < this.currentFile.numPages) {
      this.currentPage += 1;
      this.showPage(this.currentPage);
    }
  };

  getCurrentPage(): number | undefined {
    return this.currentPage;
  }

  getZoomScale(): number {
    return this.zoom.current();
  }

  // Toolbar button handlers
  zoomIn = () => {
    if (this.currentFileUrl) {
      this.zoom.zoomIn() && this.showAll(this.currentFileUrl, true);
    }
  };

  zoomOut = () => {
    if (this.currentFileUrl) {
      this.zoom.zoomOut() && this.showAll(this.currentFileUrl, true);
    }
  };

  zoomWidth = () => {
    this.zoom.setFitting(ZoomingMode.FIT_WIDTH);
    if (this.currentFileUrl) {
      this.showAll(this.currentFileUrl, true);
    }
  };

  zoomPage = () => {
    this.zoom.setFitting(ZoomingMode.FIT_PAGE);
    if (this.currentFileUrl) {
      this.showAll(this.currentFileUrl, true);
    }
  };

  zoomPreset(scale: number) {
    this.zoom.setPreset(scale);
    if (this.currentFileUrl) {
      this.showAll(this.currentFileUrl, true);
    }
  }
}