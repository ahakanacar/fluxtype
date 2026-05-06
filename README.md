# fluxtype

A minimalist, high-precision typing speed test application handcrafted in pure Vanilla JavaScript. Optimized for offline-first local execution and seamless widget embeddability.

## 🚀 Key Features

* **Deterministic Core Logic:** High-frequency keystroke data tracking (WPM, Accuracy, Key Latency) with zero framework overhead.
* **Symmetrical Metrics Dashboard:** A strictly aligned, balanced results grid passing the vertical ruler test across all tiers.
* **Zero-Dependency Portability:** Runs flawlessly offline without a local server, bundler, or environment setup.
* **Transactional Persistence:** Retains configuration and session states safely via a serialized Promise-based `AsyncQueue` mapping to `localStorage`.

---

## 💻 How to Run Locally

You do not need to install packages or run a local server.

1. Clone or download the repository.
2. Go to the root directory and simply **double-click** `index.html`. It launches instantly in any web browser via the `file://` protocol.

---

## 🧩 How to Embed (Widget Integration)

`fluxtype` is fully encapsulated inside a responsive, geometrically bounded shell (`min-width: 360px` to `max-width: 600px`). It can be embedded into any web page or external project as an isolated typing widget via an HTML `iframe`.

```html
<iframe 
  src="https://YOUR_HOSTED_URL/index.html" 
  title="fluxtype Typing Widget"
  width="100%" 
  height="650px" 
  style="border: none; max-width: 600px; min-width: 360px; display: block; margin: 0 auto; overflow: hidden;"
  scrolling="no">
</iframe>
