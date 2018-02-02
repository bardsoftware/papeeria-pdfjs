// Copyright (C) 2018 BarD Software s.r.o
// Author: Dmitry Barashev (dbarashev@bardsoftware.com)
//
// Interfaces required from PDFJS for the document loading. They are directly mapped
// to corresponding PDFJS classes.
export interface PdfJsPromise<T> {
  then(onSuccess: (data: T) => void, onError: (error: any) => void);
}

export interface PdfJsViewport {
  width: number;
  height: number;
  rotation: number;
  clone(scale: number, rotation: number): PdfJsViewport;
}

export interface PdfJsPage {
  getViewport(scale: number): PdfJsViewport;
}

export interface PdfJsDocument {
  url: string;
  numPages: number;
  getPage(pageNumber: number): PdfJsPromise<PdfJsPage>;
}

export interface PdfJsApi {
  disableStream: boolean;
  getDocument(source: string | Uint8Array): PdfJsPromise<PdfJsDocument>;
}

export enum RenderingState {
  INITIAL = 0,
  RUNNING = 1,
  PAUSED = 2,
  FINISHED = 3
}

// View, representing PDF page of the document.
export interface PDFPageView {
  id: number;
  // Page's div wrapper.
  div: HTMLElement;
  // Actual view's PDF page.
  pdfPage: PDF.PDFPageProxy;
  // Indicates status of rendering.
  renderingState: RenderingState;

  new(options: any): PDFPageView;

  destroy(): void;

  // Sets needed PDF page to the view.
  setPdfPage(pdfPage: PDF.PDFPageProxy): void;

  // Draws page's canvas and text layers.
  draw(): PDF.PDFPromise<undefined>;

  // Transforms page view into needed scale and rotation.
  update(scale: number, rotation?: number): void;

  // Updates text layers' position.
  updatePosition(): void;

  // Continues rendering, e.g., after it was paused.
  resume(): void;
}

