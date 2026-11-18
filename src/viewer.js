/* PDF viewer built on PDF.js. Renders pages lazily and turns TAPER term links
 * (https://taper.term/<id>) into clickable hotspots that open the term popup. */
import { TERM_URL } from "./assemble.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
let libP = null;
const lib = () => libP || (libP = import(/* @vite-ignore */ PDFJS).then(m => { m.GlobalWorkerOptions.workerSrc = WORKER; return m; }).catch(e => { libP = null; throw e; }));

export class PdfView {
  constructor(el, { onTerm, onLink } = {}) {
    this.el = el; this.onTerm = onTerm; this.onLink = onLink;
    this.doc = null; this.zoom = "fit"; this.pages = [];
    this.io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) this.renderPage(e.target); }), { root: el, rootMargin: "600px 0px" });
    this.ro = new ResizeObserver(() => {
      clearTimeout(this.rt);
      this.rt = setTimeout(() => { if (this.zoom === "fit" && this.doc && Math.abs(this.scale() - this.curScale) > 0.01) this.layout(); }, 150);
    });
    this.ro.observe(el);
  }
  async load(bytes) {
    const pdfjs = await lib();
    const scrollFrac = this.el.scrollHeight ? this.el.scrollTop / this.el.scrollHeight : 0;
    if (this.doc) { try { await this.doc.destroy(); } catch { /* ignore */ } }
    this.doc = await pdfjs.getDocument({ data: bytes.slice ? bytes.slice(0) : bytes }).promise;
    this.first = await this.doc.getPage(1);
    await this.layout();
    this.el.scrollTop = scrollFrac * this.el.scrollHeight;
    return this.doc.numPages;
  }
  clear(message) {
    this.io.disconnect();
    this.doc = null; this.pages = [];
    this.el.replaceChildren();
    if (message) { const p = document.createElement("div"); p.className = "pdf-empty"; p.textContent = message; this.el.append(p); }
  }
  scale() {
    const vp = this.first.getViewport({ scale: 1 });
    if (this.zoom === "fit") return Math.max(0.3, (this.el.clientWidth - 32) / vp.width);
    return this.zoom;
  }
  async layout() {
    if (!this.doc) return;
    this.io.disconnect();
    const frac = this.el.scrollHeight ? this.el.scrollTop / this.el.scrollHeight : 0;
    const s = this.scale();
    this.curScale = s;
    const vp = this.first.getViewport({ scale: s });
    const frag = document.createDocumentFragment();
    this.pages = [];
    for (let n = 1; n <= this.doc.numPages; n++) {
      const d = document.createElement("div");
      d.className = "pdf-page"; d.dataset.n = n;
      d.style.width = vp.width + "px"; d.style.height = vp.height + "px";
      d.setAttribute("aria-label", `Page ${n}`);
      frag.append(d); this.pages.push(d);
    }
    this.el.replaceChildren(frag);
    this.pages.forEach(p => this.io.observe(p));
    this.el.scrollTop = frac * this.el.scrollHeight;
  }
  async renderPage(div) {
    if (div.dataset.done === String(this.curScale) || !this.doc) return;
    div.dataset.done = String(this.curScale);
    const page = await this.doc.getPage(+div.dataset.n);
    const vp = page.getViewport({ scale: this.curScale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const c = document.createElement("canvas");
    c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
    c.style.width = vp.width + "px"; c.style.height = vp.height + "px";
    div.style.width = vp.width + "px"; div.style.height = vp.height + "px";
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
    const layer = document.createElement("div"); layer.className = "pdf-links";
    for (const a of await page.getAnnotations({ intent: "display" })) {
      if (a.subtype !== "Link" || (!a.url && !a.dest)) continue;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      const b = document.createElement("button");
      b.type = "button";
      Object.assign(b.style, { left: Math.min(x1, x2) + "px", top: Math.min(y1, y2) + "px", width: Math.abs(x2 - x1) + "px", height: Math.abs(y2 - y1) + "px" });
      if (a.url && a.url.startsWith(TERM_URL)) {
        const id = a.url.slice(TERM_URL.length).replace(/\/$/, "");
        b.className = "pdf-term"; b.title = "Show this technical term"; b.dataset.term = id;
        b.onclick = e => this.onTerm?.(id, b, e);
      } else if (a.url) {
        b.className = "pdf-link"; b.title = a.url;
        b.onclick = () => window.open(a.url, "_blank", "noopener");
      } else {
        b.className = "pdf-link"; b.title = "Go to";
        b.onclick = () => this.goToDest(a.dest);
      }
      layer.append(b);
    }
    div.replaceChildren(c, layer);
  }
  async goToDest(dest) {
    try {
      const d = typeof dest === "string" ? await this.doc.getDestination(dest) : dest;
      const idx = await this.doc.getPageIndex(d[0]);
      this.pages[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch { /* unknown destination */ }
  }
  setZoom(z) { this.zoom = z; this.layout(); }
  zoomBy(f) { this.zoom = Math.max(0.3, Math.min(4, (this.zoom === "fit" ? this.curScale : this.zoom) * f)); this.layout(); }
}
