# oncoco-proto

Vibe prototyping of *oncoco*, a compuviz collector assistant.

The prototype explore the following concepts:
- PWA that requests rear camera access.
- JS based computer vision using off the shelf algorithms and models

Static PWA (Vite + TypeScript, no UI framework): full-screen rear camera feed, overlay canvas, hot-swappable vision algorithms and a performance overlay. Targets: Safari iOS 26+ and recent Chrome Android.

## Running locally

```sh
npm install
npm run dev        # http://localhost:5173 (desktop)
npm run dev:host   # also listens on the LAN IP, for testing on mobile
```

## OpenCV.js

OpenCV-based algorithms (e.g. *Cercles de Hough (OpenCV)*) load the prebuilt `opencv.js` from the
`@techstark/opencv-js` package (~10 MB) on demand, in the worker, the first time one is selected.
It is not precached by the service worker. A recipe for a much smaller custom build lives in
[`scripts/opencv/`](scripts/opencv/README.md).
