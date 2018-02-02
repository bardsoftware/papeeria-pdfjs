// Copyright (C) 2018 BarD Software s.r.o
// Author: Dmitry Barashev (dbarashev@bardsoftware.com)
//
// Implements processes of document queueing and loading into the viewer.
/// <amd-dependency path="pdfjs-web/pdf_page_view" name="PDFPageView"/>
/// <amd-dependency path="pdfjs-web/text_layer_builder" name="TextLayerBuilder"/>

import {PdfJsApi, PdfJsDocument, PdfJsPage, PdfJsPromise, PDFPageView} from "./PdfJsApi";
import {PageDimensions} from "./PdfJsViewer";

declare const PDFPageView, TextLayerBuilder: any;

export interface DocumentTask {
  readonly url: string;
  readonly modificationTs: number;
  readonly targetId: string;
  totalPages?: number;
  pageDimensions?: PageDimensions;
  pageDimensionsChanged?: boolean;
  dataChanged?: boolean;
  complete(): void;
}

export type QueuePullStrategy = Consumer<Callable>;
export const ASYNC_PULL_STRATEGY = fxnPull => window.setTimeout(fxnPull, 0);
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
    if (!newTask.pageDimensions) {
      return;
    }
    const lastTask = this.isEmpty() ? this.lastCompleted : this.tasks[this.tasks.length - 1];

    const pageDimensionsChanged: boolean = !lastTask
        || !lastTask.pageDimensions
        || !lastTask.pageDimensions.equals(newTask.pageDimensions);
    const dataChanged: boolean = !lastTask
        || lastTask.url !== newTask.url
        || lastTask.modificationTs !== newTask.modificationTs;
    const takeNew = pageDimensionsChanged || dataChanged;
    if (!takeNew) {
      return;
    }

    const task: DocumentTask = {
      url: newTask.url,
      pageDimensions: newTask.pageDimensions,
      pageDimensionsChanged: pageDimensionsChanged,
      dataChanged: dataChanged,
      targetId: newTask.targetId,
      modificationTs: newTask.modificationTs,
      complete: () => {
        newTask.complete();
        this.tasks.shift();
        this.lastCompleted = task;
        this.pull();
      }
    };

    if (!this.isEmpty()) {
      this.tasks.pop();
    }
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
    this.tasks = [];
  }

  getLastCompleted(): DocumentTask | undefined {
    return this.lastCompleted;
  }
}

// Interface for communication with the wrapping viewer
export interface ViewerApi {
  // Show user-visible error
  alertError(msg: string): void;

  // Log error message
  logError(msg: string): void;

  // Notify viewer that rendering started or completed.
  stopRendering(): void;

  startRendering(): void;

  // Returns zoom factor of a given page
  getZoomFactor(page: PdfJsPage): number;

  // Find page view by page number
  getPageView(pageNumber: number): PDFPageView | undefined;

  // Put page view into the map
  putPageView(pageView: PDFPageView): void;

}

// This class inserts page view elements into appropriate places in the viewer scrollable area.
// Since page construction requests are issued asynchronously, the order of DOM elements creation
// may not be the same as the order of pages. Code in PDFJS just appends new elements to the
// root container which makes the page order mixed and some pages not shown.
// This class provides a replacement for appendChild method which is only used by PDFJS.
// See code in pdf_page_view.js::PDFPageView
export class PageViewAppender {
  constructor(private readonly root: JQuery) {}
  appendChild(pageViewDiv: Element) {
    const jqPagView = $(pageViewDiv);
    const pageNum = jqPagView.data("page-number");
    let anchor: JQuery = $();
    for (let lowerNum = pageNum - 1; anchor.length === 0 && lowerNum > 0; lowerNum--) {
      anchor = this.root.find(`#pageContainer${lowerNum}`);
    }
    if (anchor.length === 1) {
      anchor.after(pageViewDiv);
    } else {
      this.root.prepend(pageViewDiv);
    }
  }
}

const TEXT_LAYER_FACTORY = {
  createTextLayerBuilder: (div: any, page: any, viewport: any) =>
    new TextLayerBuilder.TextLayerBuilder({
      textLayerDiv: div,
      pageIndex: page,
      viewport: viewport
    })
};
// This class controls the process of loading document and its pages.
// The result of its work is a sequence of DIV elements inserted into the scrollable
// view and PDFPageView objects inserted into a map in the wrapping viewer.
// Rendering of page contents on the divs happens later in the wrapping viewer.
export class Loader {
  constructor(private readonly pdfjs: PdfJsApi,
              private readonly viewerApi: ViewerApi,
              private readonly pageViewAppender: PageViewAppender,
              private readonly currentTask: DocumentTask) {}

  loadDocument(document: Uint8Array | string): PdfJsPromise<PdfJsDocument> {
    const onAllPagesAlways = () => {
      this.currentTask.complete();
      this.viewerApi.stopRendering();
    };

    const onAllPagesFailure = error => {
      onAllPagesAlways();
      if (error) {
        this.viewerApi.alertError(error);
      }
      this.viewerApi.logError(`Failed to render document, got error:${error}`);
    };

    const onDocumentSuccess = (pdf: PdfJsDocument) => {
      let waiting = pdf.numPages;
      for (let i = 1; i <= pdf.numPages; i++) {
        const promise = this.openPage(pdf, i);
        promise.then(() => {
          if (waiting > 0) {
            waiting--;
            if (waiting === 0) {
              onAllPagesAlways();
            }
          }
        }, error => {
          onAllPagesFailure(error);
          waiting = -1;
        });
      }
      this.currentTask.totalPages = pdf.numPages;
    };

    this.viewerApi.startRendering();
    const result = (typeof document === "string")
        ? this.pdfjs.getDocument(document as string)
        : this.pdfjs.getDocument(document as Uint8Array);

    result.then(onDocumentSuccess, onAllPagesAlways);
    return result;
  }

  private openPage(pdfFile: PdfJsDocument, pageNumber: number): PdfJsPromise<PdfJsPage> {
    const onPageSuccess = (page: PdfJsPage) => {
      if (!this.currentTask) {
        return false;
      }
      const scale = this.viewerApi.getZoomFactor(page);
      let pageView;
      if (this.currentTask.pageDimensionsChanged) {
        pageView = new PDFPageView.PDFPageView({
          container: this.pageViewAppender,
          id: pageNumber,
          scale: scale,
          defaultViewport: page.getViewport(1),
          textLayerFactory: TEXT_LAYER_FACTORY
        });
        this.viewerApi.putPageView(pageView);
        pageView.setPdfPage(page);
      } else if (this.currentTask.dataChanged) {
        pageView = this.viewerApi.getPageView(pageNumber);
        if (pageView) {
          pageView.setPdfPage(page);
        }
      }
      if (pageView) {
        pageView.update(scale);
      }
    };
    const onPageFailure = (error: string) => {
      this.viewerApi.logError(`Failed to fetch page ${pageNumber} from url=${pdfFile.url}, got error:${error}`);
    };
    const result = pdfFile.getPage(pageNumber);
    result.then(onPageSuccess, onPageFailure);
    return result;
  }
}
