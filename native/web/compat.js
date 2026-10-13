// Runtime fallbacks used by the bundled app on the Android 8 stock WebView.
// Keep this file in ES5 syntax so it can run before the compiled application.
(function () {
  'use strict';

  function define(target, name, value) {
    Object.defineProperty(target, name, {
      value: value,
      configurable: true,
      writable: true
    });
  }

  if (typeof Array.prototype.flatMap !== 'function') {
    define(Array.prototype, 'flatMap', function (callback, thisArg) {
      if (this == null) throw new TypeError('flatMap called on null or undefined');
      if (typeof callback !== 'function') throw new TypeError('flatMap callback must be a function');
      var source = Object(this);
      var size = Number(source.length);
      var length = size > 0 ? Math.min(Math.floor(size), 9007199254740991) : 0;
      var result = [];
      for (var i = 0; i < length; i++) {
        if (!(i in source)) continue;
        var mapped = callback.call(thisArg, source[i], i, source);
        if (Array.isArray(mapped)) {
          var mappedLength = mapped.length;
          for (var j = 0; j < mappedLength; j++) {
            if (j in mapped) result.push(mapped[j]);
          }
        } else {
          result.push(mapped);
        }
      }
      return result;
    });
  }

  if (typeof Element !== 'undefined' && typeof Element.prototype.replaceChildren !== 'function') {
    define(Element.prototype, 'replaceChildren', function () {
      var fragment = this.ownerDocument.createDocumentFragment();
      for (var i = 0; i < arguments.length; i++) {
        var value = arguments[i];
        fragment.appendChild(value instanceof Node ? value : this.ownerDocument.createTextNode(String(value)));
      }
      while (this.firstChild) this.removeChild(this.firstChild);
      this.appendChild(fragment);
    });
  }

  if (typeof Object.hasOwn !== 'function') {
    define(Object, 'hasOwn', function (object, property) {
      return Object.prototype.hasOwnProperty.call(object, property);
    });
  }

  if (typeof String.prototype.replaceAll !== 'function') {
    define(String.prototype, 'replaceAll', function (search, replacement) {
      if (this == null) throw new TypeError('replaceAll called on null or undefined');
      if (search != null) {
        var matchSymbol = typeof Symbol !== 'undefined' && Symbol.match;
        var replaceSymbol = typeof Symbol !== 'undefined' && Symbol.replace;
        var matcher = matchSymbol ? search[matchSymbol] : undefined;
        var isRegExp = matcher === undefined ? Object.prototype.toString.call(search) === '[object RegExp]' : Boolean(matcher);
        if (isRegExp && String(search.flags).indexOf('g') === -1) {
          throw new TypeError('replaceAll requires a global regular expression');
        }
        var replacer = replaceSymbol ? search[replaceSymbol] : undefined;
        if (replacer != null) {
          if (typeof replacer !== 'function') throw new TypeError('Symbol.replace must be a function');
          return replacer.call(search, this, replacement);
        }
        if (isRegExp) return String(this).replace(search, replacement);
      }
      var text = String(this);
      var escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return text.replace(new RegExp(escaped, 'g'), replacement);
    });
  }
}());
