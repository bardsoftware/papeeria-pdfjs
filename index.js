require(["workspace/viewer/PdfJsViewer"], function(PdfJsViewerModule) {
    const pdfFile = '/diploma.pdf';
    loggerImpl = { error: function(msg) { console.log(msg); }}
    alertImpl = { show: function(msg) { window.alert(msg); }}
    utils = { stopEvent: function(e) {
        if (e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
        }
    }}
    i18n = { text: function(key) { return key; }}
    viewer = new PdfJsViewerModule.PdfJsViewer($("#viewer"), alertImpl, loggerImpl, utils, i18n);
    viewer.showAll(pdfFile);
});