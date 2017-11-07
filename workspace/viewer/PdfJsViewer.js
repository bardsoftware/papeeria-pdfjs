define(["require", "exports", "pdf.combined", "pdfjs-web/pdf_page_view", "pdfjs-web/text_layer_builder", "pdfjs-web/ui_utils", "pdfjs-web/pdf_rendering_queue"], function (require, exports, PdfJsModule, PDFPageView, TextLayerBuilder, PdfJsUtils, RenderingQueue) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var PdfJsModule;
    var pdfjs = PdfJsModule;
    var PDFPageView, TextLayerBuilder, PdfJsUtils, RenderingQueue;
    function fallbackRequestAnimationFrame(callback, element) {
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
    var ZoomingMode;
    (function (ZoomingMode) {
        ZoomingMode[ZoomingMode["PRESET"] = 0] = "PRESET";
        ZoomingMode[ZoomingMode["FIT_WIDTH"] = 1] = "FIT_WIDTH";
        ZoomingMode[ZoomingMode["FIT_PAGE"] = 2] = "FIT_PAGE";
    })(ZoomingMode || (ZoomingMode = {}));
    var Zoom = (function () {
        function Zoom() {
            var _this = this;
            this.mode = undefined;
            this.idxPresetScale = 0;
            this.fittingScale = undefined;
            this.onResize = function () {
                if (_this.mode !== ZoomingMode.PRESET) {
                    _this.fittingScale = undefined;
                }
            };
        }
        Zoom.prototype.current = function () {
            return Math.round(100 * (this.mode == ZoomingMode.PRESET ? Zoom.ZOOM_FACTORS[this.idxPresetScale] : this.fittingScale || 1));
        };
        Zoom.prototype.factor = function (page, container) {
            var value;
            if (this.mode === ZoomingMode.PRESET) {
                value = Zoom.ZOOM_FACTORS[this.idxPresetScale];
            }
            else {
                if (!this.fittingScale) {
                    var viewport = page.getViewport(1);
                    if (this.mode === ZoomingMode.FIT_WIDTH) {
                        this.fittingScale = (container.width() - 30) / viewport.width;
                    }
                    else {
                        var scaleHeight = (container.height() - 30) / viewport.height;
                        var scaleWidth = (container.width() - 30) / viewport.width;
                        this.fittingScale = Math.min(scaleHeight, scaleWidth);
                    }
                }
                value = this.fittingScale;
            }
            return value / PdfJsUtils.CSS_UNITS;
        };
        Zoom.prototype.zoomIn = function () {
            if (this.mode !== ZoomingMode.PRESET) {
                var newPresetScale = 0;
                if (this.fittingScale) {
                    for (var i = 0; i < Zoom.ZOOM_FACTORS.length; i++) {
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
        };
        Zoom.prototype.zoomOut = function () {
            if (this.mode !== ZoomingMode.PRESET) {
                var newPresetScale = -1;
                if (this.fittingScale) {
                    for (var i = 0; i < Zoom.ZOOM_FACTORS.length; i++) {
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
        };
        Zoom.prototype.setFitting = function (mode) {
            this.mode = mode;
            this.fittingScale = undefined;
        };
        Zoom.prototype.setPreset = function (presetScale) {
            var idx = Zoom.ZOOM_FACTORS.indexOf(presetScale);
            if (idx !== -1) {
                this.idxPresetScale = idx;
                this.mode = ZoomingMode.PRESET;
            }
        };
        Zoom.ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 4.0];
        return Zoom;
    }());
    var Queue = (function () {
        function Queue() {
            this.tasks = [];
        }
        Queue.prototype.push = function (url, page, isResize, mainFileId) {
            var _this = this;
            var isNewFile = true;
            var lastTask = this.isEmpty() ? this.lastCompleted : this.tasks[this.tasks.length - 1];
            if (lastTask) {
                if (lastTask.url == url && lastTask.page == page && lastTask.isResize == isResize) {
                    return;
                }
                isNewFile = (lastTask.mainFileId != mainFileId);
            }
            var task = {
                url: url,
                page: page,
                isNewFile: isNewFile,
                isResize: isResize,
                mainFileId: mainFileId,
                complete: function () {
                    _this.tasks.shift();
                    task.isResize = false;
                    _this.lastCompleted = task;
                }
            };
            this.tasks.push(task);
        };
        Queue.prototype.pull = function () {
            if (this.isEmpty()) {
                throw new Error("Task queue is expected to be non-empty in pull()");
            }
            return this.tasks[0];
        };
        Queue.prototype.isEmpty = function () {
            return this.tasks.length === 0;
        };
        Queue.prototype.clear = function () {
            this.lastCompleted = undefined;
            this.tasks = [];
        };
        return Queue;
    }());
    var THRESHOLD_INITIAL = 0.25;
    var THRESHOLD_FACTOR = 2;
    var CALMDOWN_TIMEOUT_MS = 150;
    function normalize_mousewheel(e) {
        var o = e.originalEvent;
        var w = o.wheelDelta;
        var n = 225;
        var n1 = n - 1;
        var detail = o.detail;
        var delta = (!detail) ? w / 120 : (w && w / detail != 0) ? detail / (w / detail) : -detail / 1.35;
        if (Math.abs(delta) > 1) {
            delta = (delta > 0 ? 1 : -1) * (Math.pow(delta, 2) + n1) / n;
        }
        return -Math.min(Math.max(delta / 2, -1), 1);
    }
    var CallbacksList = (function () {
        function CallbacksList() {
            this.callbacks = [];
        }
        CallbacksList.prototype.add = function (cb) {
            this.callbacks.push(cb);
        };
        CallbacksList.prototype.invoke = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            var context = this;
            for (var _a = 0, _b = this.callbacks; _a < _b.length; _a++) {
                var cb = _b[_a];
                cb.apply(context, args);
            }
        };
        return CallbacksList;
    }());
    var PdfJsViewer = (function () {
        function PdfJsViewer(jqRoot, alert, logger, utils, i18n) {
            var _this = this;
            this.jqRoot = jqRoot;
            this.alert = alert;
            this.logger = logger;
            this.utils = utils;
            this.i18n = i18n;
            this.pdfPagesView = [];
            this.currentPage = 0;
            this.renderingQueue = new RenderingQueue.PDFRenderingQueue();
            this.scroll = PdfJsUtils.watchScroll(this.getRootElement()[0], this.scrollUpdate.bind(this));
            this.effectiveThreshold = THRESHOLD_INITIAL;
            this.zoom = new Zoom();
            this.queue = new Queue();
            this.pageReady = new CallbacksList();
            this.textLayerFactory = {
                createTextLayerBuilder: function (div, page, viewport) {
                    return new TextLayerBuilder.TextLayerBuilder({
                        textLayerDiv: div,
                        pageIndex: page,
                        viewport: viewport
                    });
                }
            };
            this.isRendering = false;
            this.pageUp = function () {
                if (_this.currentPage > 1) {
                    _this.currentPage -= 1;
                    _this.showPage(_this.currentPage);
                }
            };
            this.pageDown = function () {
                if (_this.currentFile && _this.currentPage < _this.currentFile.numPages) {
                    _this.currentPage += 1;
                    _this.showPage(_this.currentPage);
                }
            };
            this.zoomIn = function () {
                _this.zoom.zoomIn();
            };
            this.zoomOut = function () {
                _this.zoom.zoomOut();
            };
            this.zoomWidth = function () {
                _this.zoom.setFitting(ZoomingMode.FIT_WIDTH);
                _this.showPage(_this.currentPage);
            };
            this.zoomPage = function () {
                _this.zoom.setFitting(ZoomingMode.FIT_PAGE);
                _this.showPage(_this.currentPage);
            };
            this.renderingQueue.setViewer(this);
            this.zoom.setFitting(ZoomingMode.FIT_PAGE);
            jqRoot.unbind("wheel.pdfjs").bind("wheel.pdfjs", function (e) {
                if (_this.isRendering) {
                    return;
                }
                var originalEvent = e.originalEvent;
                if (originalEvent.ctrlKey || originalEvent.metaKey) {
                    _this.processEvent(e, _this.zoomIn, _this.zoomOut);
                }
            });
        }
        PdfJsViewer.getPresetScales = function () { return Zoom.ZOOM_FACTORS; };
        PdfJsViewer.prototype.processEvent = function (e, negativeAction, positiveAction) {
            var delta = normalize_mousewheel(e);
            if (delta < -this.effectiveThreshold) {
                negativeAction();
                this.effectiveThreshold *= THRESHOLD_FACTOR;
            }
            else if (delta > this.effectiveThreshold) {
                positiveAction();
                this.effectiveThreshold *= THRESHOLD_FACTOR;
            }
            else {
                this.effectiveThreshold /= THRESHOLD_FACTOR;
            }
            if (this.effectiveThreshold < THRESHOLD_INITIAL) {
                this.effectiveThreshold = THRESHOLD_INITIAL;
            }
            this.utils.stopEvent(e);
        };
        PdfJsViewer.prototype.startRendering = function () {
            this.isRendering = true;
        };
        PdfJsViewer.prototype.stopRendering = function (timeoutMs) {
            var _this = this;
            if (timeoutMs === void 0) { timeoutMs = CALMDOWN_TIMEOUT_MS; }
            window.setTimeout(function () { return _this.isRendering = false; }, timeoutMs);
        };
        PdfJsViewer.prototype.isShown = function () {
            return this.jqRoot.find("canvas").length > 0;
        };
        PdfJsViewer.prototype.show = function (url, page, isResize, mainFileId) {
            if (isResize === void 0) { isResize = false; }
            var isEmpty = this.queue.isEmpty();
            this.queue.push(url, page, isResize, mainFileId);
            if (isEmpty) {
                this.completeTaskAndPullQueue(undefined);
            }
        };
        PdfJsViewer.prototype.showAll = function (url, isResize) {
            var _this = this;
            if (isResize === void 0) { isResize = false; }
            pdfjs.getDocument(url).then(function (pdf) {
                for (var i = 1; i <= pdf.numPages; i++) {
                    _this.show(url, i, isResize);
                }
            });
        };
        PdfJsViewer.prototype.completeTaskAndPullQueue = function (errorMessage) {
            var _this = this;
            if (this.currentTask) {
                this.currentTask.complete();
            }
            this.currentTask = undefined;
            if (this.queue.isEmpty()) {
                if (errorMessage) {
                    this.alert.show(errorMessage);
                }
            }
            else {
                var task_1 = this.queue.pull();
                if (task_1.isNewFile) {
                    this.currentFile = undefined;
                    this.zoom.onResize();
                }
                this.currentTask = task_1;
                var onDocumentSuccess = function (pdf) {
                    _this.currentFile = pdf;
                    _this.currentFileUrl = task_1.url;
                    _this.openPage(pdf, _this.currentTask.page);
                };
                var onDocumentFailure = function (error) {
                    _this.logger.error("Failed to fetch url=" + task_1.url + ", got error:" + error);
                    _this.stopRendering();
                    _this.completeTaskAndPullQueue(_this.i18n.text("js.pdfjs.failure.document", error));
                };
                this.startRendering();
                pdfjs.getDocument(task_1.url).then(onDocumentSuccess, onDocumentFailure);
            }
        };
        PdfJsViewer.prototype.openPage = function (pdfFile, pageNumber) {
            var _this = this;
            var onPageSuccess = function (page) {
                if (_this.currentTask) {
                    if (_this.currentTask.isResize) {
                        _this.resetPage();
                    }
                }
                var scale = _this.zoom.factor(page, _this.jqRoot);
                var pageView = new PDFPageView.PDFPageView({
                    container: _this.jqRoot.get(0),
                    id: pageNumber,
                    scale: scale,
                    defaultViewport: page.getViewport(1),
                    textLayerFactory: _this.textLayerFactory
                });
                _this.pdfPagesView.push(pageView);
                pageView.update(scale);
                pageView.setPdfPage(page);
                _this.stopRendering();
                _this.positionCanvas(pageNumber);
                _this.completeTaskAndPullQueue(undefined);
            };
            var onPageFailure = function (error) {
                _this.stopRendering();
                _this.logger.error("Failed to fetch page " + pageNumber + " from url=" + pdfFile.url + ", got error:" + error);
                _this.completeTaskAndPullQueue(_this.i18n.text("js.pdfjs.failure.page_get", pageNumber, error));
            };
            pdfFile.getPage(pageNumber).then(onPageSuccess, onPageFailure);
            return true;
        };
        PdfJsViewer.prototype.positionCanvas = function (pageNumber) {
            var parent = $("#pageContainer" + pageNumber, this.jqRoot);
            var canvas = parent.find(".canvasWrapper");
            canvas.removeClass("hide");
            if (canvas.width() < this.jqRoot.width()) {
                canvas.css("left", (this.jqRoot.width()) / 2 - (canvas.width() / 2) + "px");
            }
            else {
                canvas.css("left", "0px");
            }
            if (canvas.height() < this.jqRoot.height()) {
                canvas.css("top", (this.jqRoot.height()) / 2 - (canvas.height() / 2) + "px");
            }
            else {
                canvas.css("top", "0px");
            }
            if (canvas.width() < this.jqRoot.width() && canvas.height() < this.jqRoot.height()) {
                canvas.addClass("shadow");
            }
            else {
                canvas.removeClass("shadow");
            }
            var canvasOffset = canvas.position();
            var textLayer = parent.find(".textLayer");
            textLayer.css({
                top: canvasOffset.top,
                left: canvasOffset.left
            });
        };
        PdfJsViewer.prototype.resetCanvas = function () {
            if (this.pdfPagesView.length != 0) {
                for (var _i = 0, _a = this.pdfPagesView; _i < _a.length; _i++) {
                    var i = _a[_i];
                    this.pdfPagesView[i].destroy();
                }
                this.pdfPagesView = [];
            }
            this.jqRoot.empty();
            this.queue.clear();
        };
        PdfJsViewer.prototype.showPage = function (page) {
            if (page > this.numPages) {
                page = this.numPages;
            }
            var pageWrapper = $("div").find("[data-page-number='" + page + "']")[0];
            pageWrapper.scrollIntoView();
        };
        PdfJsViewer.prototype.resetPage = function () {
            if (this.currentPage !== undefined) {
                this.zoom.onResize();
            }
        };
        PdfJsViewer.prototype.addOnPageReady = function (callback) {
            this.pageReady.add(callback);
        };
        PdfJsViewer.prototype.getRootElement = function () { return this.jqRoot; };
        PdfJsViewer.prototype.onResize = function () {
            if (this.currentFile) {
                this.showPage(this.currentPage);
            }
        };
        PdfJsViewer.prototype.getCurrentPage = function () {
            return this.currentPage;
        };
        PdfJsViewer.prototype.getVisiblePages = function () {
            return PdfJsUtils.getVisibleElements(this.getRootElement()[0], this.pdfPagesView, true);
        };
        PdfJsViewer.prototype.update = function () {
            var visible = this.getVisiblePages();
            var visiblePages = visible.views, numVisiblePages = visiblePages.length;
            if (numVisiblePages === 0) {
                return;
            }
            this.renderingQueue.renderHighestPriority(visible);
            this.currentPage = visible.first.id;
        };
        PdfJsViewer.prototype.forceRendering = function (currentlyVisiblePages) {
            var visiblePages = currentlyVisiblePages || this.getVisiblePages();
            var pageView = this.renderingQueue.getHighestPriority(visiblePages, this.pdfPagesView, this.scroll.down);
            if (pageView) {
                this.renderingQueue.renderView(pageView);
                return true;
            }
            return false;
        };
        PdfJsViewer.prototype.scrollUpdate = function () {
            if (this.numPages === 0) {
                return;
            }
            this.update();
        };
        PdfJsViewer.prototype.getZoomScale = function () { return this.zoom.current(); };
        PdfJsViewer.prototype.zoomPreset = function (scale) {
            this.zoom.setPreset(scale);
            this.showPage(this.currentPage);
        };
        return PdfJsViewer;
    }());
    exports.PdfJsViewer = PdfJsViewer;
});
//# sourceMappingURL=PdfJsViewer.js.map