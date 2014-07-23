//console.log('locator.js:1:' + location.href);

brwsr_def('locator', ['jquery', 'underscore', 'async', 'json3', 'api'],
function($, _, async, JSON, Api) {

var DBG = 1;

const
NS_HTML = 'http://www.w3.org/1999/xhtml',
INTERNAL_UI_NAME = Api.NS + 'ui';

function select_xpath(expression, callback, doc) {
  doc = doc || document;
  var resultset = doc.evaluate(expression, doc, resolver, 
                 XPathResult.ANY_TYPE, null);

  var aResult = resultset.iterateNext(), results = [];
  while(aResult) {
    results.push(aResult);
    aResult = resultset.iterateNext();
  }
  callback(null, results);

  function resolver(prefix) {
    return prefix == 'xhtml' ? NS_HTML: null;
  }
}

function getXPathForElement_attrs(el, attributes, uniqueAttribute) {
  var path = '';
  var doc = el.ownerDocument;
  var i, len = attributes.length,
    name, attribute;
  var savedEl = el;
  var currentEl;
  var ns = document.createElement("a").tagName == "a" ? 'xhtml:' : '';

  //create list elements and its parent available till this element
  var elems = [];
  while(el !== doc) {
    elems.push(el);
    el = el.parentNode;
  }

  _.each(elems.reverse(), function(currentEl) {
    var attributesPathFilter = '';
    path += '/' + ns + currentEl.nodeName.toLowerCase();
    for(i = 0; i < len; i += 1) {
      name = attributes[i];
      attribute = currentEl.getAttribute(name);
      if(!_.isEmpty(attribute)) {
        // TODO encode attribute
        if(name === uniqueAttribute) {
          path = (path.length > 0 ? '//' : '/') +
              ns+currentEl.nodeName.toLowerCase() +
              '[@' + name + '=\'' + attribute + '\']';
        } else {
          path += '[@' + name + '=\'' + attribute + '\']';
        }
        break;  // should we be greedy or break on first match?
      }
    }
    var matches;
    select_xpath(path, function(err, x){
      matches = x;
    });
    if(matches.length > 1 /*&& matches[0] != currentEl*/) {
      path += '['+ (_.indexOf(matches, currentEl) + 1) +']';
    }
  });
  return path;
}

function select_css(expression, callback, doc) {
  var results = [];
  doc = doc || document;
  var matches = doc.querySelectorAll(expression);
  if(matches && matches.length > 0) {
    results = _.toArray(matches);
  }
  callback(null, results);
}

function scoped_eval(expr, sendResponse) {
  var alert, confirm, prompt,
  value = eval(expr);

  if(value != null &&
    (value instanceof Node || value.length !== void 0)) {
    sendResponse(null, value);
  }
}

function select_js(script, callback, doc) {
  scoped_eval(script, function(err, matches) {
    if(err) return callback(err);

    if(matches && matches.length && matches.splice) results = matches;
    else if(matches && matches.length) results = _.toArray(matches);
    else if(matches) results = [matches];
    callback(null, results);
  });
}

function isAttr(node) {
  return node.nodeType == document.ATTRIBUTE_NODE;
}

function isComment(node) {
  return node.nodeType == document.COMMENT_NODE;
}

function isEl(node) {
  return node.nodeType == document.ELEMENT_NODE;
}

function isDisplayBlock(el) {
  return getComputedStyle(el).display == 'block';
}

function isText(node) {
  return node.nodeType == document.TEXT_NODE;
}

/**
 * Visits DOM tree starting with the passed node. The visit for a subtree is 
 * stopped when the visitor returns false for an element.
 */
function visit(el, visitor) {
  if(visitor(el) !== false && el.childNodes)
    $(el.childNodes).each(function() { visit(this, visitor) });
}

/**
 * Visits this element and its children.
 */
function visitEls(el, visitor) {
  visit(el, function(node) {
    return isEl(node) && (visitor(node) !== false);
  });
}

/**
 * Visits an elements child elements recursively.
 */
function visitChildEls(el, visitor) {
  $(el.childNodes).each(function() { visitEls(this, visitor) });
}

/**
 * Visits parent nodes in DOM tree.
 */
function visitParents(el, visitor) {
  var p = el.parentNode;
  if(p && (visitor(p) !== false)) visitParents(p, visitor)
}

/**
 * Returns a list of parent nodes for the node in DOM
 */
function getParents(node) {
  var parents = [];
  visitParents(node, function(p) {parents.unshift(p)});
  return parents;
}

/**
 * Returns the common parent containing the list of nodes.
 */
function getParent(var_args) {
  var nodes = _.toArray(arguments),
    node0 = nodes.pop(),
    parents0 = getParents(node0),
    i;
  _.each(nodes, function(n) {
    visitParents(n, function(p) {
      i = _.indexOf(parents0, p); 
      if(i >= 0) {
        // found match. remove non-matches and stop visit.
        parents0.splice(i+1);
        return false;
      }
    });
  });

  return _.last(parents0);
}

var clonedDocumentElement;

/**
 * Filters document with the included and excluded set of elements.
 */
function filterDoc() {
  // Clone root element before we filter the document. It is useful when we have
  // multiple selections for the content loaded in the same page instance.
  
  clonedDocumentElement = document.documentElement.cloneNode(true);

  // Our strategy starts with an include as a top node.
  // 1. Remove ALL exclude__-s that do not have a hasinclude__
  $(clonedDocumentElement).find('[exclude__]:not([hasinclude__])').remove();
  
  // 2. Remove elements in exclude__ that are not to be include__-ed
  cleanAnExclude(clonedDocumentElement);
  $(clonedDocumentElement).find('[exclude__][hasinclude__]').each(function() {
    visitEls(this, cleanAnExclude);
  });

  // 3. Now, starting from top, remove element that is not included. At top-
  // most level, we allow having includes. Excludes are inside includes.
  visitEls(clonedDocumentElement, removeNonIncludes);

  removeMarkers(clonedDocumentElement);
  removeMarkers(document.documentElement);

  function cleanAnExclude(el) {
    // Skip include__
    if(el.hasAttribute('include__')) return false;

    // Remove elements that do not have hasinclude__
    if(!el.hasAttribute('hasinclude__')) {
      $(el).remove();
      return false;
    } else {
      removeTexts(el);
    }
  }

  function removeNonIncludes(el) {
    if(el.hasAttribute('include__')) return false;
    if(!el.hasAttribute('hasinclude__')) {
      $(el).remove();
      return false;
    } else {
      removeTexts(el);
    }
  }

  function removeTexts(el) {
    $(el).contents().filter(function() {
      return isText(this);
    }).remove();
  }
}

var LOCATORS = {
  css: select_css,
  js: select_js,
  xpath: select_xpath
};

function locate(locator, callback) {
  var type = locator.type;
  var expr = locator.expr;
  var fn = LOCATORS[type];
  if(!fn) return cb({
    code: 'ADEX00X',
    data: "Unknown locator type:" + type
  });
  
  try {
    fn(expr, callback);
  } catch(e) {
    console.error('Error locating elements:', e, e.stack);
    callback({
      message: e.message,
      data: { locator: locator }
    });
  }
}

function checkAndRemoveAttr(node) {
  if(isAttr(node) && node.ownerElement) {
    // XXX Starting with later versions of browsers, Attr will not inherit from
    // Node. As a result ownerElement or parentNode will not be accessible.
    node.ownerElement.removeAttribute(node.nodeName);
  }
}

function markExclude(locator, callback) {
  locate(locator, function(err, results) {
    if(err) return callback(err);

    $(results).attr('exclude__', '1');
    // When excluding, remove attribute nodes present in results
    // NOTE This is used to remove on* attributes.
    _.each(results, checkAndRemoveAttr);
    callback();
  })
}

function markInclude(locator, callback) {
  locate(locator, function(err, results) {
    if(err) return callback(err);
    $(results).attr('include__', '1').parents().attr('hasinclude__', '1');
    callback();
  })
}

function removeMarkers(el) {
  // Cleanup include and exclude markers
  $(el).find('*').addBack().removeAttr('include__').removeAttr('exclude__')
    .removeAttr('hasinclude__');
}

function removeComments() {
  $('*').each(function() {
    visit(this, function(node) {
      if(isComment(node)) $(node).remove();
    });
  });
}

function dispatchEventToEl(target, type, initArgs) {
  var event = document.createEvent(type);
  if('MouseEvent' == type) {
    event.initMouseEvent.apply(event, initArgs);
  } else if('KeyboardEvent' == type) {
    event.initKeyEvent.apply(event, initArgs);
  } else {
    event.initEvent.apply(event, initArgs);
  }
  target.dispatchEvent(event);
}

function dispatchEventAt(x, y, type, initArgs) {
  dispatchEventToEl(document.elementFromPoint(x, y), type, initArgs);
}

function nodeToJson(node) {
  // XXX In addition to node heirarchy, record layout info too.
  // Layout info would be useful when recreating webpage layout.
  if(node.nodeType == 1) {  // type ELEMENT
    // Should we incorporate element specific properties.
    var style = getComputedStyle(node);
    return {
      attributes: _.map(node.attributes, function(attr) {
        return { name: attr.name, value: attr.value };
      })
      , childNodes: _.map(node.childNodes, nodeToJson)
      , nodeName: node.nodeName
      , nodeType: node.nodeType
      , style: {
        display: style.display
      }
      // XXX Should we capture other attributes that may be useful while
      // analysing content?
    };
  } else {
    return {
      nodeName: node.nodeName
      , nodeType: node.nodeType
      , nodeValue: node.nodeValue
    }
  }
}

function getDoc() {
  with(document) {
    return {
      URL: URL,
      baseURI: baseURI,
      characterSet: characterSet,
      charset: charset,
      //childNodes: _.map(childNodes, nodeToJson),
      compatMode: compatMode,
      //contentType: contentType,
      cookie: cookie,
      defaultCharset: defaultCharset,
      designMode: designMode,
      dir: dir,
      doctype: null,  // TODO objectify doctype
      //documentElement: nodeToJson(documentElement),
      documentURI: documentURI,
      domain: domain,
      embeds: null,   // TODO
      fgColor: fgColor,
      inputEncoding: inputEncoding,
      lastModified: lastModified,
      nodeName: nodeName,
      nodeType: nodeType,
      readyState: readyState,
      title: title
    };
  }
}

/* "a   \n\n  \t \n \t b \n\n c\n\n" => "a\n \t b\n c\n" */
var RE_CRLF_COMPACT = /\s*\n+(\s*\n+)*/g;

function getHTML() {
  var html = (clonedDocumentElement).outerHTML;
  html = html.trim().replace(RE_CRLF_COMPACT,'\n');
  return html;
}

function trimTextBuf(buf) {
  return buf.join('').trim().replace(RE_CRLF_COMPACT,'\n').replace(/[ \t]+/g, ' ');
}

function _getText(el, buf) {
  visit(el, function(node) {
    if(_.indexOf(['NOSCRIPT', 'SCRIPT', 'STYLE'], node.nodeName) >= 0) {
      return false;
    }

    _getTextNode(node, buf);
  });
}

function _getTextNode(node, buf) {
  if(isText(node)) {
    buf.push(node.nodeValue);
  } else if(isEl(node)) {
    if(isDisplayBlock(node)) {
      buf.push('\n');
    }
  }
}

function getText(input, callback) {
  //console.log('getText: input', input);

  if(!input || !input.includes) {
    var buf = [];
    _getText(clonedDocumentElement, buf);
    callback(null, trimTextBuf(buf));
  } else {
    async.series([
      function(callback) {
        async.mapSeries(input.includes||[], markInclude, callback);
      },
      function(callback) {
        async.mapSeries(input.excludes||[], markExclude, callback);
      }
    ], function(err) {
      if(err) return callback(err);

      callback(null, getTextMarked(document.documentElement, true));
    })
  }
}

function _getTextMarked(buf, el, parentExcluded, clearMarker) {
  var excluded = el.hasAttribute('exclude__') || parentExcluded;
  // If el is included then set it so, else keep the value same are before.
  if(parentExcluded && el.hasAttribute('include__')) {
    excluded = false;
  } else if(el.className.indexOf(INTERNAL_UI_NAME) >= 0) {
    excluded = true;
  }

  //console.log('_getTextMarked:', el, excluded, parentExcluded);

  if(isDisplayBlock(el)) {
    buf.push('\n');
  }

  if(excluded) {
    // If no includes within this element in an excluded element, skip it.
    if(el.hasAttribute('hasinclude__')) {
      _.each(el.children, function(childEl) {
        _getTextMarked(buf, childEl, true, clearMarker);
      });
    }
  } else {
    _.each(el.childNodes, function(node) {
      if(_.indexOf(['NOSCRIPT', 'SCRIPT', 'STYLE'], node.nodeName) >= 0) {
        return;
      }

      _getTextNode(node, buf);

      if(isEl(node)) {
        _getTextMarked(buf, node, false, clearMarker);
      }
    });
  }

  if(clearMarker) {
    el.removeAttribute('include__');
    el.removeAttribute('exclude__');
    el.removeAttribute('hasinclude__');
  }
}

function getTextMarked(el, clearMarker) {
  var buf = [];
  _getTextMarked(buf, el, !el.hasAttribute('include__'), clearMarker);
  return trimTextBuf(buf);
}

function getWindow () {
  return {
    document: getDoc(),
    innerHeight: innerHeight,
    innerWidth: innerWidth,
    location: _.reduce(location, function(memo, value, name) {
      memo[name] = value;
      return memo;
    }, {}),
    outerHeight: outerHeight,
    outerWidth: outerWidth,
    screen: {
      availHeight: screen.availHeight,
      availLeft: screen.availLeft,
      availTop: screen.availTop,
      availWidth: screen.availWidth,
      colorDepth: screen.colorDepth,
      height: screen.height,
      width: screen.width
    },
    screenX: screenX,
    screenY: screenY,
    scrollX: scrollX,
    scrollY: scrollY
  };
};

function setBase() {
  var base = document.getElementsByTagName('base')[0];
  if(!base) {
    base = document.createElement('BASE');
    var head = document.getElementsByTagName('head')[0];
    head.appendChild(base);
  }
  base.setAttribute('href', document.baseURI);
}

Api.extend({
  locate: Api.resultTransformer(locate, function(matches) {
    return _.map(matches, nodeToJson);
  }),
  /**
   * Called to filter DOM using exclude and include locators.
   */
  filterHTML: function(input, callback) {
    // Ensure that base element is present
    setBase();
    
    async.series([
      function(callback) {
        async.mapSeries(input.includes||[], markInclude, callback);
      },
      function(callback) {
        async.mapSeries(input.excludes||[], markExclude, callback);
      }
    ], function(err) {
      if(err) return callback(err);

      //console.log('filterHTML: callback');

      if(!input.keepComments) {
        removeComments();
      }

      filterDoc();
      callback();
    })
  },
  getDoc: Api.syncToAsync(getDoc),
  getHTML: Api.syncToAsync(getHTML),
  getText: getText,
  getWindow: Api.syncToAsync(getWindow)
});

// Functions exposed as a module. This coupled with API extension may be a bit
// confusing.
return {
  getXPathForElement_attrs: getXPathForElement_attrs,
  // XXX Add getCSSSelector?
  locate: locate,
  visit: visit,
  visitEls: visitEls
}

});

