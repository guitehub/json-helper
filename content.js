/*
 * JSON Helper — content script.
 *
 * Détecte les pages contenant du JSON brut et les remplace par une
 * arborescence interactive. Traitement 100 % local : aucune requête réseau,
 * aucune permission demandée.
 *
 * Le fichier est aussi chargeable par Node (`require`) pour les tests
 * unitaires : dans ce cas il exporte ses fonctions pures sans toucher au DOM.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  /** Au-delà : arborescence désactivée par défaut (cahier des charges §4). */
  const LARGE_THRESHOLD = 2 * 1024 * 1024;
  /** En dessous : tout est déplié à l'ouverture. Au-dessus : 2 niveaux. */
  const AUTO_EXPAND_THRESHOLD = 300 * 1024;
  const PARTIAL_EXPAND_DEPTH = 2;
  /** Nombre d'enfants rendus par frame lors d'un « Tout développer ». */
  const EXPAND_BATCH = 2000;
  /** Préfixes anti-XSSI parfois placés devant du JSON (Google, Angular…). */
  const XSSI_PREFIXES = [")]}'", 'while(1);', 'for(;;);'];

  /* ------------------------------------------------------------------ */
  /* Fonctions pures (testées sous Node)                                 */
  /* ------------------------------------------------------------------ */

  /** Vrai pour application/json, text/json, application/*+json, x-json… */
  function isJsonContentType(contentType) {
    if (!contentType) return false;
    const base = String(contentType).split(';')[0].trim().toLowerCase();
    return /^(?:application|text)\/(?:[a-z0-9.+-]*\+)?(?:x-)?json$/.test(base);
  }

  /** Retire le BOM et un éventuel préfixe anti-XSSI. */
  function cleanText(text) {
    let t = String(text);
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    const lead = t.replace(/^\s+/, '');
    for (const prefix of XSSI_PREFIXES) {
      if (lead.startsWith(prefix)) {
        return lead.slice(prefix.length).replace(/^,?\s*/, '');
      }
    }
    return t;
  }

  /** Le texte commence-t-il (hors espaces) par un objet ou un tableau ? */
  function looksLikeJsonContainer(text) {
    return /^\s*[[{]/.test(text);
  }

  /** JSON.parse sans exception. */
  function tryParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * Parseur JSON produisant un arbre fidèle au texte source :
   *  - l'ordre des clés est conservé (JSON.parse réordonne les clés numériques) ;
   *  - les nombres gardent leur texte exact (pas de perte au-delà de 2^53) ;
   *  - les clés dupliquées restent visibles.
   *
   * Nœuds : {t:'o', e:[[clé, nœud], …]} | {t:'a', e:[nœud, …]}
   *         {t:'s', v} | {t:'n', raw} | {t:'b', v} | {t:'z'} (null)
   */
  function parseAst(text) {
    const n = text.length;
    const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    let i = 0;

    function fail(message) {
      return new SyntaxError((message || 'JSON invalide') + ' (position ' + i + ')');
    }

    function skipWs() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 32 || c === 10 || c === 13 || c === 9) i++;
        else break;
      }
    }

    function readString() {
      let from = i + 1;
      for (;;) {
        const q = text.indexOf('"', from);
        if (q < 0) throw fail('Chaîne non terminée');
        let k = q - 1;
        let backslashes = 0;
        while (text.charCodeAt(k) === 92) {
          backslashes++;
          k--;
        }
        if (backslashes % 2 === 0) {
          const inner = text.slice(i + 1, q);
          const value = inner.indexOf('\\') < 0 ? inner : JSON.parse('"' + inner + '"');
          i = q + 1;
          return value;
        }
        from = q + 1;
      }
    }

    function readValue() {
      skipWs();
      const c = text[i];

      if (c === '{') {
        i++;
        const entries = [];
        skipWs();
        if (text[i] === '}') {
          i++;
          return { t: 'o', e: entries };
        }
        for (;;) {
          skipWs();
          if (text[i] !== '"') throw fail('Clé attendue');
          const key = readString();
          skipWs();
          if (text[i++] !== ':') throw fail('« : » attendu');
          entries.push([key, readValue()]);
          skipWs();
          const d = text[i++];
          if (d === ',') continue;
          if (d === '}') return { t: 'o', e: entries };
          throw fail('« , » ou « } » attendu');
        }
      }

      if (c === '[') {
        i++;
        const items = [];
        skipWs();
        if (text[i] === ']') {
          i++;
          return { t: 'a', e: items };
        }
        for (;;) {
          items.push(readValue());
          skipWs();
          const d = text[i++];
          if (d === ',') continue;
          if (d === ']') return { t: 'a', e: items };
          throw fail('« , » ou « ] » attendu');
        }
      }

      if (c === '"') return { t: 's', v: readString() };
      if (text.startsWith('true', i)) { i += 4; return { t: 'b', v: true }; }
      if (text.startsWith('false', i)) { i += 5; return { t: 'b', v: false }; }
      if (text.startsWith('null', i)) { i += 4; return { t: 'z' }; }

      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      if (m) {
        i = NUMBER.lastIndex;
        return { t: 'n', raw: m[0] };
      }
      throw fail('Valeur inattendue');
    }

    const root = readValue();
    skipWs();
    if (i !== n) throw fail('Contenu après la fin du JSON');
    return root;
  }

  function isContainer(node) {
    return node.t === 'o' || node.t === 'a';
  }

  function itemsLabel(count) {
    return count + (count > 1 ? ' items' : ' item');
  }

  function formatSize(chars) {
    if (chars < 1024) return chars + ' o';
    if (chars < 1024 * 1024) return (chars / 1024).toFixed(1).replace('.', ',') + ' Ko';
    return (chars / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo';
  }

  /** Chaîne affichable comme lien cliquable (http/https uniquement). */
  function isLinkable(value) {
    return typeof value === 'string' && value.length < 2048 && /^https?:\/\/[^\s"<>]+$/i.test(value);
  }

  const JS_IDENT = /^[A-Za-z_$][\w$]*$/;
  const JQ_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

  /**
   * Chemin d'accès à une valeur, à partir de ses segments
   * (chaîne = clé d'objet, nombre = index de tableau).
   *  - 'js' : data.items[3]["content-type"]  (racine : chaîne vide)
   *  - 'jq' : .data.items[3]["content-type"] (racine : « . »)
   */
  function formatPath(segments, style) {
    const jq = style === 'jq';
    const ident = jq ? JQ_IDENT : JS_IDENT;
    let out = '';
    for (const s of segments) {
      if (typeof s === 'number') out += '[' + s + ']';
      else if (ident.test(s)) out += '.' + s;
      else out += '[' + JSON.stringify(s) + ']';
    }
    if (jq) return out.startsWith('.') ? out : '.' + out;
    return out.startsWith('.') ? out.slice(1) : out;
  }

  /**
   * Sérialise un nœud de parseAst en JSON indenté (2 espaces), en restant
   * fidèle à la source : ordre des clés, texte exact des nombres, doublons.
   */
  function stringifyAst(root) {
    const out = [];
    (function write(node, indent) {
      switch (node.t) {
        case 's':
          out.push(JSON.stringify(node.v));
          return;
        case 'n':
          out.push(node.raw);
          return;
        case 'b':
          out.push(String(node.v));
          return;
        case 'z':
          out.push('null');
          return;
      }
      const isArray = node.t === 'a';
      if (node.e.length === 0) {
        out.push(isArray ? '[]' : '{}');
        return;
      }
      const inner = indent + '  ';
      out.push(isArray ? '[' : '{');
      node.e.forEach((entry, index) => {
        out.push(index ? ',\n' : '\n', inner);
        if (isArray) {
          write(entry, inner);
        } else {
          out.push(JSON.stringify(entry[0]), ': ');
          write(entry[1], inner);
        }
      });
      out.push('\n', indent, isArray ? ']' : '}');
    })(root, '');
    return out.join('');
  }

  const api = {
    LARGE_THRESHOLD,
    isJsonContentType,
    cleanText,
    looksLikeJsonContainer,
    tryParse,
    parseAst,
    itemsLabel,
    formatSize,
    isLinkable,
    formatPath,
    stringifyAst,
  };

  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
    return;
  }
  if (typeof document === 'undefined') return;

  /* ------------------------------------------------------------------ */
  /* Détection dans la page (§2.1)                                       */
  /* ------------------------------------------------------------------ */

  const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT']);

  /**
   * Renvoie le texte brut de la page s'il peut s'agir de JSON, sinon null.
   * Sur une page HTML normale, on sort ici sans rien parser.
   */
  function extractRawText(contentTypeIsJson) {
    const body = document.body;
    if (!body) return null; // document XML, SVG…

    const elements = Array.from(body.children).filter(
      (el) => !IGNORED_TAGS.has(el.tagName) && !el.classList.contains('json-formatter-container')
    );
    const strayText = Array.from(body.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ''
    );

    if (elements.length === 0) return body.textContent;
    if (elements.length === 1 && elements[0].tagName === 'PRE' && !strayText) {
      return elements[0].textContent;
    }
    if (contentTypeIsJson) {
      const pre = body.querySelector('pre');
      return pre ? pre.textContent : body.textContent;
    }
    return null;
  }

  function detect() {
    const contentType = (document.contentType || '').toLowerCase();
    const ctIsJson = isJsonContentType(contentType);
    if (!ctIsJson && contentType !== 'text/plain' && contentType !== 'text/html') return null;

    const raw = extractRawText(ctIsJson);
    if (raw == null) return null;

    const text = cleanText(raw);
    if (text.trim() === '') return null;
    if (!ctIsJson && !looksLikeJsonContainer(text)) return null;

    const parsed = tryParse(text);
    if (!parsed.ok) return null; // JSON invalide : la page reste intacte
    return { raw, text };
  }

  /* ------------------------------------------------------------------ */
  /* Petits utilitaires DOM                                              */
  /* ------------------------------------------------------------------ */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // jamais innerHTML
    return node;
  }

  function button(label, action, title) {
    const b = el('button', 'jh-btn', label);
    b.type = 'button';
    b.dataset.action = action;
    if (title) b.title = title;
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* Rendu de l'arborescence (§2.2)                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Élément DOM d'une entrée -> { key, node } : clé (chaîne), index (nombre)
   * ou null pour la racine, et nœud de l'arbre JSON. L'élément est la ligne
   * pour une valeur simple, le bloc .jh-node pour un objet/tableau non vide.
   */
  const entryOf = new WeakMap();
  const rendered = new WeakSet();

  function appendKey(line, key, keyKind) {
    if (keyKind === 'key') {
      line.appendChild(el('span', 'jh-key', JSON.stringify(key)));
      line.appendChild(el('span', 'jh-punct', ': '));
    } else if (keyKind === 'index') {
      line.appendChild(el('span', 'jh-index', key + ': '));
    }
  }

  function comma() {
    return el('span', 'jh-punct', ',');
  }

  function primitiveElement(node) {
    switch (node.t) {
      case 's': {
        const span = el('span', 'jh-string');
        if (isLinkable(node.v)) {
          const a = el('a', 'jh-link', JSON.stringify(node.v));
          a.href = node.v;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          span.appendChild(a);
        } else {
          span.textContent = JSON.stringify(node.v);
        }
        return span;
      }
      case 'n':
        return el('span', 'jh-number', node.raw);
      case 'b':
        return el('span', 'jh-bool', String(node.v));
      case 'z':
        return el('span', 'jh-null', 'null');
      case 'o':
        return el('span', 'jh-bracket', '{}');
      case 'a':
        return el('span', 'jh-bracket', '[]');
      default:
        return el('span', '', '');
    }
  }

  function renderEntry(parent, key, keyKind, node, isLast) {
    if (isContainer(node) && node.e.length > 0) {
      parent.appendChild(renderContainer(key, keyKind, node, isLast));
      return;
    }
    const line = el('div', 'jh-line');
    appendKey(line, key, keyKind);
    line.appendChild(primitiveElement(node));
    if (!isLast) line.appendChild(comma());
    entryOf.set(line, { key, node });
    parent.appendChild(line);
  }

  function renderContainer(key, keyKind, node, isLast) {
    const isArray = node.t === 'a';
    const open = isArray ? '[' : '{';
    const close = isArray ? ']' : '}';

    const wrapper = el('div', 'jh-node jh-collapsed');

    const head = el('div', 'jh-line jh-head');
    const toggle = el('span', 'jh-toggle');
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.title = 'Clic : plier / déplier — Alt+clic : récursif';
    head.appendChild(toggle);
    appendKey(head, key, keyKind);
    head.appendChild(el('span', 'jh-bracket', open));

    const tail = el('span', 'jh-collapsed-tail');
    tail.appendChild(el('span', 'jh-summary', '… ' + itemsLabel(node.e.length)));
    tail.appendChild(el('span', 'jh-bracket', close));
    if (!isLast) tail.appendChild(comma());
    head.appendChild(tail);

    const foot = el('div', 'jh-line jh-foot');
    foot.appendChild(el('span', 'jh-bracket', close));
    if (!isLast) foot.appendChild(comma());

    wrapper.appendChild(head);
    wrapper.appendChild(foot);
    entryOf.set(wrapper, { key, node });
    return wrapper;
  }

  /** Crée les enfants d'un conteneur au premier dépliage. Renvoie le nombre rendu. */
  function ensureRendered(wrapper) {
    if (rendered.has(wrapper)) return 0;
    rendered.add(wrapper);
    const { node } = entryOf.get(wrapper);
    const children = el('div', 'jh-children');
    const last = node.e.length - 1;
    if (node.t === 'a') {
      node.e.forEach((child, index) => renderEntry(children, index, 'index', child, index === last));
    } else {
      node.e.forEach(([key, child], index) => renderEntry(children, key, 'key', child, index === last));
    }
    wrapper.insertBefore(children, wrapper.lastChild); // avant la ligne fermante
    return node.e.length;
  }

  function setExpanded(wrapper, expanded) {
    if (expanded) ensureRendered(wrapper);
    wrapper.classList.toggle('jh-collapsed', !expanded);
    const toggle = wrapper.firstChild.firstChild;
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  /** Segments du chemin de la racine jusqu'à l'entrée (élément DOM). */
  function pathSegments(entry) {
    const segments = [];
    for (let e = entry; e; e = e.parentElement.closest('.jh-node')) {
      const info = entryOf.get(e);
      if (info && info.key != null) segments.unshift(info.key);
    }
    return segments;
  }

  /** Entrée (ligne ou bloc) correspondant à une ligne cliquée. */
  function entryForLine(line) {
    return line.classList.contains('jh-head') || line.classList.contains('jh-foot') ? line.parentElement : line;
  }

  /** Copie dans le presse-papiers ; repli sur execCommand (pages http, refus). */
  function copyText(text) {
    const legacy = () => {
      const area = el('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (error) {
        ok = false;
      }
      area.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, legacy);
    }
    return Promise.resolve(legacy());
  }

  function childContainers(wrapper) {
    const children = wrapper.querySelector(':scope > .jh-children');
    if (!children) return [];
    return Array.from(children.children).filter((c) => c.classList.contains('jh-node'));
  }

  /* ------------------------------------------------------------------ */
  /* Application                                                         */
  /* ------------------------------------------------------------------ */

  function mount({ raw, text }) {
    const large = raw.length > LARGE_THRESHOLD;

    document.documentElement.classList.add('jh-active');
    document.body.textContent = ''; // on vide la page texte brut

    const app = el('div', 'jh-app');

    // --- Barre d'outils (§2.3)
    const toolbar = el('header', 'jh-toolbar');
    toolbar.appendChild(el('span', 'jh-title', 'JSON Helper'));
    const meta = el('span', 'jh-meta', formatSize(raw.length));
    toolbar.appendChild(meta);
    toolbar.appendChild(el('span', 'jh-spacer'));
    const expandBtn = button('Tout développer', 'expand-all');
    const collapseBtn = button('Tout réduire', 'collapse-all');
    const switcher = el('span', 'jh-switch');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Mode d’affichage');
    const formattedBtn = button('Formatted', 'formatted', 'Vue arborescente');
    const rawBtn = button('Raw', 'raw', 'JSON brut initial');
    switcher.append(formattedBtn, rawBtn);
    toolbar.append(expandBtn, collapseBtn, switcher);
    app.appendChild(toolbar);

    // --- Bandeau (volume, erreurs)
    const banner = el('div', 'jh-banner');
    banner.hidden = true;
    app.appendChild(banner);

    // --- Vues
    const tree = el('div', 'jh-tree');
    tree.hidden = true;
    const rawView = el('pre', 'jh-raw');
    rawView.hidden = true;
    app.append(tree, rawView);

    // --- Barre du chemin (valeur sélectionnée)
    const pathbar = el('footer', 'jh-pathbar');
    pathbar.hidden = true;
    const styleSwitch = el('span', 'jh-switch');
    styleSwitch.setAttribute('role', 'group');
    styleSwitch.setAttribute('aria-label', 'Notation du chemin');
    const jsBtn = button('JS', 'path-js', 'Notation JavaScript : data.items[0].id');
    const jqBtn = button('jq', 'path-jq', 'Notation jq : .data.items[0].id');
    styleSwitch.append(jsBtn, jqBtn);
    const pathText = el('code', 'jh-path');
    const copyPathBtn = button('Copier le chemin', 'copy-path');
    const copyValueBtn = button('Copier la valeur', 'copy-value', 'Objets et tableaux en JSON indenté, chaînes sans guillemets');
    const copyStatus = el('span', 'jh-sr-only');
    copyStatus.setAttribute('role', 'status');
    pathbar.append(styleSwitch, pathText, copyPathBtn, copyValueBtn, copyStatus);
    app.appendChild(pathbar);
    document.body.appendChild(app);

    let rootWrapper = null;
    let treeBuilt = false;
    let pendingFrame = 0;
    let selected = null; // entrée sélectionnée (ligne ou bloc)
    let pathStyle = 'js';

    function select(entry) {
      if (selected) selected.classList.remove('jh-selected');
      selected = entry;
      if (selected) selected.classList.add('jh-selected');
      updatePathbar();
    }

    function currentPath() {
      return selected ? formatPath(pathSegments(selected), pathStyle) : '';
    }

    function updatePathbar() {
      jsBtn.setAttribute('aria-pressed', String(pathStyle === 'js'));
      jqBtn.setAttribute('aria-pressed', String(pathStyle === 'jq'));
      const path = currentPath();
      pathText.classList.toggle('jh-path-empty', !path);
      pathText.textContent = !selected
        ? 'Cliquez sur une ligne pour afficher son chemin'
        : path || '(racine)';
      copyPathBtn.disabled = !path;
      copyValueBtn.disabled = !selected;
    }

    function copyFrom(btn, text) {
      const label = btn.dataset.label || (btn.dataset.label = btn.textContent);
      copyText(text).then((ok) => {
        btn.textContent = ok ? 'Copié ✓' : 'Échec de la copie';
        copyStatus.textContent = ok ? 'Copié dans le presse-papiers' : 'Échec de la copie';
        clearTimeout(btn.resetTimer);
        btn.resetTimer = setTimeout(() => {
          btn.textContent = label;
          copyStatus.textContent = '';
        }, 1500);
      });
    }

    function cancelPending() {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      pendingFrame = 0;
      app.classList.remove('jh-busy');
    }

    /** Déplie `start` et ses descendants jusqu'à maxDepth, par paquets. */
    function expandDeep(start, maxDepth) {
      cancelPending();
      const stack = [[start, 0]];
      const step = () => {
        let budget = EXPAND_BATCH;
        while (stack.length && budget > 0) {
          const [wrapper, depth] = stack.pop();
          if (wrapper.classList.contains('jh-collapsed')) {
            budget -= ensureRendered(wrapper);
            setExpanded(wrapper, true);
          }
          if (depth + 1 < maxDepth) {
            const kids = childContainers(wrapper);
            for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k], depth + 1]);
          }
        }
        if (stack.length) {
          app.classList.add('jh-busy');
          pendingFrame = requestAnimationFrame(step);
        } else {
          cancelPending();
        }
      };
      step();
    }

    function collapseDeep(start) {
      cancelPending();
      start.querySelectorAll('.jh-node:not(.jh-collapsed)').forEach((w) => setExpanded(w, false));
      setExpanded(start, false);
    }

    function buildTree() {
      if (treeBuilt) return true;
      let ast;
      try {
        ast = parseAst(text);
      } catch (error) {
        showBanner('Impossible de construire l’arborescence : ' + error.message, null);
        return false;
      }
      treeBuilt = true;
      if (isContainer(ast)) {
        const count = ast.e.length;
        meta.textContent =
          (ast.t === 'a' ? 'Tableau' : 'Objet') + ' · ' + itemsLabel(count) + ' · ' + formatSize(raw.length);
      }
      renderEntry(tree, null, null, ast, true);
      rootWrapper = tree.querySelector('.jh-node');
      if (rootWrapper) {
        expandDeep(rootWrapper, raw.length < AUTO_EXPAND_THRESHOLD ? Infinity : PARTIAL_EXPAND_DEPTH);
      }
      return true;
    }

    function setMode(mode) {
      if (mode === 'formatted' && !buildTree()) mode = 'raw';
      if (mode === 'raw' && !rawView.firstChild) rawView.textContent = raw;
      if (mode === 'raw') cancelPending();
      tree.hidden = mode !== 'formatted';
      rawView.hidden = mode !== 'raw';
      pathbar.hidden = mode !== 'formatted';
      formattedBtn.setAttribute('aria-pressed', String(mode === 'formatted'));
      rawBtn.setAttribute('aria-pressed', String(mode === 'raw'));
      const noTree = mode !== 'formatted' || !rootWrapper;
      expandBtn.disabled = noTree;
      collapseBtn.disabled = noTree;
      if (mode === 'formatted' && treeBuilt) hideBanner();
    }

    function showBanner(message, actionLabel) {
      banner.textContent = '';
      banner.appendChild(el('span', '', message));
      if (actionLabel) banner.appendChild(button(actionLabel, 'force-tree'));
      banner.hidden = false;
    }

    function hideBanner() {
      banner.hidden = true;
    }

    // --- Événements : délégation (un seul listener par zone)
    toolbar.addEventListener('click', (event) => {
      const b = event.target.closest('button');
      if (!b || b.disabled) return;
      switch (b.dataset.action) {
        case 'expand-all':
          if (rootWrapper) expandDeep(rootWrapper, Infinity);
          break;
        case 'collapse-all':
          if (rootWrapper) {
            collapseDeep(rootWrapper);
            setExpanded(rootWrapper, true); // la racine reste ouverte
          }
          break;
        case 'formatted':
          setMode('formatted');
          break;
        case 'raw':
          setMode('raw');
          break;
      }
    });

    banner.addEventListener('click', (event) => {
      const b = event.target.closest('button');
      if (b && b.dataset.action === 'force-tree') setMode('formatted');
    });

    function onToggle(target, recursive) {
      const wrapper = target.closest('.jh-node');
      if (!wrapper) return;
      const willExpand = wrapper.classList.contains('jh-collapsed');
      if (recursive) {
        if (willExpand) expandDeep(wrapper, Infinity);
        else collapseDeep(wrapper);
      } else {
        setExpanded(wrapper, willExpand);
      }
    }

    tree.addEventListener('click', (event) => {
      const target = event.target.closest('.jh-toggle, .jh-summary');
      if (target) {
        onToggle(target, event.altKey);
        return;
      }
      if (event.target.closest('a')) return; // lien : on le laisse s'ouvrir
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return; // sélection de texte en cours
      const line = event.target.closest('.jh-line');
      if (line) select(entryForLine(line));
    });

    // Clavier : une flèche qui prend le focus sélectionne son bloc
    tree.addEventListener('focusin', (event) => {
      if (event.target.classList && event.target.classList.contains('jh-toggle')) {
        select(event.target.closest('.jh-node'));
      }
    });

    app.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && selected) select(null);
    });

    pathbar.addEventListener('click', (event) => {
      const b = event.target.closest('button');
      if (!b || b.disabled) return;
      switch (b.dataset.action) {
        case 'path-js':
        case 'path-jq':
          pathStyle = b.dataset.action === 'path-jq' ? 'jq' : 'js';
          updatePathbar();
          break;
        case 'copy-path':
          copyFrom(b, currentPath());
          break;
        case 'copy-value': {
          const { node } = entryOf.get(selected);
          copyFrom(b, node.t === 's' ? node.v : stringifyAst(node));
          break;
        }
      }
    });

    tree.addEventListener('keydown', (event) => {
      if (!event.target.classList || !event.target.classList.contains('jh-toggle')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onToggle(event.target, event.altKey);
      }
    });

    // --- État initial
    updatePathbar();
    if (large) {
      setMode('raw');
      showBanner(
        'JSON volumineux (' + formatSize(raw.length) + ') : l’arborescence est désactivée par défaut ' +
          'pour ne pas bloquer le navigateur.',
        'Afficher l’arborescence quand même'
      );
    } else {
      setMode('formatted');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Point d'entrée                                                      */
  /* ------------------------------------------------------------------ */

  if (document.documentElement.classList.contains('jh-active')) return; // déjà monté
  const detected = detect();
  if (detected) mount(detected);
})();
