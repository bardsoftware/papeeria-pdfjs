define(["require", "exports", "pdf.combined", "pdfjs-web/pdf_page_view", "pdfjs-web/text_layer_builder", "pdfjs-web/ui_utils"], function (require, exports, pdfjs, PDFPageView, TextLayerBuilder, PdfJsUtils) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var pdfjs, PDFPageView, TextLayerBuilder, PdfJsUtils;
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
                        var scaleHeight = ((container.height() - 30) / viewport.height);
                        var scaleWidth = ((container.width() - 30) / viewport.width);
                        this.fittingScale = Math.min(scaleHeight, scaleWidth);
                    }
                }
                value = this.fittingScale;
            }
            return value / PdfJsUtils.CSS_UNITS;
        };
        Zoom.prototype.zoomIn = function () {
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
                this.idxPresetScale = Math.max(newPresetScale, 0);
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
        return Zoom;
    }());
    Zoom.ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.66, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 4.0];
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
        var d = o.detail;
        var w = o.wheelDelta;
        var n = 225;
        var n1 = n - 1;
        if (d !== 0) {
            d = w / 120;
        }
        else {
            d = (w && w / d != 0) ? d / (w / d) : -d / 1.35;
        }
        d = Math.abs(d) > 1 ? (d > 0 ? 1 : -1) * (Math.pow(d, 2) + n1) / n : d;
        return -Math.min(Math.max(d / 2, -1), 1);
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
            this.currentPage = 0;
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
                    _this.openCurrentPage();
                }
            };
            this.pageDown = function () {
                if (_this.currentPage < _this.currentFile.numPages) {
                    _this.currentPage += 1;
                    _this.openCurrentPage();
                }
            };
            this.zoomIn = function () {
                _this.zoom.zoomIn() && _this.openCurrentPage();
            };
            this.zoomOut = function () {
                _this.zoom.zoomOut() && _this.openCurrentPage();
            };
            this.zoomWidth = function () {
                _this.zoom.setFitting(ZoomingMode.FIT_WIDTH);
                _this.openCurrentPage();
            };
            this.zoomPage = function () {
                _this.zoom.setFitting(ZoomingMode.FIT_PAGE);
                _this.openCurrentPage();
            };
            this.zoom.setFitting(ZoomingMode.FIT_PAGE);
            jqRoot.unbind("wheel.pdfjs").bind("wheel.pdfjs", function (e) {
                if (_this.isRendering) {
                    return;
                }
                var originalEvent = e.originalEvent;
                if (originalEvent.ctrlKey || originalEvent.metaKey) {
                    _this.processEvent(e, _this.zoomIn, _this.zoomOut);
                }
                if (jqRoot.find(".canvasWrapper").hasClass("shadow")) {
                    _this.processEvent(e, _this.pageUp, _this.pageDown);
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
                    this.currentFile = null;
                    this.zoom.onResize();
                }
                this.currentTask = task_1;
                this.currentPage = task_1.page;
                var onDocumentSuccess = function (pdf) {
                    _this.currentFile = pdf;
                    _this.currentFile.url = task_1.url;
                    if (_this.currentPage > pdf.numPages) {
                        _this.currentPage = pdf.numPages;
                    }
                    _this.openPage(pdf, _this.currentPage);
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
                if (!_this.pdfPageView) {
                    _this.pdfPageView = new PDFPageView.PDFPageView({
                        container: _this.jqRoot.get(0),
                        id: pageNumber,
                        scale: scale,
                        defaultViewport: page.getViewport(1),
                        textLayerFactory: _this.textLayerFactory
                    });
                }
                _this.pdfPageView.update(scale);
                _this.pdfPageView.setPdfPage(page);
                var onDrawSuccess = function () {
                    _this.positionCanvas();
                    _this.pageReady.invoke();
                    _this.stopRendering();
                    _this.completeTaskAndPullQueue(undefined);
                };
                var onDrawFailure = function (error) {
                    _this.stopRendering();
                    _this.logger.error("Failed to render page " + pageNumber + " from url=" + pdfFile.url + ", got error:" + error);
                    _this.completeTaskAndPullQueue(_this.i18n.text("js.pdfjs.failure.page_render", pageNumber, error));
                };
                _this.pdfPageView.draw().then(onDrawSuccess, onDrawFailure);
            };
            var onPageFailure = function (error) {
                _this.stopRendering();
                _this.logger.error("Failed to fetch page " + pageNumber + " from url=" + pdfFile.url + ", got error:" + error);
                _this.completeTaskAndPullQueue(_this.i18n.text("js.pdfjs.failure.page_get", pageNumber, error));
            };
            pdfFile.getPage(pageNumber).then(onPageSuccess, onPageFailure);
            return true;
        };
        PdfJsViewer.prototype.positionCanvas = function () {
            var canvas = $(".canvasWrapper", this.jqRoot);
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
            var textLayer = $(".textLayer", this.jqRoot);
            textLayer.css({
                top: canvasOffset.top,
                left: canvasOffset.left
            });
        };
        PdfJsViewer.prototype.resetCanvas = function () {
            if (this.pdfPageView) {
                this.pdfPageView.destroy();
            }
            this.pdfPageView = undefined;
            this.jqRoot.empty();
            this.queue.clear();
        };
        PdfJsViewer.prototype.openCurrentPage = function () {
            var lastCompletedMainFileId = (this.queue.isEmpty() && this.queue.lastCompleted)
                ? this.queue.lastCompleted.mainFileId : undefined;
            this.show(this.currentFile.url, this.currentPage, true, lastCompletedMainFileId);
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
                this.openCurrentPage();
            }
        };
        PdfJsViewer.prototype.getCurrentPage = function () { return this.currentPage; };
        PdfJsViewer.prototype.getZoomScale = function () { return this.zoom.current(); };
        PdfJsViewer.prototype.zoomPreset = function (scale) {
            this.zoom.setPreset(scale);
            this.openCurrentPage();
        };
        return PdfJsViewer;
    }());
    exports.PdfJsViewer = PdfJsViewer;
});
//# sourceMappingURL=PdfJsViewer.js.map