/* WORD MASTER Glass Recall - OCR canvas source bridge
 * The app may still own a hidden legacy OCR canvas for compatibility, but every
 * OCR request is rewritten so its image comes from WMTestReuse's study canvas.
 */
(function () {
  "use strict";

  function isOcrUrl(input) {
    var url = "";
    try {
      if (typeof input === "string") url = input;
      else if (input && input.url) url = input.url;
    } catch (ignore) {}
    return /(^|[\/?_.-])ocr([\/?_.-]|$)/i.test(url);
  }

  function activeImage() {
    try {
      var canvas = window.WMTestReuse && window.WMTestReuse.getCanvas && window.WMTestReuse.getCanvas();
      if (!canvas) return "";
      return canvas.toDataURL("image/png");
    } catch (ignore) {
      return "";
    }
  }

  function rewriteJsonBody(body) {
    var image = activeImage();
    if (!image || typeof body !== "string") return body;
    try {
      var data = JSON.parse(body);
      if (!data || typeof data !== "object") return body;
      data.image = image;
      return JSON.stringify(data);
    } catch (ignore) {
      return body;
    }
  }

  if (window.fetch) {
    var previousFetch = window.fetch;
    window.fetch = function (input, init) {
      if (isOcrUrl(input) && init && typeof init === "object" && typeof init.body === "string") {
        var next = {}, key;
        for (key in init) if (Object.prototype.hasOwnProperty.call(init, key)) next[key] = init[key];
        next.body = rewriteJsonBody(init.body);
        init = next;
      }
      return previousFetch.call(this, input, init);
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var previousOpen = window.XMLHttpRequest.prototype.open;
    var previousSend = window.XMLHttpRequest.prototype.send;

    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__wmReuseOcr = isOcrUrl(url);
      return previousOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function (body) {
      if (this.__wmReuseOcr) body = rewriteJsonBody(body);
      return previousSend.call(this, body);
    };
  }

  window.WMOcrCanvasBridge = {
    version: "1.0.0",
    getActiveImage: activeImage
  };
}());